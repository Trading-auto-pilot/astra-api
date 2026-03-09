"use strict";

// ---------------------------------------------------------------------------
// live-manager – live state, market data handler, Redis event publishing
// ---------------------------------------------------------------------------

const { randomUUID } = require("crypto");
const https = require("https");
const http = require("http");
const {
  SNAPSHOT_TTL_SECONDS,
  ALERT_COOLDOWN_MS,
} = require("./constants");
const { asNumber } = require("./helpers");
const { buildSpotFinderRedisKey } = require("./job-manager");

const RISK_ON_TTL_MS = Number(process.env.RISK_ON_TTL_MS) || 60_000;
const INTRADAY_TF = process.env.LIVE_INTRADAY_TF || "1min";

// Opening volatility block: skip BREAKOUT signals during first N min of market open.
// MARKET_OPEN_UTC: NYSE open = "14:30" (ET standard) or "13:30" (ET daylight).
const BREAKOUT_OPEN_BLOCK_MINUTES = Number(process.env.BREAKOUT_OPEN_BLOCK_MINUTES) || 25;
const MARKET_OPEN_UTC = process.env.MARKET_OPEN_UTC || "14:30";
const OPEN_BLOCK_NOTIF_COOLDOWN_MS = 5 * 60 * 1000; // notify at most every 5 min per key

// --- Volatility event guard config (initialized from env vars, overridable at runtime) ---
const guardConfig = {
  earnings: {
    enabled: process.env.DE_EARNINGS_GUARD_ENABLED !== "false",
    blockDays: Math.round((Number(process.env.EARNINGS_BLOCK_WEEKS) || 2) * 7),
  },
  fomc: {
    enabled: process.env.DE_FOMC_GUARD_ENABLED !== "false",
    blockDays: Number(process.env.DE_FOMC_BLOCK_DAYS) || 2,
  },
  macro: {
    enabled: process.env.DE_MACRO_GUARD_ENABLED !== "false",
    blockDays: Number(process.env.DE_MACRO_BLOCK_DAYS) || 1,
  },
  dividend: {
    enabled: process.env.DE_DIVIDEND_GUARD_ENABLED !== "false",
    blockDays: Number(process.env.DE_DIVIDEND_BLOCK_DAYS) || 3,
  },
};

// Cache TTLs for guard data
const EARNINGS_CACHE_TTL_MS      = 24 * 60 * 60 * 1000; // 24h
const EARNINGS_CACHE_ERROR_TTL_MS =  1 * 60 * 60 * 1000; // 1h
const ECON_CAL_CACHE_TTL_MS      =  6 * 60 * 60 * 1000; // 6h
const ECON_CAL_ERROR_TTL_MS      = 30 * 60 * 1000;       // 30min
const DIVIDEND_CACHE_TTL_MS      = 24 * 60 * 60 * 1000; // 24h
const DIVIDEND_ERROR_TTL_MS      =  1 * 60 * 60 * 1000; // 1h
const EVENT_BLOCK_NOTIF_COOLDOWN_MS = 5 * 60 * 1000;    // 5min per guard per alertKey

// symbol → { nearestEarningsDate: number|null, expiresAt: number }
const earningsCache = new Map();
// Global economic calendar cache (FOMC + macro events), shared across all tickers
let econCalendarCache = { events: null, expiresAt: 0 };
// symbol → { nearestExDate: number|null, expiresAt: number }
const dividendCache = new Map();

async function fetchNearestEarningsDate(ticker, fmpApiKey, logger) {
  const cached = earningsCache.get(ticker);
  if (cached && Date.now() < cached.expiresAt) return cached.nearestEarningsDate;

  const url = `https://financialmodelingprep.com/stable/earnings?symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(fmpApiKey)}`;
  try {
    const resp = await httpGetJson(url, 8000);
    if (resp.status === 200 && Array.isArray(resp.data) && resp.data.length > 0) {
      const now = Date.now();
      const dates = resp.data
        .map((e) => (e?.date ? new Date(e.date).getTime() : null))
        .filter((ts) => ts !== null && Number.isFinite(ts));
      // Find the date (past or future) nearest to today
      const nearestEarningsDate = dates.reduce(
        (best, ts) => (Math.abs(ts - now) < Math.abs(best - now) ? ts : best),
        dates[0]
      );
      earningsCache.set(ticker, { nearestEarningsDate, expiresAt: now + EARNINGS_CACHE_TTL_MS });
      logger?.debug?.(
        `[live] earnings fetched ticker=${ticker} nearestDate=${new Date(nearestEarningsDate).toISOString().split("T")[0]} dates=${dates.length}`
      );
      return nearestEarningsDate;
    }
    // Empty/unexpected response → cache as null for 1h
    earningsCache.set(ticker, { nearestEarningsDate: null, expiresAt: Date.now() + EARNINGS_CACHE_ERROR_TTL_MS });
    return null;
  } catch (err) {
    logger?.warning?.(
      `[live] earnings fetch failed ticker=${ticker}: ${err?.message || String(err)} — earnings check skipped`
    );
    earningsCache.set(ticker, { nearestEarningsDate: null, expiresAt: Date.now() + EARNINGS_CACHE_ERROR_TTL_MS });
    return null;
  }
}

async function fetchEconomicCalendar(fmpApiKey, logger) {
  if (econCalendarCache.events && Date.now() < econCalendarCache.expiresAt) {
    return econCalendarCache.events;
  }
  const from = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const to   = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const url  = `https://financialmodelingprep.com/stable/economic-calendar?from=${from}&to=${to}&apikey=${encodeURIComponent(fmpApiKey)}`;
  try {
    const resp = await httpGetJson(url, 8000);
    if (resp.status === 200 && Array.isArray(resp.data)) {
      econCalendarCache = { events: resp.data, expiresAt: Date.now() + ECON_CAL_CACHE_TTL_MS };
      logger?.debug?.(`[live] economic calendar fetched events=${resp.data.length} from=${from} to=${to}`);
      return resp.data;
    }
    econCalendarCache = { events: [], expiresAt: Date.now() + ECON_CAL_ERROR_TTL_MS };
    return [];
  } catch (err) {
    logger?.warning?.(`[live] economic calendar fetch failed: ${err?.message || String(err)} — FOMC/macro guard skipped`);
    econCalendarCache = { events: [], expiresAt: Date.now() + ECON_CAL_ERROR_TTL_MS };
    return [];
  }
}

