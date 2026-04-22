"use strict";

/**
 * spotFinderOrchestrator.js
 *
 * Business-logic functions for the spot-finder feature.
 * All dependencies are passed explicitly — no closure captures.
 *
 * Exported functions:
 *  - handlePipeSpotFinder(req, res, deps, userIdOverride?)
 *  - startAsyncSpotFinder(req, res, deps, userIdOverride?)
 *  - runSpotFinderForTicker(ticker, query, req, exchange, relaxed, extraParams, deps)
 *  - runLiveSnapshot(req, pipeId, userId, deps)
 *  - stopLive(req, res, deps, userIdOverride?)
 */

const axios = require("axios");
const C = require("./constants");
const {
  asNumber,
  normalizeDateParam,
  resolveSnapshotDate,
  buildSymbolLogRef,
  pickAuthHeaders,
  isTrendOk,
  isSupportNotAvailable,
} = require("./helpers");
const {
  cancelJob,
  buildSpotFinderRedisKey,
  loadSnapshotResults,
  persistSpotFinderSnapshot,
  fetchUserFundamentalsTickers,
  buildRankingDailyParams,
  fetchRankingDailyTickers,
  applyPipeLimit,
  startAsyncJob,
} = require("./job-manager");
const { reportJobDone } = require("../../shared/jobReporter");
const { liveState, resetLiveState, activateLiveState } = require("./live-manager");

