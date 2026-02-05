"use strict";

const express = require("express");
const axios = require("axios");

module.exports = function buildDecisionEngineRouter({ service, logger }) {
  const router = express.Router();
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
  const marketdataserviceUrl = (
    service?.marketdataserviceUrl ||
    process.env.MARKETDATASERVICE_URL ||
    "http://market-data-service:3020"
  ).replace(/\/+$/, "");
  const cacheManagerTimeoutMs = Number(process.env.CACHEMANAGER_TIMEOUT_MS) || 60000;
  const tickerscannerTimeoutMs = Number(process.env.TICKERSCANNER_TIMEOUT_MS) || 20000;
  const asyncJobs = new Map();
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
  };
  const newJobId = () => `spot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

  const defaultLookbackDays = 120;
  const defaultLookbackBars = 90;
  const defaultTf = "1day";
  const defaultConfirmLookbackDays = 365;
  const defaultConfirmLookbackBars = 52;
  const defaultConfirmTf = "1week";
  const defaultRecentLookbackDays = 14;
  const defaultRecentLookbackBars = 336;
  const defaultRecentTf = "1h";
  const defaultIntradayLookbackDays = 1;
  const defaultIntradayLookbackBars = 390;
  const defaultIntradayTf = "1min";
  const defaultSignalLookbackDays = 28;
  const defaultSignalLookbackBars = 800;
  const defaultSignalTf = "1h";
  const defaultSwingWindow = 3;
  const defaultAtrPeriod = 20;
  const defaultClusterMultiplier = 0.4;
  const defaultReactionLookahead = 15;
  const defaultMinTouches = 2;
  const defaultMinScore = 1;
  const defaultRecentBars = 60;
  const defaultRecencyRecent = 30;
  const defaultRecencyMid = 90;
  const defaultWeightRecent = 1;
  const defaultWeightMid = 0.6;
  const defaultWeightOld = 0.3;
  const relaxedSpotFinderParams = {
    lookbackDays: 180,
    minTouches: 1,
    minScore: 0,
    minRecentBars: 180,
    swingWindow: 2,
    clusterMultiplier: 0.5,
  };

  const asNumber = (value, fallback) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  };

  const asBool = (value, fallback) => {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "boolean") return value;
    const norm = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(norm)) return true;
    if (["false", "0", "no", "off"].includes(norm)) return false;
    return fallback;
  };

  const subDays = (date, days) => {
    const next = new Date(date);
    next.setDate(next.getDate() - days);
    return next;
  };

  const pickPrice = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const normalizeTimestamp = (value) => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "number") {
      return value < 1e12 ? value * 1000 : value;
    }
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? null : parsed;
  };

  const normalizeCandle = (candle) => {
    return {
      high: pickPrice(candle?.h ?? candle?.high),
      low: pickPrice(candle?.l ?? candle?.low),
      close: pickPrice(candle?.c ?? candle?.close),
      volume: pickPrice(candle?.v ?? candle?.volume),
      t: normalizeTimestamp(candle?.t ?? candle?.timestamp),
    };
  };

  const pickAuthHeaders = (req) => {
    const headers = {};
    const passthrough = [
      "authorization",
      "x-user-id",
      "x-api-key",
      "x-api-key-id",
      "x-api-keyid",
      "x-auth-subject-type",
    ];
    passthrough.forEach((key) => {
      const value = req?.headers?.[key];
      if (value) headers[key] = value;
    });
    return headers;
  };

  const runSpotFinderForTickerWithHeaders = async (
    ticker,
    query,
    headers,
    exchangeOverride,
    relaxed
  ) => {
    const params = { ...query, ticker };
    if (exchangeOverride && !params.exchange) {
      params.exchange = exchangeOverride;
    }
    if (relaxed) {
      Object.assign(params, relaxedSpotFinderParams);
    }
    const resp = await axios.get(`${decisionengineUrl}/spot-finder`, {
      params,
      headers,
      timeout: cacheManagerTimeoutMs,
    });
    return resp?.data;
  };

  const fetchUserId = async (req) => {
    const headerUser = req?.headers?.["x-user-id"] ?? req?.headers?.["x-userid"];
    if (headerUser && Number.isFinite(Number(headerUser))) return Number(headerUser);

    const authHeader = req?.headers?.authorization;
    if (authHeader && authHeader.toLowerCase().startsWith("bearer")) {
      const url = `${authServiceUrl}/auth/admin/me`;
      try {
        const resp = await axios.get(url, {
          headers: { Authorization: authHeader },
          timeout: 6000,
        });
        const me = resp.data || {};
        const id = me?.user?.id ?? me?.id ?? me?.tokenPayload?.sub;
        if (Number.isFinite(Number(id))) return Number(id);
      } catch (err) {
        logger?.warning?.(
          `[decision-engine] fetchUserId bearer failed ${err?.message || String(err)}`
        );
      }
    }

    return null;
  };

  const buildSpotFinderRedisKey = (pipeId, userId, asOfDate) =>
    `spot-finder:${pipeId}:${userId}:${asOfDate}`;

  const isTrendOk = (row) => {
    const trend =
      row?.fullResult?.signal?.pattern?.trendOk ??
      row?.fullResult?.pattern?.trendOk ??
      row?.signal?.pattern?.trendOk ??
      row?.pattern?.trendOk ??
      row?.trendOk ??
      null;
    return trend === true;
  };

  const loadSnapshotResults = async (pipeId, userId, dateParamRaw) => {
    const bus = service?.bus;
    if (!bus || typeof bus.get !== "function") {
      throw new Error("redis not available");
    }
    const snapshotDate = resolveSnapshotDate(dateParamRaw);
    const key = buildSpotFinderRedisKey(pipeId, userId, snapshotDate);
    const payload = await bus.get(key);
    if (!payload) {
      return { snapshotDate, results: [] };
    }
    const results = Array.isArray(payload?.results) ? payload.results : [];
    return { snapshotDate, results };
  };

  const updateSnapshotResult = async (pipeId, userId, asOfDate, nextResult) => {
    const bus = service?.bus;
    if (!bus || typeof bus.get !== "function" || typeof bus.set !== "function") return false;
    const key = buildSpotFinderRedisKey(pipeId, userId, asOfDate);
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
      await bus.set(key, updated, { EX: 60 * 60 * 12 });
      return true;
    } catch (err) {
      logger?.warning?.(
        `[decision-engine] live snapshot update failed ${err?.message || String(err)}`
      );
      return false;
    }
  };

  const updateSnapshotFlagsFromLive = async (ticker, price, volume, dataMode, ts) => {
    const bus = service?.bus;
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

    const next = { ...current };
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
    await bus.set(key, updated, { EX: 60 * 60 * 12 });
    return true;
  };

  if (service?.addMarketDataHandler && !service.__liveMarketHandlerAttached) {
    const handler = async (parsed, raw) => {
      if (!liveState.active) return;
      let payload =
        parsed && typeof parsed === "object" ? parsed : null;
      if (!payload && typeof raw === "string") {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = null;
        }
      }
      if (!payload) return;
      const dataMode = String(payload?.dataMode || payload?.mode || "").toLowerCase();
      if (dataMode !== "snapshot") return;

      const ticker = String(payload?.ticker || payload?.symbol || "").toUpperCase();
      if (!ticker || !liveState.tickers.has(ticker)) return;

      const now = Date.now();
      const last = liveState.lastRunByTicker.get(ticker) || 0;
      if (now - last < liveState.minIntervalMs) return;
      if (liveState.runningByTicker.has(ticker)) return;

      const marketPayload = payload?.payload || payload?.data || {};
      const price = asNumber(marketPayload?.[31] ?? marketPayload?.["31"], null);
      let volume = asNumber(marketPayload?.[7762] ?? marketPayload?.["7762"], null);
      if (!Number.isFinite(volume)) {
        volume = asNumber(marketPayload?.[87] ?? marketPayload?.["87"], null);
      }
      if (!Number.isFinite(price)) return;

      liveState.lastRunByTicker.set(ticker, now);
      liveState.runningByTicker.add(ticker);

      try {
        const updated = await updateSnapshotFlagsFromLive(
          ticker,
          price,
          volume,
          dataMode,
          payload?.ts
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
    service.addMarketDataHandler(handler);
    service.__liveMarketHandlerAttached = true;
  }

  const persistSpotFinderSnapshot = async (pipeId, userId, job, asOfDate) => {
    const bus = service?.bus;
    if (!bus || typeof bus.set !== "function") return false;
    const key = buildSpotFinderRedisKey(pipeId, userId, asOfDate);
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
      await bus.set(key, payload, { EX: 60 * 60 * 12 });
      return true;
    } catch (err) {
      logger?.warning?.(
        `[decision-engine] redis snapshot failed ${err?.message || String(err)}`
      );
      return false;
    }
  };

  const normalizeDateParam = (value) => {
    if (!value) return null;
    return String(value).slice(0, 10);
  };

  const resolveSnapshotDate = (value) => {
    const normalized = normalizeDateParam(value);
    return normalized || new Date().toISOString().slice(0, 10);
  };

  const isSupportNotAvailable = (payload) => {
    const msg = String(payload?.error || payload?.message || "").toLowerCase();
    return msg.includes("support not available");
  };

  const fetchUserFundamentalsTickers = async (pipeId, req, dateParam) => {
    const headers = pickAuthHeaders(req);
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
    const resp = await axios.get(url, { headers, timeout: tickerscannerTimeoutMs });
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
        return { ticker, exchange: exchange ? String(exchange).trim() : null };
      })
      .filter(Boolean);
  };

  const applyPipeLimit = (list, query) => {
    const raw = asNumber(query?.limit, null);
    if (!Number.isFinite(raw) || raw <= 0) return list;
    return list.slice(0, Math.min(list.length, Math.floor(raw)));
  };

  const runSpotFinderForTicker = async (ticker, query, req, exchangeOverride, relaxed) => {
    const params = { ...query, ticker };
    if (exchangeOverride && !params.exchange) {
      params.exchange = exchangeOverride;
    }
    if (relaxed) {
      Object.assign(params, relaxedSpotFinderParams);
    }
    const headers = pickAuthHeaders(req);
    const resp = await axios.get(`${decisionengineUrl}/spot-finder`, {
      params,
      headers,
      timeout: cacheManagerTimeoutMs,
    });
    return resp?.data;
  };

  const startAsyncJob = async (pipeId, userId, query, req) => {
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
      await persistSpotFinderSnapshot(pipeId, userId, job, snapshotDate);
    }

    const dateParam = normalizeDateParam(dateParamRaw);
    const tickers = applyPipeLimit(
      await fetchUserFundamentalsTickers(pipeId, req, dateParam),
      query
    );
    let cachedResults = [];
    let cachedErrors = [];
    let cachedTickers = new Set();
    let cachedCount = 0;
    if (useCache && userId) {
      const bus = service?.bus;
      if (bus && typeof bus.get === "function") {
        try {
          const key = buildSpotFinderRedisKey(pipeId, userId, snapshotDate);
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
        await persistSpotFinderSnapshot(pipeId, userId, job, snapshotDate);
      }
      return jobId;
    }

    if (pendingTickers.length === 0) {
      updateJob(jobId, { status: "completed", finishedAt: new Date().toISOString() });
      if (userId) {
        await persistSpotFinderSnapshot(pipeId, userId, job, snapshotDate);
      }
      return jobId;
    }

    const concurrency = Math.max(1, Math.min(6, asNumber(query.concurrency, 3)));
    let index = 0;
    const runNext = async () => {
      const active = getJob(jobId);
      if (!active || active.status !== "running") return;
      if (index >= pendingTickers.length) return;
      const entry = pendingTickers[index++];
        const ticker = entry?.ticker || entry;
        const exchange = entry?.exchange || null;
        try {
          let data = await runSpotFinderForTicker(ticker, query, req, exchange);
          if (data?.ok === false && isSupportNotAvailable(data)) {
            data = await runSpotFinderForTicker(ticker, query, req, exchange, true);
          }
          const errorMessage =
            data?.ok === false ? data?.error || data?.message || "spot-finder failed" : null;
          job.results.push({
            ticker,
            exchange,
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
          } else {
            job.ok += 1;
          }
      } catch (err) {
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
          await persistSpotFinderSnapshot(pipeId, userId, job, snapshotDate);
        }
      }
      await runNext();
    };

    const workers = [];
    for (let i = 0; i < concurrency; i++) workers.push(runNext());
    Promise.all(workers)
      .then(() => {
        const active = getJob(jobId);
        if (!active || active.status !== "running") return;
        updateJob(jobId, { status: "completed", finishedAt: new Date().toISOString() });
        if (userId) {
          persistSpotFinderSnapshot(pipeId, userId, job, snapshotDate);
        }
      })
      .catch((err) => {
        updateJob(jobId, {
          status: "error",
          finishedAt: new Date().toISOString(),
          error: err?.message || String(err),
        });
        if (userId) {
          persistSpotFinderSnapshot(pipeId, userId, job, snapshotDate);
        }
      });

    return jobId;
  };

  const atr = (candles, n) => {
    const tr = Array(candles.length).fill(null);
    for (let i = 1; i < candles.length; i++) {
      const h = candles[i].high;
      const l = candles[i].low;
      const pc = candles[i - 1].close;
      if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(pc)) {
        tr[i] = null;
        continue;
      }
      tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    }
    const atrSeries = Array(candles.length).fill(null);
    for (let i = 1; i < tr.length; i++) {
      const start = Math.max(1, i - n + 1);
      const slice = tr.slice(start, i + 1).filter((v) => Number.isFinite(v));
      atrSeries[i] = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
    }
    return atrSeries;
  };

  const findSwings = (candles, window) => {
    const swings = [];
    const L = window;
    const R = window;
    for (let i = L; i < candles.length - R; i++) {
      const hi = candles[i].high;
      const lo = candles[i].low;
      if (!Number.isFinite(hi) || !Number.isFinite(lo)) continue;

      let isHigh = true;
      for (let k = i - L; k <= i + R; k++) {
        if (k === i) continue;
        const chk = candles[k].high;
        if (Number.isFinite(chk) && chk >= hi) {
          isHigh = false;
          break;
        }
      }

      let isLow = true;
      for (let k = i - L; k <= i + R; k++) {
        if (k === i) continue;
        const chk = candles[k].low;
        if (Number.isFinite(chk) && chk <= lo) {
          isLow = false;
          break;
        }
      }

      const ts = candles[i].t || null;
      if (isHigh) swings.push({ index: i, price: hi, type: "HIGH", timestamp: ts });
      if (isLow) swings.push({ index: i, price: lo, type: "LOW", timestamp: ts });
    }
    return swings;
  };

  const clusterByPrice = (points, eps) => {
    const sorted = [...points].sort((a, b) => a.price - b.price);
    const clusters = [];
    for (const p of sorted) {
      const last = clusters[clusters.length - 1];
      if (!last || Math.abs(p.price - last.mean) > eps) {
        clusters.push({ points: [p], mean: p.price });
      } else {
        last.points.push(p);
        last.mean = last.points.reduce((s, x) => s + x.price, 0) / last.points.length;
      }
    }
    return clusters;
  };

  const recencyWeight = (barsAgo, recentBars, midBars, wRecent, wMid, wOld) => {
    if (barsAgo < recentBars) return wRecent;
    if (barsAgo <= midBars) return wMid;
    return wOld;
  };

  const calcReaction = (candles, index, price, lookahead, atrSeries) => {
    const end = Math.min(candles.length - 1, index + lookahead);
    let maxMove = 0;
    for (let j = index + 1; j <= end; j++) {
      const close = candles[j].close;
      if (!Number.isFinite(close)) continue;
      const move = Math.abs(close - price);
      if (move > maxMove) maxMove = move;
    }
    const atrValue = atrSeries[index] ?? atrSeries[atrSeries.length - 1] ?? 0;
    return atrValue ? maxMove / atrValue : 0;
  };

  const pickCandidate = (items, selector) => {
    if (!items.length) return null;
    const sorted = [...items].sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      if (a.touches !== b.touches) {
        return b.touches - a.touches;
      }
      if (a.recencyBars !== b.recencyBars) {
        return a.recencyBars - b.recencyBars;
      }
      return selector(a) - selector(b);
    });
    return sorted[0] || null;
  };

  const pickClosestByDistance = (items, distanceFn) => {
    if (!items.length) return null;
    const sorted = [...items].sort((a, b) => {
      const distA = distanceFn(a);
      const distB = distanceFn(b);
      if (distA !== distB) return distA - distB;
      if (a.recencyBars !== b.recencyBars) return a.recencyBars - b.recencyBars;
      if (a.score !== b.score) return b.score - a.score;
      return b.touches - a.touches;
    });
    return sorted[0] || null;
  };

  const sma = (values, period) => {
    const out = Array(values.length).fill(null);
    for (let i = 0; i < values.length; i++) {
      const start = Math.max(0, i - period + 1);
      const slice = values.slice(start, i + 1).filter((v) => Number.isFinite(v));
      out[i] = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
    }
    return out;
  };

  const ema = (values, period) => {
    const out = Array(values.length).fill(null);
    const k = 2 / (period + 1);
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) {
        out[i] = prev;
        continue;
      }
      if (prev == null) {
        prev = v;
      } else {
        prev = v * k + prev * (1 - k);
      }
      out[i] = prev;
    }
    return out;
  };

  const linearRegressionSlope = (values) => {
    const n = values.length;
    if (n < 2) return 0;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;
    for (let i = 0; i < n; i++) {
      const x = i;
      const y = values[i];
      if (!Number.isFinite(y)) return 0;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return 0;
    return (n * sumXY - sumX * sumY) / denom;
  };

  const detectTrendFlagBreakout = (candles, options = {}) => {
    const {
      atrPeriod,
      swingWindow = 3,
      trendBars = 12,
      trendMinAbove = 8,
      pivotLookback = 60,
      impulseBars = 80,
      flagBars = 20,
      breakoutLookback = 20,
      mergedResistances = [],
      flagAtrK = 1.3,
      flagPctK = 0.0025,
      volMult = 1.2,
    } = options;

    if (!Array.isArray(candles) || candles.length < Math.max(60, flagBars + 5)) {
      return {
        trendOk: false,
        flagOk: false,
        breakoutOk: false,
        pullbackOk: false,
        breakLevel: null,
        flagHigh: null,
        flagLow: null,
        entryBreakout: null,
        entryPullback: null,
        stopLoss: null,
        targets: { tp1: null, tp2: null, trailingAtrK: 2 },
        confidence: 0,
        debug: { reason: "not enough candles" },
      };
    }

    const closes = candles.map((c) => c.close);
    const volumes = candles.map((c) => c.volume);
    const atrSeries = atr(candles, atrPeriod);
    const lastIdx = candles.length - 1;
    const atrLast =
      atrSeries[lastIdx] ?? atrSeries.slice().reverse().find((v) => Number.isFinite(v)) ?? 0;
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const lastClose = closes[lastIdx];
    const lastVol = volumes[lastIdx];
    const prevVol1 = lastIdx > 0 ? volumes[lastIdx - 1] : null;
    const prevVol2 = lastIdx > 1 ? volumes[lastIdx - 2] : null;
    const volMa20 = sma(volumes, 20)[lastIdx];
    const priceLast = Number.isFinite(lastClose) ? lastClose : 0;
    const eps = Math.max(1e-6, priceLast * 0.0001);

    const lastN = Math.min(trendBars, candles.length);
    let aboveEma20Count = 0;
    let consideredBars = 0;
    for (let i = candles.length - lastN; i <= lastIdx; i++) {
      const emaVal = ema20[i];
      const closeVal = closes[i];
      if (!Number.isFinite(emaVal) || !Number.isFinite(closeVal)) continue;
      consideredBars += 1;
      if (closeVal >= emaVal - eps) aboveEma20Count += 1;
    }

    let trendOk = false;
    let trendReason = null;
    if (!Number.isFinite(ema20[lastIdx]) || !Number.isFinite(ema50[lastIdx])) {
      trendReason = "ema not available";
    } else if (ema20[lastIdx] <= ema50[lastIdx]) {
      trendReason = "ema20 below ema50";
    } else if (consideredBars < trendMinAbove) {
      trendReason = "insufficient ema bars";
    } else if (aboveEma20Count < trendMinAbove) {
      trendReason = "close not above ema20";
    } else {
      trendOk = true;
    }

    let hhhlOk = true;
    const swings = findSwings(candles, swingWindow);
    const recentSwings = swings.filter((s) => s.index >= candles.length - pivotLookback);
    const highs = recentSwings.filter((s) => s.type === "HIGH");
    const lows = recentSwings.filter((s) => s.type === "LOW");
    const countHigher = (arr) => {
      let count = 0;
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].price > arr[i - 1].price) count += 1;
      }
      return count;
    };
    if (highs.length >= 2 && lows.length >= 2) {
      hhhlOk = countHigher(highs) >= 2 && countHigher(lows) >= 2;
    }

    const impulseSlice = candles.slice(-impulseBars);
    const flagSlice = candles.slice(-flagBars);
    const impulseForVol = impulseSlice.slice(0, Math.max(1, impulseSlice.length - flagBars));
    const flagHigh = Math.max(...flagSlice.map((c) => c.high));
    const flagLow = Math.min(...flagSlice.map((c) => c.low));
    const flagRange = flagHigh - flagLow;
    const flagAtrAvg = (() => {
      const atrValues = atrSeries.slice(-flagBars).filter((v) => Number.isFinite(v));
      return atrValues.length ? atrValues.reduce((a, b) => a + b, 0) / atrValues.length : null;
    })();
    const flagSlope = linearRegressionSlope(flagSlice.map((c) => c.close));
    const avgFlagVol = flagSlice.map((c) => c.volume).filter((v) => Number.isFinite(v));
    const avgImpulseVol = impulseForVol.map((c) => c.volume).filter((v) => Number.isFinite(v));
    const avgFlag = avgFlagVol.length ? avgFlagVol.reduce((a, b) => a + b, 0) / avgFlagVol.length : null;
    const avgImpulse = avgImpulseVol.length
      ? avgImpulseVol.reduce((a, b) => a + b, 0) / avgImpulseVol.length
      : null;
    const flagThreshold = Math.max(flagAtrK * atrLast, flagPctK * priceLast);
    const slopeThreshold = Math.max(0.05 * atrLast, 0.0005 * priceLast);

    const flagOk =
      Number.isFinite(flagAtrAvg) &&
      flagRange < flagThreshold &&
      flagSlope >= -slopeThreshold &&
      (avgImpulse == null || avgFlag == null || avgFlag < 0.9 * avgImpulse);

    const breakLevel = flagHigh;
    const safeClose = Number.isFinite(lastClose) ? lastClose : 0;
    const buffer = Math.max(0.1 * atrLast, 0.0005 * safeClose);
    const priceBreakOk = Number.isFinite(lastClose) && lastClose > breakLevel + buffer;
    const volPass =
      Number.isFinite(lastVol) &&
      Number.isFinite(volMa20) &&
      (lastVol >= volMa20 * volMult || lastVol >= volMa20);
    const breakoutOk = priceBreakOk && volPass;

    let breakoutRecent = false;
    let breakoutVol = null;
    const recentWindow = candles.slice(-breakoutLookback);
    recentWindow.forEach((c) => {
      if (c.close > breakLevel + buffer) {
        breakoutRecent = true;
        breakoutVol = Math.max(breakoutVol ?? 0, c.volume ?? 0);
      }
    });

    const pullbackSlice = candles.slice(-3);
    const pullbackAvgVol = pullbackSlice.map((c) => c.volume).filter((v) => Number.isFinite(v));
    const pullbackAvg = pullbackAvgVol.length
      ? pullbackAvgVol.reduce((a, b) => a + b, 0) / pullbackAvgVol.length
      : null;
    const lastBar = candles[lastIdx];
    const pullbackTouch =
      breakoutRecent && lastBar.low <= breakLevel + buffer && lastBar.close > breakLevel;
    const pullbackOk =
      pullbackTouch && (breakoutVol == null || pullbackAvg == null || pullbackAvg <= breakoutVol);

    const lastPivotLow = lows.length ? lows[lows.length - 1].price : null;
    const stopBase = Math.min(
      Number.isFinite(flagLow) ? flagLow : Number.POSITIVE_INFINITY,
      Number.isFinite(lastPivotLow) ? lastPivotLow : Number.POSITIVE_INFINITY
    );
    const stopLoss = Number.isFinite(stopBase) ? stopBase - 0.2 * atrLast : null;

    const entryBreakout = Number.isFinite(breakLevel) ? breakLevel + buffer : null;
    const entryPullback = Number.isFinite(breakLevel) ? breakLevel + buffer : null;
    const entryForTarget = entryBreakout || entryPullback;
    const nextRes = mergedResistances.find((z) => z.midPrice > (entryForTarget ?? 0));
    const tp1 = nextRes ? nextRes.midPrice : entryForTarget ? entryForTarget + 2 * atrLast : null;
    const tp2 = entryForTarget ? entryForTarget + 5 * atrLast : null;

    const trendOkFinal = trendOk && hhhlOk;
    if (trendOk && !hhhlOk && !trendReason) {
      trendReason = "hhhl not confirmed";
    }

    const confidence = Math.min(
      100,
      Math.round(
        (trendOk ? 30 : 0) +
          (flagOk ? 25 : 0) +
          (breakoutOk ? 25 : 0) +
          (pullbackOk ? 20 : 0)
      )
    );

    const hlWindow = candles.slice(-200);
    const hlValues = hlWindow
      .map((c) => c.high - c.low)
      .filter((v) => Number.isFinite(v));
    const sortedHL = [...hlValues].sort((a, b) => a - b);
    const avgHL = hlValues.length
      ? hlValues.reduce((sum, v) => sum + v, 0) / hlValues.length
      : null;
    const medianHL = sortedHL.length
      ? sortedHL[Math.floor(sortedHL.length / 2)]
      : null;
    const minHL = sortedHL.length ? sortedHL[0] : null;
    const maxHL = sortedHL.length ? sortedHL[sortedHL.length - 1] : null;
    const trWindow = atrSeries.slice(-200).filter((v) => Number.isFinite(v));
    const avgTR = trWindow.length ? trWindow.reduce((a, b) => a + b, 0) / trWindow.length : null;
    const atrTail = atrSeries
      .slice(-5)
      .filter((v) => Number.isFinite(v));
    const emaSpreadPct = Number.isFinite(ema50[lastIdx]) && ema50[lastIdx] !== 0
      ? (ema20[lastIdx] - ema50[lastIdx]) / ema50[lastIdx]
      : null;
    const last12Start = Math.max(0, lastIdx - 11);
    const last12 = [];
    for (let i = last12Start; i <= lastIdx; i++) {
      const closeVal = closes[i];
      const emaVal = ema20[i];
      last12.push({
        t: candles[i]?.t ?? null,
        close: Number.isFinite(closeVal) ? closeVal : null,
        ema20: Number.isFinite(emaVal) ? emaVal : null,
        above: Number.isFinite(closeVal) && Number.isFinite(emaVal)
          ? closeVal >= emaVal - eps
          : null,
      });
    }

    const volRef = [lastVol, prevVol1, prevVol2]
      .filter((v) => Number.isFinite(v))
      .reduce((acc, v) => (acc == null ? v : Math.max(acc, v)), null);
    const volumeThreshold = Number.isFinite(volMa20) ? volMa20 * volMult : null;
    const volumeOk =
      Number.isFinite(volumeThreshold) && Number.isFinite(volRef)
        ? volRef >= volumeThreshold
        : false;
    const breakoutEntry = {
      breakLevel,
      buffer,
      entryTriggerPrice: entryBreakout,
      volumeThreshold,
      volumeObserved: volRef,
      volumeOk,
      entrySuggestion: volumeOk ? entryBreakout : null,
      note: volumeOk ? "volume ok for breakout" : "attendi conferma volumi",
    };

    return {
      trendOk: trendOkFinal,
      flagOk,
      breakoutOk,
      pullbackOk,
      isValidBreakoutSetup: trendOkFinal && flagOk && breakoutOk,
      isValidPullbackSetup: trendOkFinal && flagOk && pullbackOk,
      breakLevel,
      flagHigh,
      flagLow,
      entryBreakout,
      entryBreakoutSuggested: breakoutEntry.entrySuggestion,
      entryPullback,
      stopLoss,
      breakoutEntry,
      targets: { tp1, tp2, trailingAtrK: 2 },
      confidence,
      debug: {
        trend: {
          ema20Last: ema20[lastIdx],
          ema50Last: ema50[lastIdx],
          lastClose,
          aboveEma20Count,
          consideredBars,
          emaSpreadPct,
        },
        ema20Last: ema20[lastIdx],
        ema50Last: ema50[lastIdx],
        lastClose,
        aboveEma20Count,
        consideredBars,
        trendReason,
        hhhlOk,
        priceLast,
        flagRange,
        atrLast,
        last12,
        flagThresholdUsed: flagThreshold,
        slope: flagSlope,
        avgVolFlag: avgFlag,
        avgVolImpulse: avgImpulse,
        volLast: lastVol,
        volPrev1: prevVol1,
        volPrev2: prevVol2,
        volRef,
        volMA20: volMa20,
        volMult,
        volumeThreshold,
        volPass,
        buffer,
        avgHL,
        medianHL,
        minHL,
        maxHL,
        avgTR,
        atrTail,
      },
    };
  };

  const computeEntryLevels = (
    supportZone,
    resistanceZone,
    resistanceZones,
    atrValue,
    {
      zoneFillK = 0.55,
      breakoutK = 0.25,
      structuralK = 0.2,
      volatilityK = 1.2,
      tpAtrK = 5,
    } = {}
  ) => {
    let retracement = null;
    if (supportZone) {
      const entryLimit = supportZone.low + zoneFillK * supportZone.width;
      const structuralSL = supportZone.low - structuralK * atrValue;
      const volatilitySL = entryLimit - volatilityK * atrValue;
      const stopLoss = Math.min(structuralSL, volatilitySL);
      const takeProfit2 = entryLimit + tpAtrK * atrValue;
      const nextRes = pickCandidate(
        resistanceZones.filter((z) => z.midPrice > entryLimit),
        (z) => z.midPrice
      );
      const takeProfit1 = nextRes ? nextRes.midPrice : null;
      const risk = entryLimit - stopLoss;
      retracement = {
        entryLimit,
        stopLoss,
        takeProfit1,
        takeProfit2,
        risk,
        rule: { zoneFillK, structuralK, volatilityK, tpAtrK },
        supportZone,
        resistanceZone: nextRes,
      };
    }

    let breakout = null;
    if (resistanceZone) {
      const entryLimit = resistanceZone.high + breakoutK * atrValue;
      const structuralSL = resistanceZone.low - structuralK * atrValue;
      const volatilitySL = entryLimit - volatilityK * atrValue;
      const stopLoss = Math.min(structuralSL, volatilitySL);
      const takeProfit2 = entryLimit + tpAtrK * atrValue;
      const nextRes = pickCandidate(
        resistanceZones.filter((z) => z.midPrice > entryLimit),
        (z) => z.midPrice
      );
      const takeProfit1 = nextRes ? nextRes.midPrice : null;
      const risk = entryLimit - stopLoss;
      breakout = {
        entryLimit,
        stopLoss,
        takeProfit1,
        takeProfit2,
        risk,
        rule: { breakoutK, structuralK, volatilityK, tpAtrK },
        resistanceZone,
        nextResistanceZone: nextRes,
      };
    }

    return {
      entryLimit: retracement?.entryLimit ?? null,
      stopLoss: retracement?.stopLoss ?? null,
      takeProfit1: retracement?.takeProfit1 ?? null,
      takeProfit2: retracement?.takeProfit2 ?? null,
      risk: retracement?.risk ?? null,
      rule: retracement?.rule ?? null,
      supportZone: retracement?.supportZone ?? null,
      resistanceZone: retracement?.resistanceZone ?? null,
      retracement,
      breakout,
    };
  };

  const buildZones = (candles, options) => {
    const {
      lookbackBars,
      atrPeriod,
      swingWindow,
      clusterMultiplier,
      reactionLookahead,
      minTouches,
      minScore,
      minRecentBars,
      recencyRecent,
      recencyMid,
      weightRecent,
      weightMid,
      weightOld,
    } = options;

    const slice = candles.length > lookbackBars ? candles.slice(-lookbackBars) : candles;
    const atrSeries = atr(slice, atrPeriod);
    const atrValue = atrSeries[atrSeries.length - 1];
    if (!Number.isFinite(atrValue)) {
      return { ok: false, error: "atr not available", zones: [] };
    }

    const swings = findSwings(slice, swingWindow);
    const lastClose = slice[slice.length - 1]?.close ?? null;
    if (!Number.isFinite(lastClose)) {
      return { ok: false, error: "last close not available", zones: [] };
    }

    const eps = atrValue * clusterMultiplier;
    const clusters = clusterByPrice(swings, eps);
    const zones = clusters
      .map((cluster) => {
        const prices = cluster.points.map((p) => p.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const meanPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
        const barsAgoValues = cluster.points.map(
          (p) => (slice.length - 1) - p.index
        );
        const recencyBars = Math.min(...barsAgoValues);
        const score = cluster.points.reduce((sum, p) => {
          const barsAgo = (slice.length - 1) - p.index;
          const timeWeight = recencyWeight(
            barsAgo,
            recencyRecent,
            recencyMid,
            weightRecent,
            weightMid,
            weightOld
          );
          const reactionNorm = calcReaction(
            slice,
            p.index,
            p.price,
            reactionLookahead,
            atrSeries
          );
          return sum + reactionNorm * timeWeight;
        }, 0);

        const structType = meanPrice < lastClose ? "SUPPORT" : "RESISTANCE";
        return {
          type: structType,
          structType,
          midPrice: meanPrice,
          low: minPrice,
          high: maxPrice,
          width: maxPrice - minPrice,
          score,
          touches: cluster.points.length,
          recencyBars,
        };
      })
      .filter((z) => z.touches >= minTouches)
      .filter((z) => z.recencyBars <= minRecentBars)
      .filter((z) => z.score >= minScore)
      .sort((a, b) => (b.score - a.score) || (a.recencyBars - b.recencyBars));

    return { ok: true, atrValue, zones, sliceSize: slice.length, eps };
  };

  router.post("/:pipeId", async (req, res) => {
    const pipeIdRaw = String(req.params.pipeId || "").trim();
    const pipeId = Number(pipeIdRaw);
    if (!Number.isFinite(pipeId)) {
      return res.status(400).json({ ok: false, error: "pipeId must be a number" });
    }
    const userId = await fetchUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: "userId not available" });
    }
    try {
      const jobId = await startAsyncJob(pipeId, userId, req.query, req);
      const job = getJob(jobId);
      return res.json({
        ok: true,
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
  });

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

  router.post("/jobs/:jobId/stop", async (req, res) => {
    const jobId = String(req.params.jobId || "").trim();
    const job = cancelJob(jobId);
    if (!job) {
      return res.status(404).json({ ok: false, error: "job not found" });
    }
    if (job.pipeId && job.userId) {
      await persistSpotFinderSnapshot(job.pipeId, job.userId, job, job.asOfDate);
    }
    return res.json({
      ok: true,
      jobId,
      status: job.status,
      finishedAt: job.finishedAt ?? null,
    });
  });

  router.get("/latest/:pipeId", async (req, res) => {
    const pipeIdRaw = String(req.params.pipeId || "").trim();
    const pipeId = Number(pipeIdRaw);
    if (!Number.isFinite(pipeId)) {
      return res.status(400).json({ ok: false, error: "pipeId must be a number" });
    }
    const userId = await fetchUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: "userId not available" });
    }
    const bus = service?.bus;
    if (!bus || typeof bus.get !== "function") {
      return res.status(503).json({ ok: false, error: "redis not available" });
    }
    try {
      const dateParamRaw = req.query?.date || req.query?.asOfDate || req.query?.scoreDate || null;
      const snapshotDate = resolveSnapshotDate(dateParamRaw);
      const key = buildSpotFinderRedisKey(pipeId, userId, snapshotDate);
      const payload = await bus.get(key);
      if (!payload) {
        return res.status(404).json({ ok: false, error: "snapshot not found" });
      }
      return res.json({ ok: true, data: payload });
    } catch (err) {
      logger?.warning?.(
        `[decision-engine] redis snapshot read failed ${err?.message || String(err)}`
      );
      return res.status(502).json({
        ok: false,
        error: "redis snapshot read failed",
      });
    }
  });

  router.post("/live/:pipeId", async (req, res) => {
    const pipeIdRaw = String(req.params.pipeId || "").trim();
    const pipeId = Number(pipeIdRaw);
    if (!Number.isFinite(pipeId)) {
      return res.status(400).json({ ok: false, error: "pipeId must be a number" });
    }
    const userId = await fetchUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: "userId not available" });
    }

    const enable =
      asBool(req?.body?.enabled, undefined) ??
      asBool(req?.body?.active, undefined) ??
      asBool(req?.query?.enabled, true);

    if (!enable) {
      liveState.active = false;
      liveState.pipeId = null;
      liveState.asOfDate = null;
      liveState.userId = null;
      liveState.tickers = new Set();
      liveState.exchangeByTicker = new Map();
      liveState.lastRunByTicker.clear();
      liveState.runningByTicker.clear();
      return res.json({ ok: true, active: false });
    }

    try {
      const dateParamRaw = req.query?.date || req.query?.asOfDate || req.query?.scoreDate || null;
      const { snapshotDate, results } = await loadSnapshotResults(pipeId, userId, dateParamRaw);
      const exchangeByTicker = new Map();
      const trendTickers = results
        .filter((row) => isTrendOk(row))
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
          if (ticker && exchange) exchangeByTicker.set(ticker, String(exchange).trim());
          return ticker;
        })
        .filter(Boolean);

      const headers = pickAuthHeaders(req);
      await axios.post(
        `${marketdataserviceUrl}/subscriptions`,
        { tickers: Array.from(new Set(trendTickers)) },
        { headers, timeout: 10000 }
      );

      liveState.active = true;
      liveState.pipeId = pipeId;
      liveState.asOfDate = snapshotDate;
      liveState.userId = userId;
      liveState.tickers = new Set(trendTickers);
      liveState.exchangeByTicker = exchangeByTicker;
      liveState.query = { ...req.query };
      liveState.authHeaders = headers;
      liveState.lastRunByTicker.clear();
      liveState.runningByTicker.clear();

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
      return res.status(502).json({
        ok: false,
        error: "live enable failed",
      });
    }
  });

  router.get("/live/:pipeId", async (req, res) => {
    const pipeIdRaw = String(req.params.pipeId || "").trim();
    const pipeId = Number(pipeIdRaw);
    if (!Number.isFinite(pipeId)) {
      return res.status(400).json({ ok: false, error: "pipeId must be a number" });
    }
    const userId = await fetchUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: "userId not available" });
    }
    const bus = service?.bus;
    if (!bus || typeof bus.get !== "function") {
      return res.status(503).json({ ok: false, error: "redis not available" });
    }
    try {
      const dateParamRaw =
        req.query?.date || req.query?.asOfDate || req.query?.scoreDate || null;
      const snapshotDate = resolveSnapshotDate(dateParamRaw);
      const key = buildSpotFinderRedisKey(pipeId, userId, snapshotDate);
      const payload = await bus.get(key);
      if (!payload) {
        return res.status(404).json({ ok: false, error: "snapshot not found" });
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
            row?.exchange ||
            row?.exchange_short ||
            row?.exchange_short_name ||
            row?.exchangeShortName ||
            row?.exchangeShort ||
            row?.exchangeName ||
            null;
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
          { headers, timeout: 10000 }
        );
      }

      liveState.active = true;
      liveState.pipeId = pipeId;
      liveState.asOfDate = snapshotDate;
      liveState.userId = userId;
      liveState.tickers = new Set(trendTickers);
      liveState.exchangeByTicker = exchangeByTicker;
      liveState.query = { ...req.query };
      liveState.authHeaders = headers;
      liveState.lastRunByTicker.clear();
      liveState.runningByTicker.clear();

      return res.json({
        ok: true,
        active: true,
        pipeId,
        asOfDate: snapshotDate,
        subscribed: trendTickers,
        totalResults: results.length,
        trendTotal: trendTickers.length,
        total: trendTickers.length,
      });
    } catch (err) {
      logger?.warning?.(
        `[decision-engine] live enable failed ${err?.message || String(err)}`
      );
      return res.status(502).json({
        ok: false,
        error: "live enable failed",
      });
    }
  });

  router.get("/live/:pipeId/status", async (req, res) => {
    const pipeIdRaw = String(req.params.pipeId || "").trim();
    const pipeId = Number(pipeIdRaw);
    if (!Number.isFinite(pipeId)) {
      return res.status(400).json({ ok: false, error: "pipeId must be a number" });
    }
    return res.json({
      ok: true,
      active: liveState.active && liveState.pipeId === pipeId,
      pipeId: liveState.pipeId,
      asOfDate: liveState.asOfDate,
      total: liveState.tickers.size,
      tickers: Array.from(liveState.tickers),
      minIntervalMs: liveState.minIntervalMs,
      updatedAt: new Date().toISOString(),
    });
  });

  router.delete("/live/:pipeId", async (req, res) => {
    const pipeIdRaw = String(req.params.pipeId || "").trim();
    const pipeId = Number(pipeIdRaw);
    if (!Number.isFinite(pipeId)) {
      return res.status(400).json({ ok: false, error: "pipeId must be a number" });
    }
    if (liveState.pipeId && liveState.pipeId !== pipeId) {
      return res.status(409).json({ ok: false, error: "live process bound to another pipeId" });
    }
    try {
      const headers = pickAuthHeaders(req);
      await axios.post(
        `${marketdataserviceUrl}/subscriptions`,
        { tickers: [] },
        { headers, timeout: 10000 }
      );
    } catch (err) {
      logger?.warning?.(
        `[decision-engine] live stop unsubscribe failed ${err?.message || String(err)}`
      );
    }
    liveState.active = false;
    liveState.pipeId = null;
    liveState.asOfDate = null;
    liveState.userId = null;
    liveState.tickers = new Set();
    liveState.exchangeByTicker = new Map();
    liveState.lastRunByTicker.clear();
    liveState.runningByTicker.clear();
    return res.json({ ok: true, active: false });
  });

  router.get("/:pipeId", async (req, res) => {
    const pipeIdRaw = String(req.params.pipeId || "").trim();
    const pipeId = Number(pipeIdRaw);
    if (!Number.isFinite(pipeId)) {
      return res.status(400).json({ ok: false, error: "pipeId must be a number" });
    }
    const userId = await fetchUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: "userId not available" });
    }
    try {
      const dateParamRaw = req.query?.date || req.query?.asOfDate || req.query?.scoreDate || null;
      const dateParam = normalizeDateParam(dateParamRaw);
      const snapshotDate = resolveSnapshotDate(dateParamRaw);
      const tickers = applyPipeLimit(
        await fetchUserFundamentalsTickers(pipeId, req, dateParam),
        req.query
      );
      if (!tickers.length) {
        const emptyPayload = { ok: true, pipeId, count: 0, results: [], errors: [] };
        await persistSpotFinderSnapshot(pipeId, userId, {
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
        }, snapshotDate);
        return res.json(emptyPayload);
      }

      const results = [];
      const errors = [];
      const concurrency = Math.max(1, Math.min(6, asNumber(req.query.concurrency, 3)));
      let index = 0;
      const runNext = async () => {
        if (index >= tickers.length) return;
        const entry = tickers[index++];
        const ticker = entry?.ticker || entry;
        const exchange = entry?.exchange || null;
        try {
          let data = await runSpotFinderForTicker(ticker, req.query, req, exchange);
          if (data?.ok === false && isSupportNotAvailable(data)) {
            data = await runSpotFinderForTicker(ticker, req.query, req, exchange, true);
          }
          const errorMessage =
            data?.ok === false ? data?.error || data?.message || "spot-finder failed" : null;
          results.push({
            ticker,
            exchange,
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

      const payload = {
        ok: true,
        pipeId,
        count: results.length,
        results,
        errors,
      };
      await persistSpotFinderSnapshot(pipeId, userId, {
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
      }, snapshotDate);
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
  });

  router.get("/", async (req, res) => {
    const ticker = String(req.query.ticker || req.query.symbol || "")
      .trim()
      .toUpperCase();
    const lookbackDays = asNumber(
      req.query.lookbackDays ?? req.query.periodDays,
      defaultLookbackDays
    );
    const lookbackBars = Math.max(
      10,
      asNumber(req.query.lookbackBars, defaultLookbackBars)
    );
    const tf = String(req.query.tf || req.query.timeframe || defaultTf).trim() || defaultTf;
    const exchange = String(req.query.exchange || "").trim();
    const confirmLookbackDays = asNumber(
      req.query.confirmLookbackDays,
      defaultConfirmLookbackDays
    );
    const confirmLookbackBars = Math.max(
      10,
      asNumber(req.query.confirmLookbackBars, defaultConfirmLookbackBars)
    );
    const confirmTf = String(req.query.confirmTf || defaultConfirmTf).trim() || defaultConfirmTf;
    const recentLookbackDays = asNumber(
      req.query.recentLookbackDays,
      defaultRecentLookbackDays
    );
    const recentLookbackBars = Math.max(
      10,
      asNumber(req.query.recentLookbackBars, defaultRecentLookbackBars)
    );
    const recentTf = String(req.query.recentTf || defaultRecentTf).trim() || defaultRecentTf;
    const intradayLookbackDays = asNumber(
      req.query.intradayLookbackDays,
      defaultIntradayLookbackDays
    );
    const intradayLookbackBars = Math.max(
      10,
      asNumber(req.query.intradayLookbackBars, defaultIntradayLookbackBars)
    );
    const intradayTf = String(req.query.intradayTf || defaultIntradayTf).trim() || defaultIntradayTf;
    const signalLookbackDays = asNumber(
      req.query.signalLookbackDays,
      defaultSignalLookbackDays
    );
    const signalLookbackBars = Math.max(
      10,
      asNumber(req.query.signalLookbackBars, defaultSignalLookbackBars)
    );
    const signalTf = String(req.query.signalTf || defaultSignalTf).trim() || defaultSignalTf;
    const flagAtrK = asNumber(req.query.flagAtrK, 1.3);
    const flagPctK = asNumber(req.query.flagPctK, 0.0025);
    const volMult = asNumber(req.query.volMult, 1.2);
    const minStopAtrK = asNumber(req.query.minStopAtrK, 1.0);
    const minTp2AtrK = asNumber(req.query.minTp2AtrK, 3.0);
    const enableConfirm = asBool(req.query.confirm, true);
    const swingWindow = Math.max(1, asNumber(req.query.swingWindow, defaultSwingWindow));
    const atrPeriod = Math.max(2, asNumber(req.query.atrPeriod, defaultAtrPeriod));
    const clusterMultiplier = Math.max(0.1, asNumber(req.query.clusterMultiplier, defaultClusterMultiplier));
    const reactionLookahead = Math.max(2, asNumber(req.query.reactionLookahead, defaultReactionLookahead));
    const minTouches = Math.max(1, asNumber(req.query.minTouches, defaultMinTouches));
    const minScore = Math.max(0, asNumber(req.query.minScore, defaultMinScore));
    const minRecentBars = Math.max(1, asNumber(req.query.minRecentBars, defaultRecentBars));
    const recencyRecent = Math.max(1, asNumber(req.query.recencyRecent, defaultRecencyRecent));
    const recencyMid = Math.max(recencyRecent, asNumber(req.query.recencyMid, defaultRecencyMid));
    const weightRecent = asNumber(req.query.weightRecent, defaultWeightRecent);
    const weightMid = asNumber(req.query.weightMid, defaultWeightMid);
    const weightOld = asNumber(req.query.weightOld, defaultWeightOld);

    if (!ticker) {
      return res.status(400).json({
        ok: false,
        error: "ticker is required",
      });
    }

    const endDate = new Date();
    const startDate = subDays(endDate, lookbackDays);

    const params = {
      symbol: ticker,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      tf,
    };
    if (exchange) {
      params.exchange = exchange;
    }

    try {
      const resp = await axios.get(`${cachemanagerUrl}/candles`, {
        params,
        timeout: cacheManagerTimeoutMs,
      });

      const candles = resp.data;
      if (!Array.isArray(candles) || candles.length === 0) {
        return res.status(404).json({
          ok: false,
          error: "no candles",
          data: { ticker, tf, window: params },
        });
      }

      const normalized = candles
        .map(normalizeCandle)
        .filter((c) => Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close));
      normalized.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
      const lastClose = normalized[normalized.length - 1]?.close;
      const inputCurrentPrice = asNumber(req.query.currentPrice, null);
      const currentPrice = Number.isFinite(inputCurrentPrice) ? inputCurrentPrice : null;

      const baseResult = buildZones(normalized, {
        lookbackBars,
        atrPeriod,
        swingWindow,
        clusterMultiplier,
        reactionLookahead,
        minTouches,
        minScore,
        minRecentBars,
        recencyRecent,
        recencyMid,
        weightRecent,
        weightMid,
        weightOld,
      });

      if (!baseResult.ok || !baseResult.zones.length) {
        return res.status(422).json({
          ok: false,
          error: baseResult.error || "support not available",
          data: { ticker, tf, window: params },
        });
      }

      let confirm = null;
      let recent = null;
      let intraday = null;
      let intradayLastClose = null;
      let signal = null;
      let signalCandles = null;
      let signalZones = null;
      let recentRawCount = 0;
      let recentFilteredCount = 0;
      let signalRawCount = 0;
      let signalFilteredCount = 0;
      let recentLastClose = null;
      let signalLastClose = null;
      if (enableConfirm) {
        const confirmEnd = new Date();
        const confirmStart = subDays(confirmEnd, confirmLookbackDays);
        const confirmParams = {
          symbol: ticker,
          startDate: confirmStart.toISOString(),
          endDate: confirmEnd.toISOString(),
          tf: confirmTf,
        };
        if (exchange) {
          confirmParams.exchange = exchange;
        }

        try {
          const confirmResp = await axios.get(`${cachemanagerUrl}/candles`, {
            params: confirmParams,
            timeout: cacheManagerTimeoutMs,
          });
          const confirmCandles = confirmResp.data;
          if (Array.isArray(confirmCandles) && confirmCandles.length) {
            const confirmNormalized = confirmCandles
              .map(normalizeCandle)
              .filter((c) => Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close));
            confirmNormalized.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
            const confirmResult = buildZones(confirmNormalized, {
              lookbackBars: confirmLookbackBars,
              atrPeriod,
              swingWindow,
              clusterMultiplier,
              reactionLookahead,
              minTouches,
              minScore,
              minRecentBars,
              recencyRecent,
              recencyMid,
              weightRecent,
              weightMid,
              weightOld,
            });
            confirm = {
              timeframe: confirmTf,
              lookbackDays: confirmLookbackDays,
              lookbackBars: confirmResult.sliceSize,
              atr20: confirmResult.atrValue ?? null,
              zones: confirmResult.zones || [],
              eps: confirmResult.eps ?? null,
            };
          }
        } catch (err) {
          logger?.warning?.(
            `[decision-engine] confirm fetch failed: ${err?.message || String(err)}`
          );
        }
      }

      try {
        const recentEnd = new Date();
        const recentStart = subDays(recentEnd, recentLookbackDays);
        const recentParams = {
          symbol: ticker,
          startDate: recentStart.toISOString(),
          endDate: recentEnd.toISOString(),
          tf: recentTf,
        };
        if (exchange) {
          recentParams.exchange = exchange;
        }
        const recentResp = await axios.get(`${cachemanagerUrl}/candles`, {
          params: recentParams,
          timeout: cacheManagerTimeoutMs,
        });
        const recentCandles = recentResp.data;
        recentRawCount = Array.isArray(recentCandles) ? recentCandles.length : 0;
        if (Array.isArray(recentCandles) && recentCandles.length) {
          const recentNormalized = recentCandles
            .map(normalizeCandle)
            .filter((c) => Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close));
          recentFilteredCount = recentNormalized.length;
          recentNormalized.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
          recentLastClose = recentNormalized[recentNormalized.length - 1]?.close ?? null;
          const recentResult = buildZones(recentNormalized, {
            lookbackBars: recentLookbackBars,
            atrPeriod,
            swingWindow,
            clusterMultiplier,
            reactionLookahead,
            minTouches,
            minScore,
            minRecentBars,
            recencyRecent,
            recencyMid,
            weightRecent,
            weightMid,
            weightOld,
          });
          recent = {
            timeframe: recentTf,
            lookbackDays: recentLookbackDays,
            lookbackBars: recentResult.sliceSize,
            atr20: recentResult.atrValue ?? null,
            zones: recentResult.zones || [],
            eps: recentResult.eps ?? null,
            stats: {
              rawCandles: recentRawCount,
              filteredCandles: recentFilteredCount,
            },
            window: {
              startDate: recentParams.startDate,
              endDate: recentParams.endDate,
            },
          };
        }
      } catch (err) {
        logger?.warning?.(
          `[decision-engine] recent fetch failed: ${err?.message || String(err)}`
        );
      }

      try {
        const intradayEnd = new Date();
        const intradayStart = subDays(intradayEnd, intradayLookbackDays);
        const intradayParams = {
          symbol: ticker,
          startDate: intradayStart.toISOString(),
          endDate: intradayEnd.toISOString(),
          tf: intradayTf,
        };
        if (exchange) {
          intradayParams.exchange = exchange;
        }
        const intradayResp = await axios.get(`${cachemanagerUrl}/candles`, {
          params: intradayParams,
          timeout: cacheManagerTimeoutMs,
        });
        const intradayCandles = intradayResp.data;
        if (Array.isArray(intradayCandles) && intradayCandles.length) {
          const intradayNormalized = intradayCandles
            .map(normalizeCandle)
            .filter((c) => Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close));
          intradayNormalized.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
          intradayLastClose = intradayNormalized[intradayNormalized.length - 1]?.close ?? null;
          const intradayResult = buildZones(intradayNormalized, {
            lookbackBars: intradayLookbackBars,
            atrPeriod,
            swingWindow,
            clusterMultiplier,
            reactionLookahead,
            minTouches,
            minScore,
            minRecentBars,
            recencyRecent,
            recencyMid,
            weightRecent,
            weightMid,
            weightOld,
          });
          intraday = {
            timeframe: intradayTf,
            lookbackDays: intradayLookbackDays,
            lookbackBars: intradayResult.sliceSize,
            atr20: intradayResult.atrValue ?? null,
            zones: intradayResult.zones || [],
            eps: intradayResult.eps ?? null,
            window: {
              startDate: intradayParams.startDate,
              endDate: intradayParams.endDate,
            },
          };
        }
      } catch (err) {
        logger?.warning?.(
          `[decision-engine] intraday fetch failed: ${err?.message || String(err)}`
        );
      }

      try {
        const signalEnd = new Date();
        const signalStart = subDays(signalEnd, signalLookbackDays);
        const signalParams = {
          symbol: ticker,
          startDate: signalStart.toISOString(),
          endDate: signalEnd.toISOString(),
          tf: signalTf,
        };
        if (exchange) {
          signalParams.exchange = exchange;
        }
        const signalResp = await axios.get(`${cachemanagerUrl}/candles`, {
          params: signalParams,
          timeout: cacheManagerTimeoutMs,
        });
        const signalRows = signalResp.data;
        signalRawCount = Array.isArray(signalRows) ? signalRows.length : 0;
        if (Array.isArray(signalRows) && signalRows.length) {
          signalCandles = signalRows
            .map(normalizeCandle)
            .filter((c) => Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close));
          signalFilteredCount = signalCandles.length;
          signalCandles.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
          signalLastClose = signalCandles[signalCandles.length - 1]?.close ?? null;
          const signalResult = buildZones(signalCandles, {
            lookbackBars: signalLookbackBars,
            atrPeriod,
            swingWindow,
            clusterMultiplier,
            reactionLookahead,
            minTouches,
            minScore,
            minRecentBars,
            recencyRecent,
            recencyMid,
            weightRecent,
            weightMid,
            weightOld,
          });
          signalZones = signalResult.zones || [];
          signal = {
            timeframe: signalTf,
            lookbackDays: signalLookbackDays,
            lookbackBars: signalResult.sliceSize,
            atr20: signalResult.atrValue ?? null,
            zones: signalZones,
            stats: {
              rawCandles: signalRawCount,
              filteredCandles: signalFilteredCount,
            },
            window: {
              startDate: signalParams.startDate,
              endDate: signalParams.endDate,
            },
          };
        }
      } catch (err) {
        logger?.warning?.(
          `[decision-engine] signal fetch failed: ${err?.message || String(err)}`
        );
      }

      const priceRef =
        Number.isFinite(currentPrice)
          ? currentPrice
          : Number.isFinite(intradayLastClose)
            ? intradayLastClose
            : lastClose;

      const zonePriority = {
        intraday: 3,
        recent: 2,
        base: 1,
      };

      const mergedZones = [
        ...(baseResult.zones || []).map((z) => ({ ...z, source: "base" })),
        ...(recent?.zones || []).map((z) => ({ ...z, source: "recent" })),
        ...(intraday?.zones || []).map((z) => ({ ...z, source: "intraday" })),
      ]
        .map((z) => ({
          ...z,
          structType: z.structType ?? z.type,
          relativeType: Number.isFinite(priceRef)
            ? z.midPrice < priceRef
              ? "SUPPORT"
              : "RESISTANCE"
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
      const actionableBreakout =
        !!signalPattern &&
        signalPattern.trendOk &&
        signalPattern.flagOk &&
        signalPattern.breakoutOk;
      const actionablePullback =
        !!signalPattern &&
        signalPattern.trendOk &&
        signalPattern.flagOk &&
        signalPattern.pullbackOk;
      const breakoutReason = !signalPattern
        ? "pattern not available"
        : !signalPattern.trendOk
          ? "trend not confirmed"
          : !signalPattern.flagOk
            ? "flag not confirmed"
            : "breakout not confirmed by close+volume";
      const pullbackReason = !signalPattern
        ? "pattern not available"
        : !signalPattern.trendOk
          ? "trend not confirmed"
          : !signalPattern.flagOk
            ? "flag not confirmed"
            : "pullback not confirmed";
      const zoneFillK = asNumber(req.query.zoneFillK, 0.55);
      const breakoutK = asNumber(req.query.breakoutK, 0.25);
      const structuralK = asNumber(req.query.structuralK, 0.2);
      const volatilityK = asNumber(req.query.volatilityK, 1.2);
      const tpAtrK = asNumber(req.query.tpAtrK, 5);
      const atrForTrading = [
        signal?.atr20,
        recent?.atr20,
        baseResult.atrValue,
      ].find((v) => Number.isFinite(v)) ?? 0;
      const atrSource = Number.isFinite(signal?.atr20)
        ? "signal"
        : Number.isFinite(recent?.atr20)
          ? "recent"
          : "base";
      const atrSourceTf = atrSource === "signal" ? signalTf : atrSource === "recent" ? recentTf : tf;
      const maxLevelDistanceAtr = Math.max(0.5, asNumber(req.query.maxLevelDistanceAtr, 3));
      const supportsWithinAtr =
        Number.isFinite(atrForTrading) && atrForTrading > 0
          ? supports.filter(
              (z) =>
                Number.isFinite(z.midPrice) &&
                (priceRef - z.midPrice) / atrForTrading <= maxLevelDistanceAtr
            )
          : [];
      const supportZone =
        supportsWithinAtr.length > 0
          ? pickClosestByDistance(
              supportsWithinAtr,
              (z) => (priceRef - z.midPrice) / (atrForTrading || 1)
            )
          : pickCandidate(supports, (z) => -z.midPrice);
      const resistanceZone = pickCandidate(resistances, (z) => z.midPrice);
      const higherScoreSupportWithinAtr =
        supportsWithinAtr.length > 0 &&
        supportZone &&
        supportsWithinAtr.some((z) => Number.isFinite(z.score) && z.score > (supportZone.score || 0));
      const entryLevels = computeEntryLevels(
        supportZone,
        resistanceZone,
        resistances,
        atrForTrading,
        {
          zoneFillK,
          breakoutK,
          structuralK,
          volatilityK,
          tpAtrK,
        }
      );
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

      const applyGuardrails = (level) => {
        if (!level) return;
        const stopDistance = level.entryLimit - level.stopLoss;
        const tp2Distance = Number.isFinite(level.takeProfit2)
          ? level.takeProfit2 - level.entryLimit
          : null;
        const minStopDistance = minStopAtrK * atrForTrading;
        const minTp2Distance = minTp2AtrK * atrForTrading;
        level.rule = {
          ...level.rule,
          minStopAtrK,
          minTp2AtrK,
          minStopDistance,
          minTp2Distance,
          stopDistance,
          tp2Distance,
        };

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

      const formatZoneDebug = (zone) => {
        if (!zone) return null;
        const timeframe =
          zone.source === "recent"
            ? recentTf
            : zone.source === "intraday"
              ? intradayTf
              : tf;
        return {
          midPrice: zone.midPrice,
          low: zone.low,
          high: zone.high,
          width: zone.width,
          score: zone.score,
          touches: zone.touches,
          recencyBars: zone.recencyBars,
          source: zone.source,
          timeframe,
        };
      };

      const supportsTop5 = supports.slice(0, 5).map(formatZoneDebug).filter(Boolean);
      const resistancesTop5 = resistances.slice(0, 5).map(formatZoneDebug).filter(Boolean);
      const selectedSupport = formatZoneDebug(supportZone);
      const selectedResistance = formatZoneDebug(resistanceZone);
      const distanceToSupport =
        Number.isFinite(priceRef) && Number.isFinite(supportZone?.midPrice)
          ? priceRef - supportZone.midPrice
          : null;
      const distancePct =
        Number.isFinite(priceRef) && Number.isFinite(distanceToSupport) && priceRef !== 0
          ? distanceToSupport / priceRef
          : null;
      const distanceAtr =
        Number.isFinite(atrForTrading) && Number.isFinite(distanceToSupport) && atrForTrading !== 0
          ? distanceToSupport / atrForTrading
          : null;
      const resistanceAbove = resistances.filter(
        (z) => Number.isFinite(priceRef) && z.midPrice > priceRef
      );
      const resistanceDebugTop = resistanceAbove.slice(0, 5).map((z) => ({
        midPrice: z.midPrice,
        source: z.source,
        score: z.score,
      }));

      return res.json({
        ok: true,
        ticker,
        timeframe: tf,
        lookbackDays,
        lookbackBars: baseResult.sliceSize,
        window: {
          startDate: params.startDate,
          endDate: params.endDate,
        },
        atr20: baseResult.atrValue,
        zones: baseResult.zones,
        eps: baseResult.eps,
        mergedZones,
        levels: entryLevels,
        levelsDebug: {
          atrForTrading,
          minStopAtrK,
          minTp2AtrK,
        },
        priceRef,
        priceDebug: {
          priceRef,
          dailyLastClose: lastClose,
          recentLastClose,
          signalLastClose,
          providerSymbol: params.symbol,
        },
        selectionDebug: {
          usedAtrForTrading: {
            value: atrForTrading,
            source: atrSource,
            timeframe: atrSourceTf,
          },
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
        signal: signal
          ? {
              ...signal,
              pattern: signalPattern,
            }
          : null,
        actionableBreakout,
        actionablePullback,
        params: {
          swingWindow,
          atrPeriod,
          clusterMultiplier,
          reactionLookahead,
          minTouches,
          minScore,
          minRecentBars,
          recencyRecent,
          recencyMid,
          weightRecent,
          weightMid,
          weightOld,
          zoneFillK,
          breakoutK,
          structuralK,
          volatilityK,
          tpAtrK,
          flagAtrK,
          flagPctK,
          volMult,
          minStopAtrK,
          minTp2AtrK,
          recentLookbackDays,
          recentLookbackBars,
          recentTf,
          intradayLookbackDays,
          intradayLookbackBars,
          intradayTf,
          signalLookbackDays,
          signalLookbackBars,
          signalTf,
          exchange,
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