async function fetchNearestDividendExDate(ticker, fmpApiKey, logger) {
  const cached = dividendCache.get(ticker);
  if (cached && Date.now() < cached.expiresAt) return cached.nearestExDate;

  const url = `https://financialmodelingprep.com/stable/stock-dividends?symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(fmpApiKey)}`;
  try {
    const resp = await httpGetJson(url, 8000);
    if (resp.status === 200 && Array.isArray(resp.data) && resp.data.length > 0) {
      const now = Date.now();
      // Next upcoming ex-dividend date only (date >= today)
      const futureDates = resp.data
        .map((e) => (e?.date ? new Date(e.date).getTime() : null))
        .filter((ts) => ts !== null && Number.isFinite(ts) && ts >= now)
        .sort((a, b) => a - b);
      const nearestExDate = futureDates[0] ?? null;
      dividendCache.set(ticker, { nearestExDate, expiresAt: now + DIVIDEND_CACHE_TTL_MS });
      if (nearestExDate) {
        logger?.debug?.(
          `[live] dividend ex-date fetched ticker=${ticker} nextExDate=${new Date(nearestExDate).toISOString().split("T")[0]}`
        );
      }
      return nearestExDate;
    }
    dividendCache.set(ticker, { nearestExDate: null, expiresAt: Date.now() + DIVIDEND_ERROR_TTL_MS });
    return null;
  } catch (err) {
    logger?.warning?.(`[live] dividend fetch failed ticker=${ticker}: ${err?.message || String(err)} — dividend guard skipped`);
    dividendCache.set(ticker, { nearestExDate: null, expiresAt: Date.now() + DIVIDEND_ERROR_TTL_MS });
    return null;
  }
}

function minutesSinceMarketOpen(nowMs) {
  const [h, m] = MARKET_OPEN_UTC.split(":").map(Number);
  const todayOpen = new Date(nowMs);
  todayOpen.setUTCHours(h, m, 0, 0);
  return (nowMs - todayOpen.getTime()) / 60000;
}

// Simple HTTP GET helper (no axios dependency)
function httpGetJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, data: null }); }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error(`timeout after ${timeoutMs}ms`)); });
    req.on("error", reject);
  });
}

// Simple HTTP POST helper (no axios dependency)
function httpPostJson(url, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const data = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (url.startsWith("https") ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
      timeout: timeoutMs,
    };
    const req = lib.request(options, (res) => {
      let resBody = "";
      res.on("data", (chunk) => { resBody += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(resBody) }); }
        catch (e) { resolve({ status: res.statusCode, data: null }); }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error(`timeout after ${timeoutMs}ms`)); });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// --- Live state (singleton) ------------------------------------------------
const liveState = {
  active: false,
  pipeId: null,
  asOfDate: null,
  userId: null,
  tickers: new Set(),
  exchangeByTicker: new Map(),
  query: {},
  lastRunByTicker: new Map(),
  runningByTicker: new Set(),
  minIntervalMs: Number(process.env.LIVE_RECALC_INTERVAL_MS) || 60000,
  authHeaders: {},
  lastLiveByTicker: new Map(),
  lastAlertByKey: new Map(),
  lastFlagByTicker: new Map(),
  lastRiskOnCheck: { ts: 0, riskRegime: null, score: null },
  ibkrAccountCheck: { ts: 0, isPaper: null, accountId: null, ttlMs: 5 * 60 * 1000 },
  lastOpenBlockNotifByKey: new Map(),
  // Unified guard notification cooldown: key = `${alertKey}:${guardName}`
  lastEventBlockNotifByKey: new Map(),
};

const resetLiveState = () => {
  liveState.active = false;
  liveState.pipeId = null;
  liveState.asOfDate = null;
  liveState.userId = null;
  liveState.tickers = new Set();
  liveState.exchangeByTicker = new Map();
  liveState.lastRunByTicker.clear();
  liveState.runningByTicker.clear();
};

const activateLiveState = ({ pipeId, asOfDate, userId, tickers, exchangeByTicker, query, authHeaders }) => {
  liveState.active = true;
  liveState.pipeId = pipeId;
  liveState.asOfDate = asOfDate;
  liveState.userId = userId;
  liveState.tickers = new Set(tickers);
  liveState.exchangeByTicker = exchangeByTicker;
  liveState.query = { ...query };
  liveState.authHeaders = authHeaders;
  liveState.lastRunByTicker.clear();
  liveState.runningByTicker.clear();
};

const getLiveStatus = (pipeId) => ({
  ok: true,
  active: liveState.active && liveState.pipeId === pipeId,
  pipeId: liveState.pipeId,
  asOfDate: liveState.asOfDate,
  total: liveState.tickers.size,
  tickers: Array.from(liveState.tickers),
  minIntervalMs: liveState.minIntervalMs,
  updatedAt: new Date().toISOString(),
});

const buildEventEnvelope = ({
  serviceName,
  envName,
  eventId,
  severity = "info",
  correlationId,
  payload = {},
}) => ({
  eventKey: `${serviceName}.${eventId}`,
  eventId,
  service: serviceName,
  env: envName,
  ts: new Date().toISOString(),
  severity,
  correlationId,
  payload,
});

const publishEvent = async ({
  bus,
  logger,
  eventsChannel,
  serviceName,
  envName,
  eventId,
  severity,
  correlationId,
  payload,
}) => {
  if (!bus || typeof bus.publish !== "function") return;
  const envelope = buildEventEnvelope({
    serviceName,
    envName,
    eventId,
    severity,
    correlationId,
    payload,
  });
  await bus.publish(eventsChannel, envelope);
  logger?.info?.(
    `[live] event published ${envelope.eventKey} correlationId=${envelope.correlationId}`
  );
};

// --- updateSnapshotFlagsFromLive -------------------------------------------

