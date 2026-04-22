"use strict";

// ---------------------------------------------------------------------------
// job-manager – async job tracking + Redis snapshot persistence
// ---------------------------------------------------------------------------

const axios = require("axios");
const { reportJobDone } = require("../../shared/jobReporter");
const simClock = require("../../shared/simClock");
const {
  SNAPSHOT_TTL_SECONDS,
  SUBSCRIPTION_TIMEOUT_MS,
  MAX_CONCURRENCY,
  DEFAULT_CONCURRENCY,
  MIN_CONCURRENCY,
  RANKING_DAILY_PIPE_ID,
  RANKING_DAILY_MAX_ATR_PCT,
  RANKING_DAILY_REQUIRE_SMA50,
  RANKING_DAILY_REQUIRE_SMA200,
  VOL_TIER_LOW_THRESHOLD,
  VOL_TIER_HIGH_THRESHOLD,
  RANKING_DAILY_VOL_LOW,
  RANKING_DAILY_VOL_NORMAL,
  RANKING_DAILY_VOL_HIGH,
} = require("./constants");
const {
  asNumber,
  asBool,
  normalizeDateParam,
  resolveSnapshotDate,
  buildSymbolLogRef,
  pickAuthHeaders,
  isSupportNotAvailable,
  isTrendOk,
} = require("./helpers");

// --- In-memory job store ---------------------------------------------------
const asyncJobs = new Map();

const newJobId = () =>
  `spot_${simClock.now()}_${Math.random().toString(36).slice(2, 8)}`;

const getJob = (jobId) => asyncJobs.get(jobId);

const updateJob = (jobId, patch) => {
  const job = asyncJobs.get(jobId);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  return job;
};

