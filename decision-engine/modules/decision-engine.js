"use strict";

const express = require("express");
const axios = require("axios");
const { verifyInternalToken } = require("../../shared/internalAuth");

// --- Modules ---------------------------------------------------------------
const C = require("./constants");
const {
  asNumber,
  asBool,
  subDays,
  normalizeDateParam,
  resolveSnapshotDate,
  normalizeCandle,
  normalizeAndSortCandles,
  pickAuthHeaders,
  fetchUserId,
  isTrendOk,
  isSupportNotAvailable,
} = require("./helpers");
const { pickCandidate, pickClosestByDistance } = require("./indicators");
const { buildZones, detectTrendFlagBreakout, computeEntryLevels } = require("./zones");
const { fetchAndAnalyze } = require("./candle-fetcher");
const {
  getJob,
  cancelJob,
  buildSpotFinderRedisKey,
  loadSnapshotResults,
  persistSpotFinderSnapshot,
  newJobId,
  fetchUserFundamentalsTickers,
  buildRankingDailyParams,
  fetchRankingDailyTickers,
  applyPipeLimit,
  startAsyncJob,
} = require("./job-manager");
const { reportJobDone } = require("../../shared/jobReporter");
const {
  liveState,
  resetLiveState,
  activateLiveState,
  getLiveStatus,
  createMarketDataHandler,
} = require("./live-manager");

// --- Relaxed params (query overrides for fallback) -------------------------
const relaxedSpotFinderParams = {
  lookbackDays: C.RELAXED_LOOKBACK_DAYS,
  minTouches: C.RELAXED_MIN_TOUCHES,
  minScore: C.RELAXED_MIN_SCORE,
  minRecentBars: C.RELAXED_RECENT_BARS,
  swingWindow: C.RELAXED_SWING_WINDOW,
  clusterMultiplier: C.RELAXED_CLUSTER_MULTIPLIER,
};