const updateSnapshotFlagsFromLive = async (ticker, price, volume, dataMode, ts, liveData, deps) => {
  const {
    bus,
    logger,
    eventsChannel,
    hooksChannel,
    serviceName,
    envName,
    liquidityManagerUrl,
    cachemanagerUrl,
    brokerExecutorUrl,
    capitalManagerUrl,
    ibkrBridgeUrl,
  } = deps;
  if (!bus || typeof bus.get !== "function" || typeof bus.set !== "function") return false;
  if (!liveState.pipeId || !liveState.userId || !liveState.asOfDate) return false;

  const key = buildSpotFinderRedisKey(liveState.pipeId, liveState.userId, liveState.asOfDate);
  const payload = await bus.get(key);
  if (!payload || !Array.isArray(payload?.results)) return false;

  const results = payload.results;
  const idx = results.findIndex(
    (row) => String(row?.ticker || row?.symbol || "").toUpperCase() === ticker
  );
  if (idx === -1) return false;

  const current = results[idx] || {};
  const patternRoot = current?.signal?.pattern ? "signal" : current?.pattern ? "pattern" : null;
  const basePattern =
    patternRoot === "signal" ? current.signal.pattern : patternRoot === "pattern" ? current.pattern : null;
  if (!basePattern) return false;

  const breakLevel = asNumber(
    basePattern?.breakLevel ?? basePattern?.breakoutEntry?.breakLevel,
    null
  );
  const buffer = asNumber(basePattern?.breakoutEntry?.buffer, 0);
  const volumeThreshold = asNumber(basePattern?.breakoutEntry?.volumeThreshold, null);
  const priceOk =
    Number.isFinite(price) && Number.isFinite(breakLevel)
      ? price > breakLevel + buffer
      : false;
  const volumeOk = Number.isFinite(volumeThreshold)
    ? Number.isFinite(volume) && volume >= volumeThreshold
    : true;
  const breakoutOk = priceOk && volumeOk;
  const retracementEntryLimit = asNumber(current?.levels?.retracement?.entryLimit, null);
  const pullbackOk =
    Number.isFinite(price) && Number.isFinite(retracementEntryLimit)
      ? price <= retracementEntryLimit
      : false;

  const trendOk = basePattern?.trendOk ?? null;
  const flagOk = basePattern?.flagOk ?? null;
  const actionableBreakout = Boolean(trendOk && flagOk && breakoutOk);
  const actionablePullback = Boolean(trendOk && flagOk && pullbackOk);

  const prevFlags = liveState.lastFlagByTicker.get(ticker) || {};
  const nextFlags = { trendOk, flagOk, breakoutOk, pullbackOk };
  const changes = [];
  const transitions = [];
  ["trendOk", "flagOk", "breakoutOk", "pullbackOk"].forEach((flagKey) => {
    const prevValue = prevFlags[flagKey];
    const nextValue = nextFlags[flagKey];
    if (typeof prevValue === "boolean" && typeof nextValue === "boolean" && prevValue !== nextValue) {
      changes.push(`${flagKey}:${prevValue ? "OK" : "KO"}->${nextValue ? "OK" : "KO"}`);
      transitions.push({
        flag: flagKey,
        from: prevValue ? "OK" : "KO",
        to: nextValue ? "OK" : "KO",
      });
    }
  });
  liveState.lastFlagByTicker.set(ticker, nextFlags);

  const nextPattern = {
    ...basePattern,
    breakoutOk,
    pullbackOk,
    entryBreakoutSuggested:
      basePattern?.breakoutEntry?.entryTriggerPrice && volumeOk
        ? basePattern.breakoutEntry.entryTriggerPrice
        : null,
    breakoutEntry: basePattern?.breakoutEntry
      ? {
          ...basePattern.breakoutEntry,
          volumeObserved: Number.isFinite(volume) ? volume : null,
          volumeOk,
          entrySuggestion: volumeOk
            ? basePattern.breakoutEntry.entryTriggerPrice
            : null,
          note: volumeOk ? "volume ok (snapshot)" : "attendi conferma volumi",
        }
      : basePattern?.breakoutEntry,
    lastSnapshot: {
      ts: ts ?? Date.now(),
      price: Number.isFinite(price) ? price : null,
      volume: Number.isFinite(volume) ? volume : null,
      dataMode: dataMode || "snapshot",
    },
  };

  // NOTE: original code references `next` before declaration — preserving as-is
  // (this line would cause a ReferenceError if reached at runtime)
  // next.lastTouchAt = new Date().toISOString();

  const next = { ...current };
  const lastTouchAt = new Date().toISOString();
  next.lastTouchAt = lastTouchAt;

  if (patternRoot === "signal") {
    next.signal = { ...(current.signal || {}), pattern: nextPattern };
  } else {
    next.pattern = nextPattern;
  }

  if (next?.levels?.breakout) {
    next.levels = {
      ...next.levels,
      breakout: {
        ...next.levels.breakout,
        actionable: actionableBreakout,
        reason: actionableBreakout ? null : "snapshot conditions not met",
      },
      retracement: next.levels.retracement
        ? {
            ...next.levels.retracement,
            actionable: actionablePullback,
            reason: actionablePullback ? null : "snapshot conditions not met",
          }
        : next.levels.retracement,
    };
  }

  const nextResults = results.slice();
  nextResults[idx] = next;
  const updated = {
    ...(payload && typeof payload === "object" ? payload : {}),
    results: nextResults,
    stats: {
      ...(payload?.stats || {}),
      updatedAt: new Date().toISOString(),
    },
  };
  await bus.set(key, updated, { EX: SNAPSHOT_TTL_SECONDS });
  logger?.trace?.(
    `[live] lastTouchAt updated ticker=${ticker} key=${key} ts=${lastTouchAt} mode=${dataMode || "snapshot"}`
  );

  if (changes.length > 0) {
    const correlationId = randomUUID();
    try {
      await publishEvent({
        bus,
        logger,
        eventsChannel,
        serviceName,
        envName,
        eventId: "PRICEFLAG.CHANGED",
        severity: "info",
        correlationId,
        payload: {
          ticker,
          reason: "Flag values changed in live snapshot evaluation",
          changes,
          transitions,
          flags: nextFlags,
          dataMode: dataMode || "snapshot",
        },
      });
    } catch (err) {
      logger?.warning?.(
        `[live] event publish failed PRICEFLAG.CHANGED ${err?.message || String(err)}`
      );
    }
  }

  if (liveData) {
    const entryMode = actionableBreakout ? "breakout" : actionablePullback ? "pullback" : null;
    const levelsKey = entryMode === "pullback" ? "retracement" : entryMode;
    const entryBlock = levelsKey ? next.levels?.[levelsKey] : null;
    const entryLimit = asNumber(entryBlock?.entryLimit ?? entryBlock?.entry, null);
    const stopLoss = asNumber(entryBlock?.stopLoss, null);
    const takeProfit1 = asNumber(entryBlock?.takeProfit1, null);
    const takeProfit2 = asNumber(entryBlock?.takeProfit2, null);
    const livePrice = asNumber(liveData?.last ?? liveData?.ask ?? liveData?.bid, null);
    const liveVolume = asNumber(liveData?.volume, null);
    const liveVolumeThreshold =
      asNumber(nextPattern?.breakoutEntry?.volumeThreshold, null) ??
      asNumber(basePattern?.breakoutEntry?.volumeThreshold, null);

    if (entryMode && Number.isFinite(entryLimit) && Number.isFinite(livePrice)) {
      const volumeOkLive =
        !Number.isFinite(liveVolumeThreshold) || (Number.isFinite(liveVolume) && liveVolume >= liveVolumeThreshold);
      const priceOkLive = entryMode === "pullback" ? livePrice <= entryLimit : livePrice >= entryLimit;
      if (priceOkLive && volumeOkLive) {
        const alertKey = `${ticker}:${entryMode}:${entryLimit}`;
        const lastAlert = liveState.lastAlertByKey.get(alertKey) || 0;
        if (Date.now() - lastAlert > ALERT_COOLDOWN_MS) {

          // --- riskOn check (cached with TTL) ---
          let riskRegime = liveState.lastRiskOnCheck.riskRegime;
          let riskScore = liveState.lastRiskOnCheck.score;
          if (Date.now() - liveState.lastRiskOnCheck.ts > RISK_ON_TTL_MS) {
            const liqUrl = (liquidityManagerUrl || "http://liquidity-manager:3001").replace(/\/+$/, "");
            try {
              const resp = await httpGetJson(`${liqUrl}/liquidity-score`, 4000);
              if (resp.status === 200 && resp.data?.ok !== false) {
                riskRegime = resp.data?.riskRegime ?? null;
                riskScore = asNumber(resp.data?.score, null);
                liveState.lastRiskOnCheck = { ts: Date.now(), riskRegime, score: riskScore };
                logger?.info?.(
                  `[live] riskOn fetched: regime=${riskRegime} score=${riskScore}`
                );
              } else {
                logger?.warning?.(`[live] riskOn fetch returned status=${resp.status}`);
              }
            } catch (err) {
              logger?.warning?.(`[live] riskOn fetch failed: ${err?.message || String(err)}`);
            }
          }

          if (riskRegime && riskRegime !== "RISK_ON") {
            logger?.warning?.(
              `[live] BUY SIGNAL BLOCKED ticker=${ticker} mode=${entryMode.toUpperCase()} ` +
              `— riskRegime=${riskRegime} score=${riskScore} (not RISK_ON)`
            );
            return true;
          }

          // ----------------------------------------------------------------
          // Volatility event guards (earnings, FOMC, macro, dividend)
          // Each guard is independently enabled/disabled and configurable.
          // On block: logs WARNING, publishes hook + event, does NOT set
          // lastAlertByKey so the signal is re-evaluated each tick.
          // ----------------------------------------------------------------
          const fmpApiKey = process.env.FMP_API_KEY || "";
          const resolvedHooksChannelGuards = hooksChannel || `${envName}.hooks`;

          // Helper: publish block hook + event with cooldown per guard
          const publishGuardBlock = async ({ guardName, eventId, hookEvent, blockMsg, extraPayload }) => {
            const notifKey = `${alertKey}:${guardName}`;
            const lastNotif = liveState.lastEventBlockNotifByKey.get(notifKey) || 0;
            if (Date.now() - lastNotif > EVENT_BLOCK_NOTIF_COOLDOWN_MS) {
              liveState.lastEventBlockNotifByKey.set(notifKey, Date.now());
              const cid = randomUUID();
              const fullPayload = { ticker, entryMode, message: blockMsg, levels: { entryLimit, stopLoss, takeProfit1, takeProfit2 }, ...extraPayload };
              try {
                await bus.publish(resolvedHooksChannelGuards, { event: hookEvent, source: serviceName, ...fullPayload, ts: new Date().toISOString(), correlationId: cid });
              } catch (err) {
                logger?.warning?.(`[live] ${guardName}-block hook publish failed: ${err?.message || String(err)}`);
              }
              try {
                await publishEvent({ bus, logger, eventsChannel, serviceName, envName, eventId, severity: "warning", correlationId: cid, payload: fullPayload });
              } catch (err) {
                logger?.warning?.(`[live] ${guardName}-block event publish failed: ${err?.message || String(err)}`);
              }
            }
          };

          // --- Guard 1: Earnings proximity (all entry modes) ---
          if (guardConfig.earnings.enabled && fmpApiKey) {
            let nearestEarningsDate = null;
            try { nearestEarningsDate = await fetchNearestEarningsDate(ticker, fmpApiKey, logger); } catch (_) {}
            if (nearestEarningsDate !== null) {
              const daysToEarnings = Math.abs(Date.now() - nearestEarningsDate) / (24 * 60 * 60 * 1000);
              if (daysToEarnings <= guardConfig.earnings.blockDays) {
                const earningsDateStr = new Date(nearestEarningsDate).toISOString().split("T")[0];
                const blockMsg = `BUY SIGNAL BLOCCATO: earnings entro ${guardConfig.earnings.blockDays} giorni (data: ${earningsDateStr}, distanza: ${daysToEarnings.toFixed(1)} giorni)`;
                logger?.warning?.(`[live] EARNINGS PROXIMITY BLOCK ticker=${ticker} mode=${entryMode.toUpperCase()} — ${blockMsg}`);
                await publishGuardBlock({ guardName: "earnings", eventId: "ENTRY.EARNINGS_PROXIMITY_BLOCKED", hookEvent: "ENTRY_SIGNAL_BLOCKED_EARNINGS", blockMsg,
                  extraPayload: { earningsDate: earningsDateStr, daysToEarnings: parseFloat(daysToEarnings.toFixed(1)), blockDays: guardConfig.earnings.blockDays } });
                return true;
              }
            }
          }

          // --- Guard 2: FOMC proximity (all entry modes) ---
          if (guardConfig.fomc.enabled && fmpApiKey) {
            const fomcKeywords = ["fomc", "federal open market", "fed rate", "federal reserve rate"];
            const calEvents = await fetchEconomicCalendar(fmpApiKey, logger);
            const now = Date.now();
            const nearestFomc = calEvents
              .filter((e) => fomcKeywords.some((kw) => String(e?.event || e?.name || "").toLowerCase().includes(kw)))
              .map((e) => (e?.date ? new Date(e.date).getTime() : null))
              .filter((ts) => ts !== null && Number.isFinite(ts))
              .reduce((best, ts) => best === null || Math.abs(ts - now) < Math.abs(best - now) ? ts : best, null);
            if (nearestFomc !== null) {
              const daysToFomc = Math.abs(now - nearestFomc) / (24 * 60 * 60 * 1000);
              if (daysToFomc <= guardConfig.fomc.blockDays) {
                const fomcDateStr = new Date(nearestFomc).toISOString().split("T")[0];
                const blockMsg = `BUY SIGNAL BLOCCATO: FOMC entro ${guardConfig.fomc.blockDays} giorni (data: ${fomcDateStr}, distanza: ${daysToFomc.toFixed(1)} giorni)`;
                logger?.warning?.(`[live] FOMC PROXIMITY BLOCK ticker=${ticker} mode=${entryMode.toUpperCase()} — ${blockMsg}`);
                await publishGuardBlock({ guardName: "fomc", eventId: "ENTRY.FOMC_PROXIMITY_BLOCKED", hookEvent: "ENTRY_SIGNAL_BLOCKED_FOMC", blockMsg,
                  extraPayload: { fomcDate: fomcDateStr, daysToFomc: parseFloat(daysToFomc.toFixed(1)), blockDays: guardConfig.fomc.blockDays } });
                return true;
              }
            }
          }

          // --- Guard 3: Macro event proximity — CPI / NFP (all entry modes) ---
          if (guardConfig.macro.enabled && fmpApiKey) {
            const macroKeywords = ["cpi", "consumer price", "non-farm", "nonfarm", "nfp", "payroll"];
            const calEvents = await fetchEconomicCalendar(fmpApiKey, logger); // already cached
            const now = Date.now();
            const nearestMacro = calEvents
              .filter((e) => {
                const name = String(e?.event || e?.name || "").toLowerCase();
                const impact = String(e?.impact || "").toLowerCase();
                return impact === "high" && macroKeywords.some((kw) => name.includes(kw));
              })
              .map((e) => (e?.date ? new Date(e.date).getTime() : null))
              .filter((ts) => ts !== null && Number.isFinite(ts))
              .reduce((best, ts) => best === null || Math.abs(ts - now) < Math.abs(best - now) ? ts : best, null);
            if (nearestMacro !== null) {
              const daysToMacro = Math.abs(now - nearestMacro) / (24 * 60 * 60 * 1000);
              if (daysToMacro <= guardConfig.macro.blockDays) {
                const macroDateStr = new Date(nearestMacro).toISOString().split("T")[0];
                const blockMsg = `BUY SIGNAL BLOCCATO: evento macro ad alto impatto entro ${guardConfig.macro.blockDays} giorni (data: ${macroDateStr}, distanza: ${daysToMacro.toFixed(1)} giorni)`;
                logger?.warning?.(`[live] MACRO EVENT PROXIMITY BLOCK ticker=${ticker} mode=${entryMode.toUpperCase()} — ${blockMsg}`);
                await publishGuardBlock({ guardName: "macro", eventId: "ENTRY.MACRO_EVENT_PROXIMITY_BLOCKED", hookEvent: "ENTRY_SIGNAL_BLOCKED_MACRO", blockMsg,
                  extraPayload: { macroDate: macroDateStr, daysToMacro: parseFloat(daysToMacro.toFixed(1)), blockDays: guardConfig.macro.blockDays } });
                return true;
              }
            }
          }

          // --- Guard 4: Dividend ex-date proximity (all entry modes) ---
          if (guardConfig.dividend.enabled && fmpApiKey) {
            let nearestExDate = null;
            try { nearestExDate = await fetchNearestDividendExDate(ticker, fmpApiKey, logger); } catch (_) {}
            if (nearestExDate !== null) {
              const daysToEx = (nearestExDate - Date.now()) / (24 * 60 * 60 * 1000); // always >= 0 (future dates only)
              if (daysToEx >= 0 && daysToEx <= guardConfig.dividend.blockDays) {
                const exDateStr = new Date(nearestExDate).toISOString().split("T")[0];
                const blockMsg = `BUY SIGNAL BLOCCATO: ex-dividend date tra ${daysToEx.toFixed(1)} giorni (data: ${exDateStr})`;
                logger?.warning?.(`[live] DIVIDEND EX-DATE BLOCK ticker=${ticker} mode=${entryMode.toUpperCase()} — ${blockMsg}`);
                await publishGuardBlock({ guardName: "dividend", eventId: "ENTRY.DIVIDEND_PROXIMITY_BLOCKED", hookEvent: "ENTRY_SIGNAL_BLOCKED_DIVIDEND", blockMsg,
                  extraPayload: { exDate: exDateStr, daysToExDate: parseFloat(daysToEx.toFixed(1)), blockDays: guardConfig.dividend.blockDays } });
                return true;
              }
            }
          }

          // --- Candle range check (BREAKOUT only): range <= flagAtrK * atrLast ---
          let lastCandleRange = null;
          if (entryMode === "breakout" && cachemanagerUrl) {
            const atrLast = asNumber(basePattern?.debug?.atrLast, null);
            const flagAtrK = asNumber(current?.fullResult?.params?.flagAtrK, 1.3);
            if (Number.isFinite(atrLast) && atrLast > 0) {
              const cmUrl = cachemanagerUrl.replace(/\/+$/, "");
              try {
                const resp = await httpGetJson(
                  `${cmUrl}/candles/latest?symbol=${encodeURIComponent(ticker)}&tf=${encodeURIComponent(INTRADAY_TF)}`,
                  4000
                );
                if (resp.status === 200 && resp.data?.candle) {
                  const c = resp.data.candle;
                  const candleRange = asNumber(c.h ?? c.high, null) - asNumber(c.l ?? c.low, null);
                  const maxRange = flagAtrK * atrLast;
                  if (Number.isFinite(candleRange) && candleRange > maxRange) {
                    logger?.warning?.(
                      `[live] BUY SIGNAL BLOCKED ticker=${ticker} mode=BREAKOUT ` +
                      `— candle range=${candleRange.toFixed(4)} > flagAtrK*ATR=${maxRange.toFixed(4)} ` +
                      `(flagAtrK=${flagAtrK} atrLast=${atrLast.toFixed(4)} tf=${INTRADAY_TF})`
                    );
                    return true;
                  }
                  lastCandleRange = candleRange;
                  logger?.info?.(
                    `[live] candle range check OK ticker=${ticker} range=${Number.isFinite(candleRange) ? candleRange.toFixed(4) : "-"} maxRange=${maxRange.toFixed(4)} tf=${INTRADAY_TF}`
                  );
                } else if (resp.status === 404) {
                  logger?.info?.(
                    `[live] candle range check skipped ticker=${ticker} — no ${INTRADAY_TF} candle in cache`
                  );
                } else {
                  logger?.warning?.(
                    `[live] candle range check fetch status=${resp.status} ticker=${ticker}`
                  );
                }
              } catch (err) {
                logger?.warning?.(
                  `[live] candle range check fetch failed ticker=${ticker}: ${err?.message || String(err)}`
                );
              }
            }
          }

          // --- Opening volatility block (BREAKOUT only) ---
          if (entryMode === "breakout") {
            const minSinceOpen = minutesSinceMarketOpen(Date.now());
            if (minSinceOpen >= 0 && minSinceOpen < BREAKOUT_OPEN_BLOCK_MINUTES) {
              const minutesRemaining = Math.ceil(BREAKOUT_OPEN_BLOCK_MINUTES - minSinceOpen);
              const blockMsg =
                `Segnale ON al breakout ma volatilità alta in apertura aspetto ${BREAKOUT_OPEN_BLOCK_MINUTES} min` +
                ` (apertura da ${Math.floor(minSinceOpen)} min, ancora ${minutesRemaining} min)`;
              logger?.info?.(
                `[live] BREAKOUT OPEN BLOCK ticker=${ticker} — ${blockMsg}`
              );

              // Publish notification on hooks channel (rate-limited per alertKey)
              const lastNotif = liveState.lastOpenBlockNotifByKey.get(alertKey) || 0;
              if (Date.now() - lastNotif > OPEN_BLOCK_NOTIF_COOLDOWN_MS) {
                liveState.lastOpenBlockNotifByKey.set(alertKey, Date.now());
                const blockCorrelationId = randomUUID();
                const blockHookPayload = {
                  event: "ENTRY_SIGNAL_DEFERRED",
                  source: serviceName,
                  ticker,
                  entryMode: "breakout",
                  message: blockMsg,
                  minutesSinceOpen: Math.floor(minSinceOpen),
                  minutesRemaining,
                  blockMinutes: BREAKOUT_OPEN_BLOCK_MINUTES,
                  levels: { entryLimit, stopLoss, takeProfit1, takeProfit2 },
                  ts: new Date().toISOString(),
                  correlationId: blockCorrelationId,
                };
                const resolvedHooksChannel = hooksChannel || `${envName}.hooks`;
                try {
                  await bus.publish(resolvedHooksChannel, blockHookPayload);
                  logger?.info?.(
                    `[live] open-block hook published channel=${resolvedHooksChannel} ticker=${ticker}`
                  );
                } catch (err) {
                  logger?.warning?.(
                    `[live] open-block hook publish failed: ${err?.message || String(err)}`
                  );
                }
                try {
                  await publishEvent({
                    bus, logger, eventsChannel, serviceName, envName,
                    eventId: "ENTRY.BREAKOUT_OPEN_BLOCKED",
                    severity: "info",
                    correlationId: blockCorrelationId,
                    payload: {
                      ticker,
                      entryMode: "breakout",
                      message: blockMsg,
                      minutesSinceOpen: Math.floor(minSinceOpen),
                      minutesRemaining,
                      blockMinutes: BREAKOUT_OPEN_BLOCK_MINUTES,
                      levels: { entryLimit, stopLoss, takeProfit1, takeProfit2 },
                    },
                  });
                } catch (err) {
                  logger?.warning?.(
                    `[live] open-block event publish failed: ${err?.message || String(err)}`
                  );
                }
              }
              // Do NOT set lastAlertByKey — signal remains active for re-evaluation
              return true;
            }
          }

          liveState.lastAlertByKey.set(alertKey, Date.now());
          const parts = [
            `ENTRY ${ticker}`,
            `MODE=${entryMode.toUpperCase()}`,
            `LIMIT=${Number.isFinite(entryLimit) ? entryLimit.toFixed(4) : "-"}`,
            `SL=${Number.isFinite(stopLoss) ? stopLoss.toFixed(4) : "-"}`,
            `TP1=${Number.isFinite(takeProfit1) ? takeProfit1.toFixed(4) : "-"}`,
            `TP2=${Number.isFinite(takeProfit2) ? takeProfit2.toFixed(4) : "-"}`,
          ];
          const message = parts.join(" | ");

          // --- BUY SIGNAL log (INFO) ---
          logger?.info?.(
            `[live] BUY SIGNAL: ticker=${ticker} mode=${entryMode.toUpperCase()} ` +
            `limit=${Number.isFinite(entryLimit) ? entryLimit.toFixed(4) : "-"} ` +
            `sl=${Number.isFinite(stopLoss) ? stopLoss.toFixed(4) : "-"} ` +
            `tp1=${Number.isFinite(takeProfit1) ? takeProfit1.toFixed(4) : "-"} ` +
            `tp2=${Number.isFinite(takeProfit2) ? takeProfit2.toFixed(4) : "-"} | ` +
            `conditions: trendOk=${trendOk} flagOk=${flagOk} ${entryMode}Ok=true riskRegime=${riskRegime ?? "unknown"} | ` +
            `live: price=${livePrice} volume=${liveVolume} threshold=${liveVolumeThreshold}`
          );

          const correlationId = randomUUID();
          const hookPayload = {
            event: "ENTRY_SIGNAL",
            source: serviceName,
            ticker,
            entryMode,
            message,
            levels: {
              entryLimit,
              stopLoss,
              takeProfit1,
              takeProfit2,
            },
            conditions: {
              trendOk,
              flagOk,
              [`${entryMode}Ok`]: true,
              riskOnChecked: riskRegime !== null,
              riskRegime,
            },
            live: {
              price: livePrice,
              volume: liveVolume,
              threshold: liveVolumeThreshold,
            },
            ts: new Date().toISOString(),
            correlationId,
          };

          // --- Publish ENTRY.CONDITION_MET event ---
          try {
            await publishEvent({
              bus,
              logger,
              eventsChannel,
              serviceName,
              envName,
              eventId: "ENTRY.CONDITION_MET",
              severity: "info",
              correlationId,
              payload: {
                ticker,
                reason: "Live price and volume satisfy entry conditions",
                entryMode,
                message,
                levels: {
                  entryLimit,
                  stopLoss,
                  takeProfit1,
                  takeProfit2,
                },
                live: {
                  price: livePrice,
                  volume: liveVolume,
                  threshold: liveVolumeThreshold,
                },
                riskRegime,
                riskScore,
                candleRange: lastCandleRange,
              },
            });
          } catch (err) {
            logger?.warning?.(
              `[live] event publish failed ENTRY.CONDITION_MET ${err?.message || String(err)}`
            );
          }

          // --- Publish to HOOK channel (for alerting-manager) ---
          const resolvedHooksChannel = hooksChannel || `${envName}.hooks`;
          try {
            await bus.publish(resolvedHooksChannel, hookPayload);
            logger?.info?.(
              `[live] hook published channel=${resolvedHooksChannel} ticker=${ticker} mode=${entryMode}`
            );
          } catch (err) {
            logger?.warning?.(
              `[live] hook publish failed channel=${resolvedHooksChannel} ${err?.message || String(err)}`
            );
          }

          // --- Send bracket order to broker-executor-ibkr (fire-and-forget) ---
          if (brokerExecutorUrl && Number.isFinite(entryLimit) && Number.isFinite(stopLoss)) {
            (async () => {
              // --- GUARDRAIL: verify IBKR account is PAPER (DU prefix) before placing orders ---
              const now = Date.now();
              if (now - liveState.ibkrAccountCheck.ts > liveState.ibkrAccountCheck.ttlMs) {
                const bridgeUrl = (ibkrBridgeUrl || "http://ibkr-bridge:3017").replace(/\/+$/, "");
                try {
                  const resp = await httpGetJson(`${bridgeUrl}/accounts`, 5000);
                  if (resp.status === 200 && Array.isArray(resp.data)) {
                    const accounts = resp.data;
                    const firstId = String(
                      accounts[0]?.id || accounts[0]?.accountId || accounts[0]?.acctId || ""
                    ).toUpperCase();
                    const isPaper = firstId.startsWith("DU");
                    liveState.ibkrAccountCheck = {
                      ts: now,
                      isPaper,
                      accountId: firstId,
                      ttlMs: liveState.ibkrAccountCheck.ttlMs,
                    };
                    logger?.info?.(
                      `[live] ibkr account check accountId=${firstId} isPaper=${isPaper}`
                    );
                  } else {
                    liveState.ibkrAccountCheck = { ...liveState.ibkrAccountCheck, ts: now, isPaper: null, accountId: null };
                    logger?.warning?.(
                      `[live] ibkr account check failed status=${resp.status} — order BLOCKED (fail-closed)`
                    );
                  }
                } catch (err) {
                  liveState.ibkrAccountCheck = { ...liveState.ibkrAccountCheck, ts: now, isPaper: null, accountId: null };
                  logger?.warning?.(
                    `[live] ibkr account check error: ${err?.message || String(err)} — order BLOCKED (fail-closed)`
                  );
                }
              }

              if (liveState.ibkrAccountCheck.isPaper !== true) {
                logger?.error?.(
                  `[live] ORDER BLOCKED ticker=${ticker} — ibkr account is not PAPER ` +
                  `(accountId=${liveState.ibkrAccountCheck.accountId || "unknown"} isPaper=${liveState.ibkrAccountCheck.isPaper}). ` +
                  `Orders are only allowed on PAPER accounts (DU prefix).`
                );
                return;
              }

              // --- Step 1: Quote — ask capital-manager for maxInvestable ---
              const defaultDollars = Number(process.env.DE_DOLLARS_PER_TRADE) || 5000;
              let dollars = defaultDollars;
              let reservationId = null;
              const cmUserId = liveState.userId;

              if (capitalManagerUrl && cmUserId) {
                const cmUrl = capitalManagerUrl.replace(/\/+$/, "");

                // 1a. Quote
                let quoteOk = false;
                try {
                  const quotePayload = { userId: cmUserId, symbol: ticker, market: "US", clientRequestId: correlationId };
                  const quoteResp = await httpPostJson(`${cmUrl}/allocation/quote`, quotePayload, 8000);

                  if (quoteResp.status >= 200 && quoteResp.status < 300 && quoteResp.data?.ok) {
                    dollars = quoteResp.data.decision.maxInvestable;
                    quoteOk = true;
                    logger?.info?.(
                      `[live] capital-manager quote approved ticker=${ticker} maxInvestable=${dollars} | ${JSON.stringify(quoteResp.data.decision)}`
                    );
                  } else {
                    logger?.warning?.(
                      `[live] capital-manager quote REJECTED ticker=${ticker} — order BLOCKED | ${JSON.stringify(quoteResp.data)}`
                    );
                    return; // hard block — no order placed
                  }
                } catch (err) {
                  logger?.warning?.(
                    `[live] capital-manager quote error ticker=${ticker}: ${err?.message || String(err)} — using default $${defaultDollars}`
                  );
                  // fail-soft: continue with default dollars, no reservation
                }

                // 1b. Reserve — only if quote succeeded
                if (quoteOk) {
                  try {
                    const reservePayload = { userId: cmUserId, symbol: ticker, market: "US", currency: "USD", amount: dollars, clientRequestId: correlationId };
                    const reserveResp = await httpPostJson(`${cmUrl}/allocation/reserve`, reservePayload, 8000);

                    if (reserveResp.status >= 200 && reserveResp.status < 300 && reserveResp.data?.ok) {
                      reservationId = reserveResp.data.reservationId;
                      logger?.info?.(
                        `[live] capital-manager reserved ticker=${ticker} reservationId=${reservationId} amount=${dollars} | ${JSON.stringify(reserveResp.data)}`
                      );
                    } else {
                      logger?.warning?.(
                        `[live] capital-manager reserve failed ticker=${ticker} status=${reserveResp.status} — continuing without reservation | ${JSON.stringify(reserveResp.data)}`
                      );
                    }
                  } catch (err) {
                    logger?.warning?.(
                      `[live] capital-manager reserve error ticker=${ticker}: ${err?.message || String(err)} — continuing without reservation`
                    );
                  }
                }
              } else if (!capitalManagerUrl) {
                logger?.warning?.(
                  `[live] capital-manager not configured — using default $${defaultDollars} ticker=${ticker}`
                );
              }

              const quantity = Math.max(1, Math.floor(dollars / entryLimit));
              logger?.info?.(
                `[live] position sizing ticker=${ticker} dollars=${dollars} entryLimit=${entryLimit} quantity=${quantity}`
              );

              // --- Step 2: Place bracket order to broker ---
              const slLimitPrice = parseFloat((stopLoss * 0.998).toFixed(4));
              const orderPayload = {
                symbol: ticker,
                side: "BUY",
                quantity,
                limitPrice: entryLimit,
                stopLossPrice: stopLoss,
                stopLossLimitPrice: slLimitPrice,
                ...(Number.isFinite(takeProfit1) ? { takeProfitPrice: takeProfit1 } : {}),
                timeInForce: process.env.DE_ORDER_TIF || "DAY",
                externalCorrelationId: correlationId,
                decisionEngineRunId: correlationId,
              };
              const brokerUrl = brokerExecutorUrl.replace(/\/+$/, "");
              let orderAccepted = false;
              try {
                const resp = await httpPostJson(`${brokerUrl}/order`, orderPayload, 15000);
                if (resp.status >= 200 && resp.status < 300) {
                  orderAccepted = true;
                  logger?.info?.(
                    `[live] broker order placed orderId=${resp.data?.order?.orderId || "-"} ` +
                    `ticker=${ticker} mode=${entryMode} quantity=${quantity} dollars=${dollars} correlationId=${correlationId}`
                  );
                } else {
                  logger?.warning?.(
                    `[live] broker order rejected status=${resp.status} ticker=${ticker} ` +
                    `error=${JSON.stringify(resp.data)}`
                  );
                }
              } catch (err) {
                logger?.warning?.(
                  `[live] broker order error ticker=${ticker}: ${err?.message || String(err)}`
                );
              }

              // --- Step 3: Release reservation ---
              if (capitalManagerUrl && reservationId && cmUserId) {
                const cmUrl = capitalManagerUrl.replace(/\/+$/, "");
                const reason = orderAccepted ? "order_placed" : "order_rejected";
                try {
                  const releaseResp = await httpPostJson(
                    `${cmUrl}/allocation/release`,
                    { reservationId, userId: cmUserId, reason },
                    5000
                  );
                  logger?.info?.(
                    `[live] capital-manager released ticker=${ticker} reservationId=${reservationId} reason=${reason} | ${JSON.stringify(releaseResp.data)}`
                  );
                } catch (err) {
                  logger?.warning?.(
                    `[live] capital-manager release error ticker=${ticker} reservationId=${reservationId}: ${err?.message || String(err)}`
                  );
                }
              }
            })();
          }
        }
      }
    }
  }
  return true;
};