const cancelJob = (jobId) => {
  const job = asyncJobs.get(jobId);
  if (!job) return null;
  if (job.status !== "running") return job;
  Object.assign(job, {
    status: "canceled",
    finishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return job;
};

// --- Redis key -------------------------------------------------------------
// ENV-aware: usa bus.key() per aggiungere il prefisso ambiente (PAPER, PROD, DEV, ...)
// così PAPER e PROD non condividono le stesse chiavi anche su istanze Redis condivise.
const buildSpotFinderRedisKey = (bus, pipeId, userId, asOfDate) =>
  bus?.key?.("spot-finder", pipeId, userId, asOfDate)
  ?? `spot-finder:${pipeId}:${userId}:${asOfDate}`;

// --- Snapshot CRUD ---------------------------------------------------------

const loadSnapshotResults = async (bus, pipeId, userId, dateParamRaw) => {
  if (!bus || typeof bus.get !== "function") {
    throw new Error("redis not available");
  }
  const snapshotDate = resolveSnapshotDate(dateParamRaw);
  const key = buildSpotFinderRedisKey(bus, pipeId, userId, snapshotDate);
  const payload = await bus.get(key);
  if (!payload) {
    return { snapshotDate, results: [] };
  }
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return { snapshotDate, results };
};

const persistSpotFinderSnapshot = async (bus, pipeId, userId, job, asOfDate, logger) => {
  if (!bus || typeof bus.set !== "function") return false;
  const key = buildSpotFinderRedisKey(bus, pipeId, userId, asOfDate);
  const payload = {
    pipeId,
    userId,
    asOfDate: asOfDate ?? null,
    jobId: job?.id ?? null,
    status: job?.status ?? null,
    stats: {
      total: job?.total ?? 0,
      processed: job?.processed ?? 0,
      remaining: Math.max(0, (job?.total ?? 0) - (job?.processed ?? 0)),
      ok: job?.ok ?? 0,
      errorCount: job?.errorCount ?? 0,
      cachedUsed: job?.cachedUsed ?? false,
      cachedCount: job?.cachedCount ?? 0,
      startedAt: job?.startedAt ?? null,
      updatedAt: job?.updatedAt ?? null,
      finishedAt: job?.finishedAt ?? null,
    },
    results: Array.isArray(job?.results) ? job.results : [],
    errors: Array.isArray(job?.errors) ? job.errors : [],
  };
  try {
    await bus.set(key, payload, { EX: SNAPSHOT_TTL_SECONDS });
    return true;
  } catch (err) {
    logger?.warning?.(
      `[decision-engine] redis snapshot failed ${err?.message || String(err)}`
    );
    return false;
  }
};

const updateSnapshotResult = async (bus, pipeId, userId, asOfDate, nextResult, logger) => {
  if (!bus || typeof bus.get !== "function" || typeof bus.set !== "function") return false;
  const key = buildSpotFinderRedisKey(bus, pipeId, userId, asOfDate);
  try {
    const payload = await bus.get(key);
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const errors = Array.isArray(payload?.errors) ? payload.errors : [];
    const ticker = String(nextResult?.ticker || nextResult?.symbol || "").toUpperCase();
    if (!ticker) return false;
    const nextResults = results.filter(
      (row) => String(row?.ticker || row?.symbol || "").toUpperCase() !== ticker
    );
    nextResults.push(nextResult);
    const updated = {
      ...(payload && typeof payload === "object" ? payload : {}),
      pipeId,
      userId,
      asOfDate,
      results: nextResults,
      errors,
      stats: {
        ...(payload?.stats || {}),
        updatedAt: new Date().toISOString(),
      },
    };
    await bus.set(key, updated, { EX: SNAPSHOT_TTL_SECONDS });
    return true;
  } catch (err) {
    logger?.warning?.(
      `[decision-engine] live snapshot update failed ${err?.message || String(err)}`
    );
    return false;
  }
};

// --- Ticker fetching -------------------------------------------------------

const fetchUserFundamentalsTickers = async (tickerscannerUrl, pipeId, headers, dateParam, timeout, logger) => {
  const dateValue = normalizeDateParam(dateParam);
  const qs = dateValue ? `?date=${encodeURIComponent(dateValue)}` : "";
  const url = `${tickerscannerUrl}/fundamentals/user-fundamentals-view/${encodeURIComponent(pipeId)}${qs}`;
  logger?.trace?.(
    `[decision-engine] fetchUserFundamentalsTickers ${JSON.stringify({
      pipeId,
      date: dateValue,
      url,
    })}`
  );
  const resp = await axios.get(url, { headers, timeout });
  const payload = resp?.data;
  const list = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : [];
  return list
    .map((row) => {
      const ticker = String(row?.ticker || row?.symbol || "").trim().toUpperCase();
      const exchange =
        row?.exchange ||
        row?.exchange_short ||
        row?.exchange_short_name ||
        row?.exchangeShortName ||
        row?.exchangeShort ||
        row?.exchangeName ||
        null;
      if (!ticker) return null;
      const isEtf = row?.is_etf != null ? Boolean(Number(row.is_etf)) : null;
      const asset_type = row?.asset_type ?? (isEtf === true ? "ETF" : isEtf === false ? "EQUITY" : null);
      return { ticker, exchange: exchange ? String(exchange).trim() : null, asset_type };
    })
    .filter(Boolean);
};

// buildRankingDailyParams — derive adaptive spot-finder params from ranking daily meta
// Returns an extraParams object to merge into the spot-finder query for pipeId=0
const buildRankingDailyParams = (meta) => {
  if (!meta) return {};
  const result = {};

  // Level 2: pass current price so spot-finder uses it as priceRef
  if (meta.price != null && Number.isFinite(Number(meta.price))) {
    result.currentPrice = Number(meta.price);
  }

  // Level 3: adaptive params based on volatility tier
  const atrPct = meta.atr_14_pct;
  if (Number.isFinite(atrPct)) {
    let tier;
    if (atrPct < VOL_TIER_LOW_THRESHOLD)       tier = RANKING_DAILY_VOL_LOW;
    else if (atrPct >= VOL_TIER_HIGH_THRESHOLD) tier = RANKING_DAILY_VOL_HIGH;
    else                                         tier = RANKING_DAILY_VOL_NORMAL;
    Object.assign(result, tier);
  }

  return result;
};

// fetchRankingDailyTickers — virtual pipe 0
// Reads tickers from AST_RANKING_DAILY via GET /fundamentals/ranking/daily?score_date=YYYY-MM-DD
// Applies pre-filter rules and enriches each entry with meta for adaptive params.
const fetchRankingDailyTickers = async (tickerscannerUrl, dateParam, timeout, logger, filterOpts = {}) => {
  const {
    maxAtrPct   = RANKING_DAILY_MAX_ATR_PCT,
    requireSma50  = RANKING_DAILY_REQUIRE_SMA50,
    requireSma200 = RANKING_DAILY_REQUIRE_SMA200,
  } = filterOpts;

  const dateValue = normalizeDateParam(dateParam);
  if (!dateValue) throw new Error("score_date is required for ranking daily pipe (pipeId=0)");
  const url = `${tickerscannerUrl}/fundamentals/ranking/daily?score_date=${encodeURIComponent(dateValue)}`;
  logger?.trace?.(
    `[decision-engine] fetchRankingDailyTickers ${JSON.stringify({ date: dateValue, url })}`
  );
  const resp = await axios.get(url, { timeout });
  const payload = resp?.data;
  const list = Array.isArray(payload?.items) ? payload.items
             : Array.isArray(payload?.data)  ? payload.data
             : Array.isArray(payload)         ? payload
             : [];

  const result = [];
  let skipped = 0;

  for (const row of list) {
    const ticker = String(row?.symbol || "").trim().toUpperCase();
    if (!ticker) continue;

    const reason = row?.reason_json || {};
    const atrPct = reason?.atr_14_pct ?? null;
    const trend  = reason?.trend || {};

    // Safety rule: atr_14_pct missing → skip (no sizing basis)
    if (atrPct === null || !Number.isFinite(Number(atrPct))) {
      logger?.debug?.(`[fetchRankingDailyTickers] skip ${ticker}: atr_14_pct missing`);
      skipped++;
      continue;
    }

    // Safety rule: atr_14_pct too high → unreliable zones
    if (Number(atrPct) > maxAtrPct) {
      logger?.debug?.(`[fetchRankingDailyTickers] skip ${ticker}: atr_14_pct=${atrPct} > ${maxAtrPct}`);
      skipped++;
      continue;
    }

    // Optional: trend filter SMA50
    if (requireSma50 && trend?.price_gt_sma50 === false) {
      logger?.debug?.(`[fetchRankingDailyTickers] skip ${ticker}: price below SMA50`);
      skipped++;
      continue;
    }

    // Optional: golden cross filter
    if (requireSma200 && trend?.sma50_gt_sma200 === false) {
      logger?.debug?.(`[fetchRankingDailyTickers] skip ${ticker}: SMA50 below SMA200`);
      skipped++;
      continue;
    }

    result.push({
      ticker,
      exchange: null,
      asset_type: row?.asset_type ?? null,
      meta: {
        price:        reason?.price ?? null,
        atr_14_pct:   Number(atrPct),
        trend: {
          price_gt_sma50:   trend?.price_gt_sma50  ?? null,
          sma50_gt_sma200:  trend?.sma50_gt_sma200 ?? null,
        },
      },
    });
  }

  if (skipped > 0) {
    logger?.info?.(`[fetchRankingDailyTickers] pre-filter: ${result.length} passed, ${skipped} skipped`);
  }

  return result;
};

const applyPipeLimit = (list, query) => {
  const raw = asNumber(query?.limit, null);
  if (!Number.isFinite(raw) || raw <= 0) return list;
  return list.slice(0, Math.min(list.length, Math.floor(raw)));
};

const autoSubscribeTrendTickers = async ({
  marketdataserviceUrl,
  headers,
  results,
  logger,
}) => {
  if (!marketdataserviceUrl) return { ok: false, subscribed: 0, reason: "marketdataserviceUrl missing" };
  const trendTickers = (Array.isArray(results) ? results : [])
    .filter((row) => isTrendOk(row))
    .map((row) => String(row?.ticker || row?.symbol || "").trim().toUpperCase())
    .filter(Boolean);
  const deduped = Array.from(new Set(trendTickers));
  if (!deduped.length) {
    logger?.info?.("[decision-engine] auto-subscribe skipped: no trendOk tickers");
    return { ok: true, subscribed: 0 };
  }
  await axios.post(
    `${marketdataserviceUrl}/subscriptions`,
    { tickers: deduped },
    { headers, timeout: SUBSCRIPTION_TIMEOUT_MS }
  );
  logger?.info?.(
    `[decision-engine] auto-subscribed trend tickers count=${deduped.length}`
  );
  return { ok: true, subscribed: deduped.length, tickers: deduped };
};

// --- Async job runner ------------------------------------------------------

/**
 * @param {object} opts
 * @param {object} opts.bus             - Redis bus instance
 * @param {number} opts.pipeId
 * @param {number} opts.userId
 * @param {object} opts.query           - req.query
 * @param {object} opts.req             - Express request
 * @param {string} opts.decisionengineUrl
 * @param {string} opts.marketdataserviceUrl
 * @param {string} opts.tickerscannerUrl
 * @param {number} opts.cacheManagerTimeoutMs
 * @param {number} opts.tickerscannerTimeoutMs
 * @param {object} opts.relaxedSpotFinderParams
 * @param {object} [opts.logger]
 */
const startAsyncJob = async (opts) => {
  const {
    bus,
    statusChannel,
    pipeId,
    userId,
    query,
    req,
    decisionengineUrl,
    marketdataserviceUrl,
    tickerscannerUrl,
    cacheManagerTimeoutMs,
    tickerscannerTimeoutMs,
    relaxedSpotFinderParams,
    logger,
  } = opts;

  const runSpotFinderForTicker = async (ticker, q, request, exchangeOverride, relaxed, extraParams = {}) => {
    const params = { ...q, ticker, ...extraParams };
    if (exchangeOverride && !params.exchange) {
      params.exchange = exchangeOverride;
    }
    if (relaxed) {
      Object.assign(params, relaxedSpotFinderParams);
    }
    const headers = pickAuthHeaders(request);
    const resp = await axios.get(`${decisionengineUrl}/spot-finder`, {
      params,
      headers,
      timeout: cacheManagerTimeoutMs,
    });
    return resp?.data;
  };

  const jobId = newJobId();
  const now = new Date().toISOString();
  const useCache = asBool(query?.cache, false);
  const dateParamRaw = req.query?.date || req.query?.asOfDate || req.query?.scoreDate || null;
  const snapshotDate = resolveSnapshotDate(dateParamRaw);
  const job = {
    id: jobId,
    pipeId,
    userId,
    asOfDate: snapshotDate,
    useCache,
    status: "running",
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: null,
    total: 0,
    processed: 0,
    ok: 0,
    errorCount: 0,
    results: [],
    errors: [],
    query,
  };
  asyncJobs.set(jobId, job);
  if (userId) {
    await persistSpotFinderSnapshot(bus, pipeId, userId, job, snapshotDate, logger);
  }

  const dateParam = normalizeDateParam(dateParamRaw);
  const headers = pickAuthHeaders(req);
  const liveSubscribedTickers = new Set();
  const subscribeTrendTicker = async (ticker) => {
    const normalized = String(ticker || "").trim().toUpperCase();
    if (!normalized) return;
    if (!marketdataserviceUrl) return;
    if (liveSubscribedTickers.has(normalized)) return;
    await axios.post(
      `${marketdataserviceUrl}/subscriptions`,
      { tickers: [normalized] },
      { headers, timeout: SUBSCRIPTION_TIMEOUT_MS }
    );
    liveSubscribedTickers.add(normalized);
    logger?.info?.(
      `[decision-engine] live auto-subscribe ticker=${normalized} source=spot-finder-job`
    );
  };
  const tickers = applyPipeLimit(
    pipeId === RANKING_DAILY_PIPE_ID
      ? await fetchRankingDailyTickers(tickerscannerUrl, dateParam, tickerscannerTimeoutMs, logger)
      : await fetchUserFundamentalsTickers(tickerscannerUrl, pipeId, headers, dateParam, tickerscannerTimeoutMs, logger),
    query
  );
  let cachedResults = [];
  let cachedErrors = [];
  let cachedTickers = new Set();
  let cachedCount = 0;
  if (useCache && userId) {
    if (bus && typeof bus.get === "function") {
      try {
        const key = buildSpotFinderRedisKey(bus, pipeId, userId, snapshotDate);
        const snapshot = await bus.get(key);
        if (snapshot && Array.isArray(snapshot.results)) {
          const snapshotResults = snapshot.results;
          const snapshotErrors = Array.isArray(snapshot.errors) ? snapshot.errors : [];
          const resultErrors = snapshotResults
            .filter((r) => r?.error)
            .map((r) => ({
              ticker: r?.ticker || "",
              error: r?.error || "spot-finder failed",
            }));
          cachedResults = snapshotResults.filter((r) => !r?.error);
          cachedErrors = [...snapshotErrors, ...resultErrors];
          cachedTickers = new Set(
            cachedResults.map((r) => String(r?.ticker || "").toUpperCase()).filter(Boolean)
          );
          cachedCount = cachedResults.length + cachedErrors.length;
          job.results.push(...cachedResults);
          job.errors.push(...cachedErrors);
          job.ok = cachedResults.length;
          job.errorCount = cachedErrors.length;
        }
      } catch (err) {
        logger?.warning?.(
          `[decision-engine] cache snapshot read failed ${err?.message || String(err)}`
        );
      }
    }
  }

  const pendingTickers = tickers.filter((entry) => {
    const ticker = (entry?.ticker || entry || "").toString().toUpperCase();
    return ticker && !cachedTickers.has(ticker);
  });

  job.total = tickers.length;
  job.processed = job.ok + job.errorCount;
  job.cachedUsed = useCache;
  job.cachedCount = cachedCount;
  updateJob(jobId, {
    total: tickers.length,
    processed: job.processed,
    ok: job.ok,
    errorCount: job.errorCount,
    cachedUsed: useCache,
    cachedCount,
  });
  if (!tickers.length) {
    updateJob(jobId, { status: "completed", finishedAt: new Date().toISOString() });
    if (userId) {
      await persistSpotFinderSnapshot(bus, pipeId, userId, job, snapshotDate, logger);
    }
    try {
      await autoSubscribeTrendTickers({
        marketdataserviceUrl,
        headers,
        results: job.results,
        logger,
      });
    } catch (err) {
      logger?.warning?.(
        `[decision-engine] auto-subscribe failed ${err?.message || String(err)}`
      );
    }
    reportJobDone(bus, statusChannel, jobId, {
      status: "COMPLETED",
      summary: {
        pipeId,
        userId,
        total: job.total,
        processed: job.processed,
        ok: job.ok,
        errors: job.errorCount,
        cachedUsed: job.cachedUsed ?? false,
        cachedCount: job.cachedCount ?? 0,
      },
    });
    return jobId;
  }

  if (pendingTickers.length === 0) {
    updateJob(jobId, { status: "completed", finishedAt: new Date().toISOString() });
    if (userId) {
      await persistSpotFinderSnapshot(bus, pipeId, userId, job, snapshotDate, logger);
    }
    try {
      await autoSubscribeTrendTickers({
        marketdataserviceUrl,
        headers,
        results: job.results,
        logger,
      });
    } catch (err) {
      logger?.warning?.(
        `[decision-engine] auto-subscribe failed ${err?.message || String(err)}`
      );
    }
    reportJobDone(bus, statusChannel, jobId, {
      status: "COMPLETED",
      summary: {
        pipeId,
        userId,
        total: job.total,
        processed: job.processed,
        ok: job.ok,
        errors: job.errorCount,
        cachedUsed: job.cachedUsed ?? false,
        cachedCount: job.cachedCount ?? 0,
      },
    });
    return jobId;
  }

  const concurrency = Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, asNumber(query.concurrency, DEFAULT_CONCURRENCY)));
  let index = 0;
  const runNext = async () => {
    const active = getJob(jobId);
    if (!active || active.status !== "running") return;
    if (index >= pendingTickers.length) return;
    const entry = pendingTickers[index++];
    const ticker = entry?.ticker || entry;
    const logRef = buildSymbolLogRef(ticker, snapshotDate);
    const exchange = entry?.exchange || null;
    const extraParams = pipeId === RANKING_DAILY_PIPE_ID
      ? buildRankingDailyParams(entry?.meta)
      : {};
    try {
      logger?.info?.(
        `[decision-engine] pipe execution start ticker=${ticker} snapshotDate=${snapshotDate} logRef=${logRef} pipeId=${pipeId} jobId=${jobId}`
      );
      let data = await runSpotFinderForTicker(ticker, query, req, exchange, false, extraParams);
      if (data?.ok === false && isSupportNotAvailable(data)) {
        data = await runSpotFinderForTicker(ticker, query, req, exchange, true, extraParams);
      }
      const errorMessage =
        data?.ok === false ? data?.error || data?.message || "spot-finder failed" : null;
      job.results.push({
        ticker,
        exchange,
        asset_type: entry?.asset_type ?? null,
        currentPrice: data?.priceRef ?? null,
        levels: {
          retracement: data?.levels?.retracement ?? null,
          breakout: data?.levels?.breakout ?? null,
        },
        fullResult: data ?? null,
        ...(errorMessage ? { error: errorMessage } : {}),
      });
      if (errorMessage) {
        job.errorCount += 1;
        logger?.warning?.(
          `[decision-engine] pipe execution completed with error ticker=${ticker} snapshotDate=${snapshotDate} logRef=${logRef} pipeId=${pipeId} jobId=${jobId} error=${errorMessage}`
        );
      } else {
        job.ok += 1;
        logger?.info?.(
          `[decision-engine] pipe execution completed ticker=${ticker} snapshotDate=${snapshotDate} logRef=${logRef} pipeId=${pipeId} jobId=${jobId}`
        );
        if (isTrendOk({ ticker, fullResult: data })) {
          try {
            await subscribeTrendTicker(ticker);
          } catch (err) {
            logger?.warning?.(
              `[decision-engine] live auto-subscribe failed ticker=${ticker}: ${err?.message || String(err)}`
            );
          }
        }
      }
    } catch (err) {
      logger?.warning?.(
        `[decision-engine] pipe execution failed ticker=${ticker} snapshotDate=${snapshotDate} logRef=${logRef} pipeId=${pipeId} jobId=${jobId} error=${err?.response?.data?.error || err?.message || String(err)}`
      );
      job.errors.push({
        ticker,
        error: err?.response?.data?.error || err?.message || String(err),
        params: job.query || {},
      });
      job.errorCount += 1;
    } finally {
      job.processed += 1;
      updateJob(jobId, {
        processed: job.processed,
        ok: job.ok,
        errorCount: job.errorCount,
      });
      if (userId) {
        await persistSpotFinderSnapshot(bus, pipeId, userId, job, snapshotDate, logger);
      }
    }
    await runNext();
  };

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(runNext());
  Promise.all(workers)
    .then(async () => {
      const active = getJob(jobId);
      if (!active || active.status !== "running") return;
      updateJob(jobId, { status: "completed", finishedAt: new Date().toISOString() });
      if (userId) {
        persistSpotFinderSnapshot(bus, pipeId, userId, job, snapshotDate, logger);
      }
      try {
        await autoSubscribeTrendTickers({
          marketdataserviceUrl,
          headers,
          results: job.results,
          logger,
        });
      } catch (err) {
        logger?.warning?.(
          `[decision-engine] auto-subscribe failed ${err?.message || String(err)}`
        );
      }
      reportJobDone(bus, statusChannel, jobId, {
        status: "COMPLETED",
        summary: {
          pipeId,
          userId,
          total: job.total,
          processed: job.processed,
          ok: job.ok,
          errors: job.errorCount,
          cachedUsed: job.cachedUsed ?? false,
          cachedCount: job.cachedCount ?? 0,
        },
      });
    })
    .catch((err) => {
      updateJob(jobId, {
        status: "error",
        finishedAt: new Date().toISOString(),
        error: err?.message || String(err),
      });
      if (userId) {
        persistSpotFinderSnapshot(bus, pipeId, userId, job, snapshotDate, logger);
      }
      reportJobDone(bus, statusChannel, jobId, {
        status: "FAILED",
        summary: {
          pipeId,
          userId,
          total: job.total,
          processed: job.processed,
          ok: job.ok,
          errors: job.errorCount,
          cachedUsed: job.cachedUsed ?? false,
          cachedCount: job.cachedCount ?? 0,
        },
        error: err?.message || String(err),
      });
    });

  return jobId;
};

module.exports = {
  asyncJobs,
  newJobId,
  getJob,
  updateJob,
  cancelJob,
  buildSpotFinderRedisKey,
  loadSnapshotResults,
  persistSpotFinderSnapshot,
  updateSnapshotResult,
  fetchUserFundamentalsTickers,
  buildRankingDailyParams,
  fetchRankingDailyTickers,
  applyPipeLimit,
  startAsyncJob,
};