module.exports = function buildDecisionEngineRouter({ service, logger }) {
  const router = express.Router();

  // --- URL config ----------------------------------------------------------
  const cachemanagerUrl = (
    service?.cachemanagerUrl ||
    process.env.CACHEMANAGER_URL ||
    "http://cachemanager:3006"
  ).replace(/\/+$/, "");
  const authServiceUrl =
    service?.authServiceUrl ||
    process.env.AUTHSERVICE_URL ||
    "http://authService:3015";
  const tickerscannerUrl = (
    service?.tickerscannerUrl ||
    process.env.TICKERSCANNER_URL ||
    "http://tickerscanner:3013"
  ).replace(/\/+$/, "");
  const decisionengineUrl = (
    service?.decisionengineUrl ||
    process.env.DECISIONENGINE_URL ||
    "http://decision-engine:3018"
  ).replace(/\/+$/, "");
  const serviceName = process.env.MICROSERVICE_NAME || "decision-engine";
  const envName = process.env.ENV || process.env.APP_ENV || "DEV";
  const eventsChannel =
    service?.redisEventsChannel ||
    `${envName}.${serviceName}.events`;
  const marketdataserviceUrl = (
    service?.marketdataserviceUrl ||
    process.env.MARKETDATASERVICE_URL ||
    "http://market-data-service:3020"
  ).replace(/\/+$/, "");
  const cacheManagerTimeoutMs = Number(process.env.CACHEMANAGER_TIMEOUT_MS) || C.CACHEMANAGER_TIMEOUT_MS;
  const tickerscannerTimeoutMs = Number(process.env.TICKERSCANNER_TIMEOUT_MS) || C.TICKERSCANNER_TIMEOUT_MS;

  // --- Shorthand helpers that close over URLs ------------------------------
  const resolveUserId = (req) =>
    req?._internalUserId ??
    req?.internalAuth?.userId ??
    fetchUserId(req, authServiceUrl, C.AUTH_TIMEOUT_MS, logger);

  const requireInternalToken = async (req, res, next) => {
    const token =
      req.headers["x-internal-token"] ||
      req.headers["X-Internal-Token"] ||
      req.headers["x-internal-token".toLowerCase()];
    if (!token || typeof token !== "string") {
      return res.status(403).json({ ok: false, error: "Internal token mancante" });
    }
    try {
      const payload = await verifyInternalToken(token, {
        issuer: "astraai-internal",
        audience: "decision-engine",
        scope: "decision-engine:spot-finder",
        publicKey: process.env.INTERNAL_JWT_PUBLIC_KEY,
      });
      req.internalAuth = payload;
      return next();
    } catch (err) {
      logger?.warning?.(
        `[decision-engine] internal token invalid: ${err?.message || String(err)}`
      );
      return res.status(403).json({ ok: false, error: "Internal token non valido" });
    }
  };

  const handlePipeSpotFinder = async (req, res, userIdOverride) => {
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
            id: null,
            status: "completed",
            total: 0,
            processed: 0,
            ok: 0,
            errorCount: 0,
            results: [],
            errors: [],
            startedAt: null,
            updatedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
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
        const exchange = entry?.exchange || null;
        const extraParams = pipeId === C.RANKING_DAILY_PIPE_ID
          ? buildRankingDailyParams(entry?.meta)
          : {};
        try {
          let data = await runSpotFinderForTicker(ticker, req.query, req, exchange, false, extraParams);
          if (data?.ok === false && isSupportNotAvailable(data)) {
            data = await runSpotFinderForTicker(ticker, req.query, req, exchange, true, extraParams);
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
          }
        } catch (err) {
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
          id: null,
          status: "completed",
          total: tickers.length,
          processed: results.length + errors.length,
          ok: results.length,
          errorCount: errors.length,
          results,
          errors,
          startedAt: null,
          updatedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
        snapshotDate,
        logger
      );
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
  };

  const startAsyncSpotFinder = async (req, res, userIdOverride) => {
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
      const jobId = await startAsyncJob({
        bus: bus(),
        statusChannel: service?.redisStatusChannel,
        pipeId,
        userId,
        query: req.query,
        req,
        decisionengineUrl,
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
  };

  const internalSpotFinderHandler = async (req, res) => {
    const pipeId = Number(String(req.params.pipeId || "").trim());
    const userIdRaw =
      req.body?.userId ??
      req.body?.user_id ??
      req.query?.userId ??
      req.query?.user_id ??
      req.headers["x-user-id"] ??
      req.internalAuth?.userId ??
      req.internalAuth?.sub;
    let userId = Number(userIdRaw);
    if (!Number.isFinite(userId)) {
      if (pipeId === C.RANKING_DAILY_PIPE_ID) {
        // Internal scheduler jobs on virtual pipe 0 can run without a real user.
        userId = 0;
        logger?.warning?.(
          `[decision-engine] internal spot-finder missing/invalid userId for pipeId=0, fallback userId=0`
        );
      } else {
        logger?.warning?.(
          `[decision-engine] internal spot-finder missing/invalid userId | pipeId=${pipeId} raw=${String(userIdRaw ?? "")}`
        );
        return res.status(400).json({ ok: false, error: "userId obbligatorio" });
      }
    }
    return startAsyncSpotFinder(req, res, userId);
  };

  router._internalSpotFinder = [requireInternalToken, internalSpotFinderHandler];

  const internalSpotFinderLiveHandler = async (req, res) => {
    const pipeId = Number(String(req.params.pipeId || "").trim());
    const userIdRaw =
      req.body?.userId ??
      req.body?.user_id ??
      req.query?.userId ??
      req.query?.user_id ??
      req.headers["x-user-id"] ??
      req.internalAuth?.userId ??
      req.internalAuth?.sub;
    let userId = Number(userIdRaw);
    if (!Number.isFinite(pipeId)) {
      return res.status(400).json({ ok: false, error: "pipeId must be a number" });
    }
    if (!Number.isFinite(userId)) {
      if (pipeId === C.RANKING_DAILY_PIPE_ID) {
        userId = 0;
        logger?.warning?.(
          `[decision-engine] internal live spot-finder missing/invalid userId for pipeId=0, fallback userId=0`
        );
      } else {
        logger?.warning?.(
          `[decision-engine] internal live spot-finder missing/invalid userId | pipeId=${pipeId} raw=${String(userIdRaw ?? "")}`
        );
        return res.status(400).json({ ok: false, error: "userId obbligatorio" });
      }
    }
    const jobId = newJobId();
    const statusChannel = service?.redisStatusChannel;
    setImmediate(async () => {
      try {
        const summary = await runLiveSnapshot(req, pipeId, userId);
        await reportJobDone(bus(), statusChannel, jobId, {
          status: "COMPLETED",
          summary,
        });
      } catch (err) {
        logger?.warning?.(
          `[decision-engine] live enable failed ${err?.message || String(err)}`
        );
        await reportJobDone(bus(), statusChannel, jobId, {
          status: "FAILED",
          summary: { pipeId, userId },
          error: err?.message || String(err),
        });
      }
    });
    return res.json({ ok: true, type: "async", jobId });
  };

  router._internalSpotFinderLive = [requireInternalToken, internalSpotFinderLiveHandler];

  const stopLive = async (req, res, userIdOverride) => {
    const pipeId = Number(String(req.params.pipeId || "").trim());
    if (!Number.isFinite(pipeId)) {
      return res.status(400).json({ ok: false, error: "pipeId must be a number" });
    }
    if (Number.isFinite(Number(userIdOverride))) {
      req._internalUserId = Number(userIdOverride);
      if (!req.headers["x-user-id"]) req.headers["x-user-id"] = String(userIdOverride);
    }
    if (liveState.pipeId && liveState.pipeId !== pipeId) {
      return res.status(409).json({ ok: false, error: "live process bound to another pipeId" });
    }
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
    resetLiveState();
    return res.json({ ok: true, active: false });
  };

  const internalSpotFinderLiveStopHandler = async (req, res) => {
    const pipeId = Number(String(req.params.pipeId || "").trim());
    const userIdRaw =
      req.body?.userId ??
      req.body?.user_id ??
      req.query?.userId ??
      req.query?.user_id ??
      req.headers["x-user-id"] ??
      req.internalAuth?.userId ??
      req.internalAuth?.sub;
    let userId = Number(userIdRaw);
    if (!Number.isFinite(userId)) {
      if (pipeId === C.RANKING_DAILY_PIPE_ID) {
        userId = 0;
        logger?.warning?.(
          `[decision-engine] internal live stop missing/invalid userId for pipeId=0, fallback userId=0`
        );
      } else {
        logger?.warning?.(
          `[decision-engine] internal live stop missing/invalid userId | pipeId=${pipeId} raw=${String(userIdRaw ?? "")}`
        );
        return res.status(400).json({ ok: false, error: "userId obbligatorio" });
      }
    }
    return stopLive(req, res, userId);
  };

  router._internalSpotFinderLiveStop = [requireInternalToken, internalSpotFinderLiveStopHandler];

  const runSpotFinderForTicker = async (ticker, query, req, exchangeOverride, relaxed, extraParams = {}) => {
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
  };

  const bus = () => service?.bus;

  const runLiveSnapshot = async (req, pipeId, userId) => {
    const b = bus();
    if (!b || typeof b.get !== "function") {
      throw new Error("redis not available");
    }
    const dateParamRaw = req.query?.date || req.query?.asOfDate || req.query?.scoreDate || null;
    const snapshotDate = resolveSnapshotDate(dateParamRaw);
    const key = buildSpotFinderRedisKey(pipeId, userId, snapshotDate);
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
      pipeId,
      asOfDate: snapshotDate,
      userId,
      tickers: trendTickers,
      exchangeByTicker,
      query: req.query,
      authHeaders: headers,
    });

    return {
      pipeId,
      asOfDate: snapshotDate,
      subscribed: trendTickers,
      totalResults: results.length,
      trendTotal: trendTickers.length,
      total: trendTickers.length,
    };
  };

  // --- Market data handler setup -------------------------------------------
  if (service?.addMarketDataHandler && !service.__liveMarketHandlerAttached) {
    const hooksChannel = `${envName}.hooks`;
    const liquidityManagerUrl = (
      service?.liquidityManagerUrl ||
      process.env.LIQUIDITYMANAGER_URL ||
      "http://liquidity-manager:3001"
    ).replace(/\/+$/, "");
    const brokerExecutorUrl = (
      service?.brokerExecutorUrl ||
      process.env.BROKER_EXECUTOR_IBKR_URL ||
      process.env.BROKER_EXECUTOR_URL ||
      "http://broker-executor-ibkr:3003"
    ).replace(/\/+$/, "");
    const capitalManagerUrl = (
      service?.capitalmanagerUrl ||
      process.env.CAPITALMANAGER_URL ||
      ""
    ).replace(/\/+$/, "") || null;
    const ibkrBridgeUrl = (
      service?.ibkrbridgeUrl ||
      process.env.IBKRBRIDGE_URL ||
      "http://ibkr-bridge:3017"
    ).replace(/\/+$/, "");
    const handler = createMarketDataHandler({
      bus: service?.bus,
      eventsChannel,
      hooksChannel,
      serviceName,
      envName,
      logger,
      liquidityManagerUrl,
      cachemanagerUrl,
      brokerExecutorUrl,
      capitalManagerUrl,
      ibkrBridgeUrl,
    });
    service.addMarketDataHandler(handler);
    service.__liveMarketHandlerAttached = true;
  }

  // =========================================================================
  // Route: POST /:pipeId — start async job
  // =========================================================================
  router.post("/:pipeId", async (req, res) => startAsyncSpotFinder(req, res));

  // =========================================================================
  // Route: GET /jobs/:jobId — job status
  // =========================================================================
  router.get("/jobs/:jobId", async (req, res) => {
    const jobId = String(req.params.jobId || "").trim();
    const job = getJob(jobId);
    if (!job) {
      return res.status(404).json({ ok: false, error: "job not found" });
    }
    const limit = Math.max(1, Math.min(500, asNumber(req.query.limit, 50)));
    return res.json({
      ok: true,
      jobId,
      stats: {
        status: job.status,
        total: job.total,
        processed: job.processed,
        remaining: Math.max(0, job.total - job.processed),
        ok: job.ok,
        errorCount: job.errorCount,
        cachedUsed: job?.cachedUsed ?? false,
        cachedCount: job?.cachedCount ?? 0,
        startedAt: job.startedAt,
        updatedAt: job.updatedAt,
        finishedAt: job.finishedAt ?? null,
      },
      results: job.results.slice(0, limit),
      errors: job.errors.slice(0, limit),
    });
  });

  // =========================================================================
  // Route: POST /jobs/:jobId/stop — cancel job
  // =========================================================================
  router.post("/jobs/:jobId/stop", async (req, res) => {
    const jobId = String(req.params.jobId || "").trim();
    const job = cancelJob(jobId);
    if (!job) {
      return res.status(404).json({ ok: false, error: "job not found" });
    }
    if (job.pipeId && job.userId) {
      await persistSpotFinderSnapshot(bus(), job.pipeId, job.userId, job, job.asOfDate, logger);
    }
    return res.json({
      ok: true,
      jobId,
      status: job.status,
      finishedAt: job.finishedAt ?? null,
    });
  });

  // =========================================================================
  // Route: GET /latest/:pipeId — latest snapshot
  // =========================================================================
  router.get("/latest/:pipeId", async (req, res) => {
    const pipeId = Number(String(req.params.pipeId || "").trim());
    if (!Number.isFinite(pipeId)) {
      return res.status(400).json({ ok: false, error: "pipeId must be a number" });
    }
    const userId = await resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: "userId not available" });
    }
    const b = bus();
    if (!b || typeof b.get !== "function") {
      return res.status(503).json({ ok: false, error: "redis not available" });
    }
    try {
      const dateParamRaw = req.query?.date || req.query?.asOfDate || req.query?.scoreDate || null;
      const snapshotDate = resolveSnapshotDate(dateParamRaw);
      const key = buildSpotFinderRedisKey(pipeId, userId, snapshotDate);
      const payload = await b.get(key);
      if (!payload) {
        return res.status(404).json({ ok: false, error: "snapshot not found" });
      }
      return res.json({ ok: true, data: payload });
    } catch (err) {
      logger?.warning?.(
        `[decision-engine] redis snapshot read failed ${err?.message || String(err)}`
      );
      return res.status(502).json({ ok: false, error: "redis snapshot read failed" });
    }
  });

  // =========================================================================
  // Route: POST /live/:pipeId — enable/disable live
  // =========================================================================
  router.post("/live/:pipeId", async (req, res) => {
    const pipeId = Number(String(req.params.pipeId || "").trim());
    if (!Number.isFinite(pipeId)) {
      return res.status(400).json({ ok: false, error: "pipeId must be a number" });
    }
    const userId = await resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: "userId not available" });
    }

    const enable =
      asBool(req?.body?.enabled, undefined) ??
      asBool(req?.body?.active, undefined) ??
      asBool(req?.query?.enabled, true);

    if (!enable) {
      resetLiveState();
      return res.json({ ok: true, active: false });
    }

    try {
      const dateParamRaw = req.query?.date || req.query?.asOfDate || req.query?.scoreDate || null;
      const { snapshotDate, results } = await loadSnapshotResults(bus(), pipeId, userId, dateParamRaw);
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

      const headers = pickAuthHeaders(req);
      await axios.post(
        `${marketdataserviceUrl}/subscriptions`,
        { tickers: Array.from(new Set(trendTickers)) },
        { headers, timeout: C.SUBSCRIPTION_TIMEOUT_MS }
      );

      activateLiveState({
        pipeId,
        asOfDate: snapshotDate,
        userId,
        tickers: trendTickers,
        exchangeByTicker,
        query: req.query,
        authHeaders: headers,
      });

      return res.json({
        ok: true,
        active: true,
        pipeId,
        asOfDate: snapshotDate,
        subscribed: trendTickers,
        total: trendTickers.length,
      });
    } catch (err) {
      logger?.warning?.(
        `[decision-engine] live enable failed ${err?.message || String(err)}`
      );
      return res.status(502).json({ ok: false, error: "live enable failed" });
    }
  });

  // =========================================================================
  // Route: GET /live/:pipeId — live snapshot (re-subscribes)
  // =========================================================================
  router.get("/live/:pipeId", async (req, res) => {
    const pipeId = Number(String(req.params.pipeId || "").trim());
    if (!Number.isFinite(pipeId)) {
      return res.status(400).json({ ok: false, error: "pipeId must be a number" });
    }
    const userId = await resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: "userId not available" });
    }
    const jobId = newJobId();
    const statusChannel = service?.redisStatusChannel;
    setImmediate(async () => {
      try {
        const summary = await runLiveSnapshot(req, pipeId, userId);
        await reportJobDone(bus(), statusChannel, jobId, {
          status: "COMPLETED",
          summary,
        });
      } catch (err) {
        logger?.warning?.(
          `[decision-engine] live enable failed ${err?.message || String(err)}`
        );
        await reportJobDone(bus(), statusChannel, jobId, {
          status: "FAILED",
          summary: { pipeId, userId },
          error: err?.message || String(err),
        });
      }
    });
    return res.json({ ok: true, type: "async", jobId });
  });

  // =========================================================================
  // Route: GET /live/:pipeId/status
  // =========================================================================
  router.get("/live/:pipeId/status", async (req, res) => {
    const pipeId = Number(String(req.params.pipeId || "").trim());
    if (!Number.isFinite(pipeId)) {
      return res.status(400).json({ ok: false, error: "pipeId must be a number" });
    }
    return res.json(getLiveStatus(pipeId));
  });

  // =========================================================================
  // Route: DELETE /live/:pipeId — stop live
  // =========================================================================
  router.delete("/live/:pipeId", async (req, res) => {
    return stopLive(req, res);
  });

  // =========================================================================
  // Route: GET /:pipeId — sync spot-finder for pipe
  // =========================================================================
  router.get("/:pipeId", async (req, res) => handlePipeSpotFinder(req, res));

  // =========================================================================
  // Route: GET / — main spot-finder (single ticker)
  // =========================================================================
  router.get("/", async (req, res) => {
    const ticker = String(req.query.ticker || req.query.symbol || "").trim().toUpperCase();
    const lookbackDays = asNumber(req.query.lookbackDays ?? req.query.periodDays, C.DEFAULT_LOOKBACK_DAYS);
    const lookbackBars = Math.max(C.MIN_LOOKBACK_BARS, asNumber(req.query.lookbackBars, C.DEFAULT_LOOKBACK_BARS));
    const tf = String(req.query.tf || req.query.timeframe || C.DEFAULT_TF).trim() || C.DEFAULT_TF;
    const exchange = String(req.query.exchange || "").trim();
    const confirmLookbackDays = asNumber(req.query.confirmLookbackDays, C.CONFIRM_LOOKBACK_DAYS);
    const confirmLookbackBars = Math.max(C.MIN_LOOKBACK_BARS, asNumber(req.query.confirmLookbackBars, C.CONFIRM_LOOKBACK_BARS));
    const confirmTf = String(req.query.confirmTf || C.DEFAULT_CONFIRM_TF).trim() || C.DEFAULT_CONFIRM_TF;
    const recentLookbackDays = asNumber(req.query.recentLookbackDays, C.RECENT_LOOKBACK_DAYS);
    const recentLookbackBars = Math.max(C.MIN_LOOKBACK_BARS, asNumber(req.query.recentLookbackBars, C.RECENT_LOOKBACK_BARS));
    const recentTf = String(req.query.recentTf || C.DEFAULT_RECENT_TF).trim() || C.DEFAULT_RECENT_TF;
    const intradayLookbackDays = asNumber(req.query.intradayLookbackDays, C.INTRADAY_LOOKBACK_DAYS);
    const intradayLookbackBars = Math.max(C.MIN_LOOKBACK_BARS, asNumber(req.query.intradayLookbackBars, C.INTRADAY_LOOKBACK_BARS));
    const intradayTf = String(req.query.intradayTf || C.DEFAULT_INTRADAY_TF).trim() || C.DEFAULT_INTRADAY_TF;
    const signalLookbackDays = asNumber(req.query.signalLookbackDays, C.SIGNAL_LOOKBACK_DAYS);
    const signalLookbackBars = Math.max(C.MIN_LOOKBACK_BARS, asNumber(req.query.signalLookbackBars, C.SIGNAL_LOOKBACK_BARS));
    const signalTf = String(req.query.signalTf || C.DEFAULT_SIGNAL_TF).trim() || C.DEFAULT_SIGNAL_TF;
    const flagAtrK = asNumber(req.query.flagAtrK, C.DEFAULT_FLAG_ATR_K);
    const flagPctK = asNumber(req.query.flagPctK, C.DEFAULT_FLAG_PCT_K);
    const volMult = asNumber(req.query.volMult, C.DEFAULT_VOL_MULT);
    const minStopAtrK = asNumber(req.query.minStopAtrK, C.DEFAULT_MIN_STOP_ATR_K);
    const minTp2AtrK = asNumber(req.query.minTp2AtrK, C.DEFAULT_MIN_TP2_ATR_K);
    const enableConfirm = asBool(req.query.confirm, true);
    const swingWindow = Math.max(1, asNumber(req.query.swingWindow, C.DEFAULT_SWING_WINDOW));
    const atrPeriod = Math.max(2, asNumber(req.query.atrPeriod, C.DEFAULT_ATR_PERIOD));
    const clusterMultiplier = Math.max(0.1, asNumber(req.query.clusterMultiplier, C.DEFAULT_CLUSTER_MULTIPLIER));
    const reactionLookahead = Math.max(2, asNumber(req.query.reactionLookahead, C.DEFAULT_REACTION_LOOKAHEAD));
    const minTouches = Math.max(1, asNumber(req.query.minTouches, C.DEFAULT_MIN_TOUCHES));
    const minScore = Math.max(0, asNumber(req.query.minScore, C.DEFAULT_MIN_SCORE));
    const minRecentBars = Math.max(1, asNumber(req.query.minRecentBars, C.DEFAULT_RECENT_BARS));
    const recencyRecent = Math.max(1, asNumber(req.query.recencyRecent, C.DEFAULT_RECENCY_RECENT));
    const recencyMid = Math.max(recencyRecent, asNumber(req.query.recencyMid, C.DEFAULT_RECENCY_MID));
    const weightRecent = asNumber(req.query.weightRecent, C.DEFAULT_WEIGHT_RECENT);
    const weightMid = asNumber(req.query.weightMid, C.DEFAULT_WEIGHT_MID);
    const weightOld = asNumber(req.query.weightOld, C.DEFAULT_WEIGHT_OLD);

    if (!ticker) {
      return res.status(400).json({ ok: false, error: "ticker is required" });
    }

    const endDate = new Date();
    const startDate = subDays(endDate, lookbackDays);
    const params = {
      symbol: ticker,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      tf,
    };
    if (exchange) params.exchange = exchange;

    const zoneOpts = {
      lookbackBars, atrPeriod, swingWindow, clusterMultiplier,
      reactionLookahead, minTouches, minScore, minRecentBars,
      recencyRecent, recencyMid, weightRecent, weightMid, weightOld,
    };

    try {
      // --- Base timeframe ---
      const resp = await axios.get(`${cachemanagerUrl}/candles`, {
        params,
        timeout: cacheManagerTimeoutMs,
      });
      const candles = resp.data;
      if (!Array.isArray(candles) || candles.length === 0) {
        return res.status(404).json({
          ok: false, error: "no candles", data: { ticker, tf, window: params },
        });
      }

      const normalized = normalizeAndSortCandles(candles);
      const lastClose = normalized[normalized.length - 1]?.close;
      const inputCurrentPrice = asNumber(req.query.currentPrice, null);
      const currentPrice = Number.isFinite(inputCurrentPrice) ? inputCurrentPrice : null;

      const baseResult = buildZones(normalized, { lookbackBars, ...zoneOpts });

      if (!baseResult.ok || !baseResult.zones.length) {
        return res.status(422).json({
          ok: false,
          error: baseResult.error || "support not available",
          data: { ticker, tf, window: params },
        });
      }

      // --- Helper to build candle params ---
      const mkParams = (days, timeframe) => {
        const e = new Date();
        const s = subDays(e, days);
        const p = { symbol: ticker, startDate: s.toISOString(), endDate: e.toISOString(), tf: timeframe };
        if (exchange) p.exchange = exchange;
        return p;
      };

      // --- Confirm timeframe ---
      let confirm = null;
      if (enableConfirm) {
        try {
          const r = await fetchAndAnalyze(cachemanagerUrl, mkParams(confirmLookbackDays, confirmTf), cacheManagerTimeoutMs, { ...zoneOpts, lookbackBars: confirmLookbackBars });
          if (r) {
            confirm = {
              timeframe: confirmTf,
              lookbackDays: confirmLookbackDays,
              lookbackBars: r.sliceSize,
              atr20: r.atrValue ?? null,
              zones: r.zones || [],
              eps: r.eps ?? null,
            };
          }
        } catch (err) {
          logger?.warning?.(`[decision-engine] confirm fetch failed: ${err?.message || String(err)}`);
        }
      }

      // --- Recent timeframe ---
      let recent = null;
      let recentRawCount = 0;
      let recentFilteredCount = 0;
      let recentLastClose = null;
      try {
        const recentP = mkParams(recentLookbackDays, recentTf);
        const r = await fetchAndAnalyze(cachemanagerUrl, recentP, cacheManagerTimeoutMs, { ...zoneOpts, lookbackBars: recentLookbackBars });
        if (r) {
          recentRawCount = r.rawCount;
          recentFilteredCount = r.filteredCount;
          recentLastClose = r.lastClose;
          recent = {
            timeframe: recentTf,
            lookbackDays: recentLookbackDays,
            lookbackBars: r.sliceSize,
            atr20: r.atrValue ?? null,
            zones: r.zones || [],
            eps: r.eps ?? null,
            stats: { rawCandles: r.rawCount, filteredCandles: r.filteredCount },
            window: { startDate: recentP.startDate, endDate: recentP.endDate },
          };
        }
      } catch (err) {
        logger?.warning?.(`[decision-engine] recent fetch failed: ${err?.message || String(err)}`);
      }

      // --- Intraday timeframe ---
      let intraday = null;
      let intradayLastClose = null;
      try {
        const intradayP = mkParams(intradayLookbackDays, intradayTf);
        const r = await fetchAndAnalyze(cachemanagerUrl, intradayP, cacheManagerTimeoutMs, { ...zoneOpts, lookbackBars: intradayLookbackBars });
        if (r) {
          intradayLastClose = r.lastClose;
          intraday = {
            timeframe: intradayTf,
            lookbackDays: intradayLookbackDays,
            lookbackBars: r.sliceSize,
            atr20: r.atrValue ?? null,
            zones: r.zones || [],
            eps: r.eps ?? null,
            window: { startDate: intradayP.startDate, endDate: intradayP.endDate },
          };
        }
      } catch (err) {
        logger?.warning?.(`[decision-engine] intraday fetch failed: ${err?.message || String(err)}`);
      }

      // --- Signal timeframe ---
      let signal = null;
      let signalCandles = null;
      let signalZones = null;
      let signalRawCount = 0;
      let signalFilteredCount = 0;
      let signalLastClose = null;
      try {
        const signalP = mkParams(signalLookbackDays, signalTf);
        const r = await fetchAndAnalyze(cachemanagerUrl, signalP, cacheManagerTimeoutMs, { ...zoneOpts, lookbackBars: signalLookbackBars });
        if (r) {
          signalCandles = r.candles;
          signalRawCount = r.rawCount;
          signalFilteredCount = r.filteredCount;
          signalLastClose = r.lastClose;
          signalZones = r.zones || [];
          signal = {
            timeframe: signalTf,
            lookbackDays: signalLookbackDays,
            lookbackBars: r.sliceSize,
            atr20: r.atrValue ?? null,
            zones: signalZones,
            stats: { rawCandles: r.rawCount, filteredCandles: r.filteredCount },
            window: { startDate: signalP.startDate, endDate: signalP.endDate },
          };
        }
      } catch (err) {
        logger?.warning?.(`[decision-engine] signal fetch failed: ${err?.message || String(err)}`);
      }

      // --- Price ref ---
      const priceRef =
        Number.isFinite(currentPrice)
          ? currentPrice
          : Number.isFinite(intradayLastClose)
            ? intradayLastClose
            : lastClose;

      // --- Merge zones ---
      const zonePriority = { intraday: 3, recent: 2, base: 1 };
      const mergedZones = [
        ...(baseResult.zones || []).map((z) => ({ ...z, source: "base" })),
        ...(recent?.zones || []).map((z) => ({ ...z, source: "recent" })),
        ...(intraday?.zones || []).map((z) => ({ ...z, source: "intraday" })),
      ]
        .map((z) => ({
          ...z,
          structType: z.structType ?? z.type,
          relativeType: Number.isFinite(priceRef)
            ? z.midPrice < priceRef ? "SUPPORT" : "RESISTANCE"
            : z.structType ?? z.type,
          sourcePriority: zonePriority[z.source] ?? 0,
        }))
        .sort(
          (a, b) =>
            (b.sourcePriority - a.sourcePriority) ||
            (a.recencyBars - b.recencyBars) ||
            (b.score - a.score)
        );

      const supports = mergedZones.filter(
        (z) => z.relativeType === "SUPPORT" && Number.isFinite(priceRef) && z.midPrice <= priceRef
      );
      const resistances = mergedZones.filter(
        (z) => z.relativeType === "RESISTANCE" && Number.isFinite(priceRef) && z.midPrice >= priceRef
      );

      // --- Signal pattern ---
      const signalPattern =
        signalCandles && signalCandles.length
          ? detectTrendFlagBreakout(signalCandles, {
              atrPeriod,
              swingWindow: 3,
              mergedResistances: resistances,
              flagAtrK,
              flagPctK,
              volMult,
            })
          : null;
      const actionableBreakout = !!signalPattern && signalPattern.trendOk && signalPattern.flagOk && signalPattern.breakoutOk;
      const actionablePullback = !!signalPattern && signalPattern.trendOk && signalPattern.flagOk && signalPattern.pullbackOk;
      const breakoutReason = !signalPattern
        ? "pattern not available"
        : !signalPattern.trendOk ? "trend not confirmed"
          : !signalPattern.flagOk ? "flag not confirmed"
            : "breakout not confirmed by close+volume";
      const pullbackReason = !signalPattern
        ? "pattern not available"
        : !signalPattern.trendOk ? "trend not confirmed"
          : !signalPattern.flagOk ? "flag not confirmed"
            : "pullback not confirmed";

      // --- Entry levels ---
      const zoneFillK = asNumber(req.query.zoneFillK, C.DEFAULT_ZONE_FILL_K);
      const breakoutK = asNumber(req.query.breakoutK, C.DEFAULT_BREAKOUT_K);
      const structuralK = asNumber(req.query.structuralK, C.DEFAULT_STRUCTURAL_K);
      const volatilityK = asNumber(req.query.volatilityK, C.DEFAULT_VOLATILITY_K);
      const tpAtrK = asNumber(req.query.tpAtrK, C.DEFAULT_TP_ATR_K);
      const atrForTrading = [signal?.atr20, recent?.atr20, baseResult.atrValue].find((v) => Number.isFinite(v)) ?? 0;
      const atrSource = Number.isFinite(signal?.atr20) ? "signal" : Number.isFinite(recent?.atr20) ? "recent" : "base";
      const atrSourceTf = atrSource === "signal" ? signalTf : atrSource === "recent" ? recentTf : tf;
      const maxLevelDistanceAtr = Math.max(0.5, asNumber(req.query.maxLevelDistanceAtr, C.DEFAULT_MAX_LEVEL_DISTANCE_ATR));
      const supportsWithinAtr =
        Number.isFinite(atrForTrading) && atrForTrading > 0
          ? supports.filter((z) => Number.isFinite(z.midPrice) && (priceRef - z.midPrice) / atrForTrading <= maxLevelDistanceAtr)
          : [];
      const supportZone =
        supportsWithinAtr.length > 0
          ? pickClosestByDistance(supportsWithinAtr, (z) => (priceRef - z.midPrice) / (atrForTrading || 1))
          : pickCandidate(supports, (z) => -z.midPrice);
      const resistanceZone = pickCandidate(resistances, (z) => z.midPrice);
      const higherScoreSupportWithinAtr =
        supportsWithinAtr.length > 0 && supportZone &&
        supportsWithinAtr.some((z) => Number.isFinite(z.score) && z.score > (supportZone.score || 0));
      const entryLevels = computeEntryLevels(supportZone, resistanceZone, resistances, atrForTrading, {
        zoneFillK, breakoutK, structuralK, volatilityK, tpAtrK,
      });
      if (entryLevels?.breakout) {
        entryLevels.breakout.actionable = actionableBreakout;
        entryLevels.breakout.reason = actionableBreakout ? null : breakoutReason;
      }
      if (entryLevels?.retracement) {
        entryLevels.retracement.actionable = actionablePullback;
        entryLevels.retracement.reason = actionablePullback ? null : pullbackReason;
      }
      entryLevels.actionableBreakout = actionableBreakout;
      entryLevels.actionablePullback = actionablePullback;

      // --- Guardrails ---
      const applyGuardrails = (level) => {
        if (!level) return;
        const stopDistance = level.entryLimit - level.stopLoss;
        const tp2Distance = Number.isFinite(level.takeProfit2) ? level.takeProfit2 - level.entryLimit : null;
        const minStopDistance = minStopAtrK * atrForTrading;
        const minTp2Distance = minTp2AtrK * atrForTrading;
        level.rule = { ...level.rule, minStopAtrK, minTp2AtrK, minStopDistance, minTp2Distance, stopDistance, tp2Distance };
        if (Number.isFinite(stopDistance) && stopDistance < minStopDistance) {
          level.actionable = false;
          level.reason = level.reason || "stop too tight vs ATR";
        }
        if (Number.isFinite(tp2Distance) && tp2Distance < minTp2Distance) {
          level.actionable = false;
          level.reason = level.reason || "tp2 too tight vs ATR";
        }
      };
      applyGuardrails(entryLevels.retracement);
      applyGuardrails(entryLevels.breakout);

      // --- Debug helpers ---
      const formatZoneDebug = (zone) => {
        if (!zone) return null;
        const timeframe = zone.source === "recent" ? recentTf : zone.source === "intraday" ? intradayTf : tf;
        return {
          midPrice: zone.midPrice, low: zone.low, high: zone.high, width: zone.width,
          score: zone.score, touches: zone.touches, recencyBars: zone.recencyBars,
          source: zone.source, timeframe,
        };
      };
      const supportsTop5 = supports.slice(0, 5).map(formatZoneDebug).filter(Boolean);
      const resistancesTop5 = resistances.slice(0, 5).map(formatZoneDebug).filter(Boolean);
      const selectedSupport = formatZoneDebug(supportZone);
      const selectedResistance = formatZoneDebug(resistanceZone);
      const distanceToSupport =
        Number.isFinite(priceRef) && Number.isFinite(supportZone?.midPrice) ? priceRef - supportZone.midPrice : null;
      const distancePct =
        Number.isFinite(priceRef) && Number.isFinite(distanceToSupport) && priceRef !== 0 ? distanceToSupport / priceRef : null;
      const distanceAtr =
        Number.isFinite(atrForTrading) && Number.isFinite(distanceToSupport) && atrForTrading !== 0 ? distanceToSupport / atrForTrading : null;
      const resistanceAbove = resistances.filter((z) => Number.isFinite(priceRef) && z.midPrice > priceRef);
      const resistanceDebugTop = resistanceAbove.slice(0, 5).map((z) => ({
        midPrice: z.midPrice, source: z.source, score: z.score,
      }));

      // --- Response ---
      return res.json({
        ok: true,
        ticker,
        timeframe: tf,
        lookbackDays,
        lookbackBars: baseResult.sliceSize,
        window: { startDate: params.startDate, endDate: params.endDate },
        atr20: baseResult.atrValue,
        zones: baseResult.zones,
        eps: baseResult.eps,
        mergedZones,
        levels: entryLevels,
        levelsDebug: { atrForTrading, minStopAtrK, minTp2AtrK },
        priceRef,
        priceDebug: {
          priceRef, dailyLastClose: lastClose, recentLastClose, signalLastClose,
          providerSymbol: params.symbol,
        },
        selectionDebug: {
          usedAtrForTrading: { value: atrForTrading, source: atrSource, timeframe: atrSourceTf },
          usedTimeframeForLevels: atrSource,
          maxLevelDistanceAtr,
          supportsWithinAtrCount: supportsWithinAtr.length,
          supportHigherScoreWithinAtr: higherScoreSupportWithinAtr,
          supportsTop5,
          resistancesTop5,
          selectedSupport,
          selectedResistance,
          distancePct,
          distanceAtr,
        },
        atrDebug: {
          avgHL: signalPattern?.debug?.avgHL ?? null,
          medianHL: signalPattern?.debug?.medianHL ?? null,
          minHL: signalPattern?.debug?.minHL ?? null,
          maxHL: signalPattern?.debug?.maxHL ?? null,
          avgTR: signalPattern?.debug?.avgTR ?? null,
          atrLast: signalPattern?.debug?.atrLast ?? null,
          atrTail: signalPattern?.debug?.atrTail ?? [],
        },
        resistanceDebug: {
          countResistancesAbovePrice: resistanceAbove.length,
          top5: resistanceDebugTop,
        },
        confirm,
        recent,
        intraday,
        signal: signal ? { ...signal, pattern: signalPattern } : null,
        actionableBreakout,
        actionablePullback,
        params: {
          swingWindow, atrPeriod, clusterMultiplier, reactionLookahead,
          minTouches, minScore, minRecentBars, recencyRecent, recencyMid,
          weightRecent, weightMid, weightOld, zoneFillK, breakoutK,
          structuralK, volatilityK, tpAtrK, flagAtrK, flagPctK, volMult,
          minStopAtrK, minTp2AtrK, recentLookbackDays, recentLookbackBars,
          recentTf, intradayLookbackDays, intradayLookbackBars, intradayTf,
          signalLookbackDays, signalLookbackBars, signalTf, exchange,
        },
      });
    } catch (err) {
      logger?.error?.(
        `[decision-engine] cacheManager /candles error: ${err?.message || String(err)}`
      );
      return res.status(502).json({
        ok: false,
        error: "cacheManager request failed",
        details: err?.response?.data || err?.message || String(err),
      });
    }
  });

  return router;
};