// --- Market data handler factory -------------------------------------------

function createMarketDataHandler(deps) {
  const {
    bus,
    logger,
    eventsChannel = `${process.env.ENV || process.env.APP_ENV || "DEV"}.${process.env.MICROSERVICE_NAME || "decision-engine"}.events`,
    hooksChannel,
    serviceName = process.env.MICROSERVICE_NAME || "decision-engine",
    envName = process.env.ENV || process.env.APP_ENV || "DEV",
    liquidityManagerUrl,
    cachemanagerUrl,
    brokerExecutorUrl,
    capitalManagerUrl,
    ibkrBridgeUrl,
  } = deps;

  return async (parsed, raw) => {
    if (!liveState.active) return;
    let parsedPayload =
      parsed && typeof parsed === "object" ? parsed : null;
    if (!parsedPayload && typeof raw === "string") {
      try {
        parsedPayload = JSON.parse(raw);
      } catch {
        parsedPayload = null;
      }
    }
    if (!parsedPayload) return;
    const dataMode = String(parsedPayload?.dataMode || parsedPayload?.mode || "").toLowerCase();

    const ticker = String(parsedPayload?.ticker || parsedPayload?.symbol || "").toUpperCase();
    if (!ticker || !liveState.tickers.has(ticker)) return;

    const marketPayload = parsedPayload?.payload || parsedPayload?.data || {};
    const last = asNumber(marketPayload?.[31] ?? marketPayload?.["31"], null);
    const bid = asNumber(marketPayload?.[84] ?? marketPayload?.["84"], null);
    const ask = asNumber(marketPayload?.[86] ?? marketPayload?.["86"], null);
    let volume = asNumber(marketPayload?.[7762] ?? marketPayload?.["7762"], null);
    if (!Number.isFinite(volume)) {
      volume = asNumber(marketPayload?.[87] ?? marketPayload?.["87"], null);
    }

    if (dataMode === "live") {
      liveState.lastLiveByTicker.set(ticker, {
        ts: parsedPayload?.ts ?? Date.now(),
        last,
        bid,
        ask,
        volume,
      });
      return;
    }

    if (dataMode !== "snapshot") return;

    const now = Date.now();
    const lastRun = liveState.lastRunByTicker.get(ticker) || 0;
    if (now - lastRun < liveState.minIntervalMs) return;
    if (liveState.runningByTicker.has(ticker)) return;

    const price = Number.isFinite(last) ? last : Number.isFinite(ask) ? ask : bid;
    if (!Number.isFinite(price)) return;

    liveState.lastRunByTicker.set(ticker, now);
    liveState.runningByTicker.add(ticker);

    try {
      const liveData = liveState.lastLiveByTicker.get(ticker) || {
        last,
        bid,
        ask,
        volume,
      };
      const updated = await updateSnapshotFlagsFromLive(
        ticker,
        price,
        volume,
        dataMode,
        parsedPayload?.ts,
        liveData,
        { bus, logger, eventsChannel, hooksChannel, serviceName, envName, liquidityManagerUrl, cachemanagerUrl, brokerExecutorUrl, capitalManagerUrl, ibkrBridgeUrl }
      );
      if (updated) {
        logger?.trace?.(
          `[live] ${ticker} snapshot price=${price} volume=${Number.isFinite(volume) ? volume : "-"}`
        );
      }
    } catch (err) {
      logger?.warning?.(
        `[live] ${ticker} snapshot update failed: ${err?.message || String(err)}`
      );
    } finally {
      liveState.runningByTicker.delete(ticker);
    }
  };
}