// ---------------------------------------------------------------------------
// handlePipeSpotFinder — sync pipe execution (GET /:pipeId)
// ---------------------------------------------------------------------------
async function handlePipeSpotFinder(req, res, deps, userIdOverride) {
  const {
    bus, resolveService, logger, tickerscannerUrl, marketdataserviceUrl,
    decisionengineUrl, cacheManagerTimeoutMs, tickerscannerTimeoutMs,
    relaxedSpotFinderParams, resolveUserId,
  } = deps;

  const pipeId = Number(String(req.params.pipeId || "").trim());
  if (!Number.isFinite(pipeId)) {
    return res.status(400).json({ ok: false, error: "pipeId must be a number" });
  }
  if (Number.isFinite(Number(userIdOverride))) {
    req._internalUserId = Number(userIdOverride);
    if (!req.headers["x-user-id"]) req.headers["x-user-id"] = String(userIdOverride);
  }
  const userId = await resolveUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: "userId not available" });
  }

  try {
    const dateParamRaw = req.query?.date || req.query?.asOfDate || req.query?.scoreDate || null;
    const dateParam = normalizeDateParam(dateParamRaw);
    const snapshotDate = resolveSnapshotDate(dateParamRaw);
    const headers = pickAuthHeaders(req);
    const tickers = applyPipeLimit(
      pipeId === C.RANKING_DAILY_PIPE_ID
        ? await fetchRankingDailyTickers(tickerscannerUrl, dateParam, tickerscannerTimeoutMs, logger)
        : await fetchUserFundamentalsTickers(tickerscannerUrl, pipeId, headers, dateParam, tickerscannerTimeoutMs, logger),
      req.query
    );

    if (!tickers.length) {
      const emptyPayload = { ok: true, pipeId, count: 0, results: [], errors: [] };
      await persistSpotFinderSnapshot(
        bus(),
        pipeId,
        userId,
        {
          id: null, status: "completed", total: 0, processed: 0, ok: 0, errorCount: 0,
          results: [], errors: [], startedAt: null,
          updatedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        },
        snapshotDate,
        logger
      );
      return res.json(emptyPayload);
    }

    const results = [];
    const errors = [];
    const concurrency = Math.max(
      C.MIN_CONCURRENCY,
      Math.min(C.MAX_CONCURRENCY, asNumber(req.query.concurrency, C.DEFAULT_CONCURRENCY))
    );
    let index = 0;
    const runNext = async () => {
      if (index >= tickers.length) return;
      const entry = tickers[index++];
      const ticker = entry?.ticker || entry;
      const logRef = buildSymbolLogRef(ticker, snapshotDate);
      const exchange = entry?.exchange || null;
      const extraParams = pipeId === C.RANKING_DAILY_PIPE_ID
        ? buildRankingDailyParams(entry?.meta)
        : {};
      try {
        logger?.info?.(
          `[decision-engine] sync pipe execution start ticker=${ticker} snapshotDate=${snapshotDate} logRef=${logRef} pipeId=${pipeId}`
        );
        let data = await runSpotFinderForTicker(ticker, req.query, req, exchange, false, extraParams, deps);
        if (data?.ok === false && isSupportNotAvailable(data)) {
          data = await runSpotFinderForTicker(ticker, req.query, req, exchange, true, extraParams, deps);
        }
        const errorMessage =
          data?.ok === false ? data?.error || data?.message || "spot-finder failed" : null;
        results.push({
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
          errors.push({ ticker, error: errorMessage });
          logger?.warning?.(
            `[decision-engine] sync pipe execution completed with error ticker=${ticker} snapshotDate=${snapshotDate} logRef=${logRef} pipeId=${pipeId} error=${errorMessage}`
          );
        } else {
          logger?.info?.(
            `[decision-engine] sync pipe execution completed ticker=${ticker} snapshotDate=${snapshotDate} logRef=${logRef} pipeId=${pipeId}`
          );
        }
      } catch (err) {
        logger?.warning?.(
          `[decision-engine] sync pipe execution failed ticker=${ticker} snapshotDate=${snapshotDate} logRef=${logRef} pipeId=${pipeId} error=${err?.response?.data?.error || err?.message || String(err)}`
        );
        errors.push({
          ticker,
          error: err?.response?.data?.error || err?.message || String(err),
          params: req.query || {},
        });
      }
      await runNext();
    };

    const workers = [];
    for (let i = 0; i < concurrency; i++) workers.push(runNext());
    await Promise.all(workers);

    const payload = { ok: true, pipeId, count: results.length, results, errors };
    await persistSpotFinderSnapshot(
      bus(),
      pipeId,
      userId,
      {
        id: null, status: "completed", total: tickers.length,
        processed: results.length + errors.length, ok: results.length,
        errorCount: errors.length, results, errors, startedAt: null,
        updatedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      },
      snapshotDate,
      logger
    );

    // Auto-subscribe trendOk tickers to market-data-service
    try {
      const trendTickers = results
        .filter((row) => isTrendOk(row))
        .map((row) => String(row?.ticker || row?.symbol || "").trim().toUpperCase())
        .filter(Boolean);
      const deduped = Array.from(new Set(trendTickers));
      if (deduped.length) {
        await axios.post(
          `${marketdataserviceUrl}/subscriptions`,
          { tickers: deduped },
          { headers, timeout: C.SUBSCRIPTION_TIMEOUT_MS }
        );
        logger?.info?.(
          `[decision-engine] auto-subscribed trend tickers count=${deduped.length} route=GET /spot-finder/:pipeId`
        );
      } else {
        logger?.info?.(
          "[decision-engine] auto-subscribe skipped: no trendOk tickers route=GET /spot-finder/:pipeId"
        );
      }
    } catch (err) {
      logger?.warning?.(
        `[decision-engine] auto-subscribe failed route=GET /spot-finder/:pipeId: ${err?.message || String(err)}`
      );
    }

    return res.json(payload);
  } catch (err) {
    logger?.error?.(
      `[decision-engine] spot-finder pipe error: ${err?.message || String(err)}`
    );
    return res.status(502).json({
      ok: false,
      error: "tickerscanner request failed",
      details: err?.response?.data || err?.message || String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// startAsyncSpotFinder — start async job (POST /:pipeId)
// ---------------------------------------------------------------------------
async function startAsyncSpotFinder(req, res, deps, userIdOverride) {
  const {
    bus, resolveService, logger, tickerscannerUrl, marketdataserviceUrl,
    decisionengineUrl, cacheManagerTimeoutMs, tickerscannerTimeoutMs,
    relaxedSpotFinderParams, resolveUserId,
  } = deps;

  const pipeId = Number(String(req.params.pipeId || "").trim());
  if (!Number.isFinite(pipeId)) {
    return res.status(400).json({ ok: false, error: "pipeId must be a number" });
  }
  if (Number.isFinite(Number(userIdOverride))) {
    req._internalUserId = Number(userIdOverride);
    if (!req.headers["x-user-id"]) req.headers["x-user-id"] = String(userIdOverride);
  }
  const userId = await resolveUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: "userId not available" });
  }

  try {
    const { getJob } = require("./job-manager");
    const jobId = await startAsyncJob({
      bus: bus(),
      statusChannel: resolveService()?.redisStatusChannel,
      pipeId,
      userId,
      query: req.query,
      req,
      decisionengineUrl,
      marketdataserviceUrl,
      tickerscannerUrl,
      cacheManagerTimeoutMs,
      tickerscannerTimeoutMs,
      relaxedSpotFinderParams,
      logger,
    });
    const job = getJob(jobId);
    return res.json({
      ok: true,
      type: "async",
      jobId,
      stats: {
        status: job?.status,
        total: job?.total ?? 0,
        processed: job?.processed ?? 0,
        remaining: Math.max(0, (job?.total ?? 0) - (job?.processed ?? 0)),
        ok: job?.ok ?? 0,
        errorCount: job?.errorCount ?? 0,
        cachedUsed: job?.cachedUsed ?? false,
        cachedCount: job?.cachedCount ?? 0,
        startedAt: job?.startedAt ?? null,
        updatedAt: job?.updatedAt ?? null,
      },
    });
  } catch (err) {
    logger?.error?.(
      `[decision-engine] spot-finder async start error: ${err?.message || String(err)}`
    );
    return res.status(502).json({
      ok: false,
      error: "tickerscanner request failed",
      details: err?.response?.data || err?.message || String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// runSpotFinderForTicker — single-ticker call via self HTTP (used by pipe scan)
// ---------------------------------------------------------------------------
async function runSpotFinderForTicker(ticker, query, req, exchangeOverride, relaxed, extraParams = {}, deps) {
  const { decisionengineUrl, cacheManagerTimeoutMs, relaxedSpotFinderParams } = deps;
  const params = { ...query, ticker, ...extraParams };
  if (exchangeOverride && !params.exchange) params.exchange = exchangeOverride;
  if (relaxed) Object.assign(params, relaxedSpotFinderParams);
  const headers = pickAuthHeaders(req);
  const resp = await axios.get(`${decisionengineUrl}/spot-finder`, {
    params,
    headers,
    timeout: cacheManagerTimeoutMs,
  });
  return resp?.data;
}

// ---------------------------------------------------------------------------
// runLiveSnapshot — load snapshot & re-activate live state
// ---------------------------------------------------------------------------
async function runLiveSnapshot(req, pipeId, userId, deps) {
  const { bus, logger, marketdataserviceUrl, resolveUserId } = deps;
  const b = bus();
  if (!b || typeof b.get !== "function") {
    throw new Error("redis not available");
  }
  const dateParamRaw = req.query?.date || req.query?.asOfDate || req.query?.scoreDate || null;
  const snapshotDate = resolveSnapshotDate(dateParamRaw);
  const key = buildSpotFinderRedisKey(b, pipeId, userId, snapshotDate);
  const payload = await b.get(key);
  if (!payload) {
    const err = new Error("snapshot not found");
    err.code = "SNAPSHOT_NOT_FOUND";
    throw err;
  }
  const results = Array.isArray(payload?.results) ? payload.results : [];
  logger?.trace?.(
    `[decision-engine] live start snapshot key=${key} date=${snapshotDate} results=${results.length}`
  );
  const exchangeByTicker = new Map();
  const trendTickers = results
    .filter((row) => isTrendOk(row))
    .map((row) => {
      const ticker = String(row?.ticker || row?.symbol || "").trim().toUpperCase();
      const exchange =
        row?.exchange || row?.exchange_short || row?.exchange_short_name ||
        row?.exchangeShortName || row?.exchangeShort || row?.exchangeName || null;
      if (ticker && exchange) exchangeByTicker.set(ticker, String(exchange).trim());
      return ticker;
    })
    .filter(Boolean);
  logger?.trace?.(
    `[decision-engine] live start trend tickers=${trendTickers.length}`
  );

  const headers = pickAuthHeaders(req);
  if (trendTickers.length > 0) {
    await axios.post(
      `${marketdataserviceUrl}/subscriptions`,
      { tickers: Array.from(new Set(trendTickers)) },
      { headers, timeout: C.SUBSCRIPTION_TIMEOUT_MS }
    );
  }

  activateLiveState({
    pipeId, asOfDate: snapshotDate, userId, tickers: trendTickers,
    exchangeByTicker, query: req.query, authHeaders: headers,
  });

  return {
    pipeId, asOfDate: snapshotDate, subscribed: trendTickers,
    totalResults: results.length, trendTotal: trendTickers.length, total: trendTickers.length,
  };
}

// ---------------------------------------------------------------------------
// stopLive — unsubscribe & reset live state (DELETE /live/:pipeId)
// ---------------------------------------------------------------------------
async function stopLive(req, res, deps, userIdOverride) {
  const { logger, marketdataserviceUrl } = deps;
  const pipeId = Number(String(req.params.pipeId || "").trim());
  if (!Number.isFinite(pipeId)) {
    return res.status(400).json({ ok: false, error: "pipeId must be a number" });
  }
  if (Number.isFinite(Number(userIdOverride))) {
    req._internalUserId = Number(userIdOverride);
    if (!req.headers["x-user-id"]) req.headers["x-user-id"] = String(userIdOverride);
  }
  const hasLivePipe = liveState.pipeId !== null && liveState.pipeId !== undefined;
  if (hasLivePipe && liveState.pipeId !== pipeId) {
    return res.status(409).json({ ok: false, error: "live process bound to another pipeId" });
  }
  logger?.info?.(
    `[decision-engine] stopLive requested pipeId=${pipeId} userIdOverride=${userIdOverride ?? "-"} ` +
    `active=${liveState.active} currentPipeId=${liveState.pipeId ?? "-"}`
  );
  try {
    const headers = pickAuthHeaders(req);
    await axios.post(
      `${marketdataserviceUrl}/subscriptions`,
      { tickers: [] },
      { headers, timeout: C.SUBSCRIPTION_TIMEOUT_MS }
    );
  } catch (err) {
    logger?.warning?.(
      `[decision-engine] live stop unsubscribe failed ${err?.message || String(err)}`
    );
  }
  resetLiveState("stopLive route", logger);
  return res.json({ ok: true, active: false });
}

module.exports = {
  handlePipeSpotFinder,
  startAsyncSpotFinder,
  runSpotFinderForTicker,
  runLiveSnapshot,
  stopLive,
};
