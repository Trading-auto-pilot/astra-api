"use strict";

// ---------------------------------------------------------------------------
// live-manager – live state, market data handler, WhatsApp alerts
// ---------------------------------------------------------------------------

const axios = require("axios");
const {
  SNAPSHOT_TTL_SECONDS,
  ALERT_TIMEOUT_MS,
  ALERT_COOLDOWN_MS,
} = require("./constants");
const { asNumber } = require("./helpers");
const { buildSpotFinderRedisKey } = require("./job-manager");

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

// --- updateSnapshotFlagsFromLive -------------------------------------------

const updateSnapshotFlagsFromLive = async (ticker, price, volume, dataMode, ts, liveData, deps) => {
  const { bus, alertingserviceUrl, logger } = deps;
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
  const pullbackOk =
    Number.isFinite(price) && Number.isFinite(breakLevel)
      ? price >= breakLevel && price <= breakLevel + buffer
      : false;

  const trendOk = basePattern?.trendOk ?? null;
  const flagOk = basePattern?.flagOk ?? null;
  const actionableBreakout = Boolean(trendOk && flagOk && breakoutOk);
  const actionablePullback = Boolean(trendOk && flagOk && pullbackOk);

  const prevFlags = liveState.lastFlagByTicker.get(ticker) || {};
  const nextFlags = { trendOk, flagOk, breakoutOk, pullbackOk };
  const changes = [];
  ["trendOk", "flagOk", "breakoutOk", "pullbackOk"].forEach((flagKey) => {
    if (typeof prevFlags[flagKey] === "boolean" && prevFlags[flagKey] !== nextFlags[flagKey]) {
      changes.push(`${flagKey}:${prevFlags[flagKey]}->${nextFlags[flagKey]}`);
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
  next.lastTouchAt = new Date().toISOString();

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

  if (changes.length > 0) {
    const message = `FLAG CHANGE ${ticker} | ${changes.join(" | ")}`;
    try {
      await axios.post(
        `${alertingserviceUrl}/whatsapp/send`,
        { body: message },
        { headers: liveState.authHeaders, timeout: ALERT_TIMEOUT_MS }
      );
      logger?.info?.(`[live] whatsapp flag change ${message}`);
    } catch (err) {
      logger?.warning?.(
        `[live] whatsapp flag change failed ${err?.message || String(err)}`
      );
    }
  }

  if (liveData) {
    const entryMode = actionableBreakout ? "breakout" : actionablePullback ? "pullback" : null;
    const entryBlock = entryMode ? next.levels?.[entryMode] : null;
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
      const priceOkLive = livePrice >= entryLimit;
      if (priceOkLive && volumeOkLive) {
        const alertKey = `${ticker}:${entryMode}:${entryLimit}`;
        const lastAlert = liveState.lastAlertByKey.get(alertKey) || 0;
        if (Date.now() - lastAlert > ALERT_COOLDOWN_MS) {
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
          try {
            await axios.post(
              `${alertingserviceUrl}/whatsapp/send`,
              { body: message },
              { headers: liveState.authHeaders, timeout: ALERT_TIMEOUT_MS }
            );
            logger?.info?.(`[live] whatsapp sent ${message}`);
          } catch (err) {
            logger?.warning?.(
              `[live] whatsapp send failed ${err?.message || String(err)}`
            );
          }
        }
      }
    }
  }
  return true;
};

// --- Market data handler factory -------------------------------------------

function createMarketDataHandler(deps) {
  const { bus, alertingserviceUrl, logger } = deps;

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
        { bus, alertingserviceUrl, logger }
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

module.exports = {
  liveState,
  resetLiveState,
  activateLiveState,
  getLiveStatus,
  updateSnapshotFlagsFromLive,
  createMarketDataHandler,
};