// --- Guard config runtime API ----------------------------------------------

function getGuardConfig() {
  return {
    earnings: { ...guardConfig.earnings },
    fomc:     { ...guardConfig.fomc },
    macro:    { ...guardConfig.macro },
    dividend: { ...guardConfig.dividend },
  };
}

function updateGuardConfig(patch) {
  if (!patch || typeof patch !== "object") throw new Error("patch must be an object");
  for (const name of ["earnings", "fomc", "macro", "dividend"]) {
    if (!patch[name] || typeof patch[name] !== "object") continue;
    const g = patch[name];
    if (typeof g.enabled === "boolean") guardConfig[name].enabled = g.enabled;
    const days = Number(g.blockDays);
    if (Number.isFinite(days) && days >= 0) guardConfig[name].blockDays = Math.round(days);
    // earnings also accepts blockWeeks as convenience
    if (name === "earnings") {
      const weeks = Number(g.blockWeeks);
      if (Number.isFinite(weeks) && weeks >= 0) guardConfig[name].blockDays = Math.round(weeks * 7);
    }
  }
  return getGuardConfig();
}

module.exports = {
  liveState,
  resetLiveState,
  activateLiveState,
  getLiveStatus,
  updateSnapshotFlagsFromLive,
  createMarketDataHandler,
  getGuardConfig,
  updateGuardConfig,
};
