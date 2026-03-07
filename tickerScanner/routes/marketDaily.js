"use strict";

const axios = require("axios");
const { Router } = require("express");
const { createDatahubAdapter } = require("../../shared/datahubAdapter");
const { createFetchUserId } = require("../lib/filterEngine");
const { createFetchApiKeyId } = require("../lib/weightsConfig");
const { safeNum } = require("../lib/scoreDecorator");

const safeStringify = (val) => {
  if (val === undefined) return "";
  if (typeof val === "string") return val;
  try { return JSON.stringify(val); } catch { return String(val); }
};

const normalizeMarketDate = (value) => {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const str = String(value);
  return str.length >= 10 ? str.slice(0, 10) : str;
};

module.exports = function buildMarketDailyRouter({ logger, getService }) {
  const router = Router();
  const dbmanagerUrl = (process.env.DATAHUB_URL || process.env.DBMANAGER_URL || "http://datahub:3000").replace(/\/+$/, "");
  const authServiceUrl = (process.env.AUTHSERVICE_URL || "http://authservice:3015").replace(/\/+$/, "");

  const datahubAxios = createDatahubAdapter(axios.create({ baseURL: dbmanagerUrl, timeout: 8000 }));

  const fetchApiKeyId = createFetchApiKeyId({ axios, dbmanagerUrl, logger });
  const fetchUserId = createFetchUserId({ axios, authServiceUrl, logger, fetchApiKeyId });

  // POST /fundamentals/update-market-daily - avvia job asincrono
  router.post("/update-market-daily", async (req, res) => {
    const service = getService();
    const marketDailySvc = service.marketDailySvc;
    const jobKey =
      (typeof req.query.jobKey === "string" && req.query.jobKey.trim()) ||
      (typeof req.headers["x-job-key"] === "string" && req.headers["x-job-key"].trim()) ||
      (typeof req.body?.jobKey === "string" && req.body.jobKey.trim()) ||
      "manual";
    const job = marketDailySvc.createJob();
    setImmediate(() =>
      marketDailySvc.runJob(job.id, jobKey, {
        bus: service.bus,
        redisStatusChannel: service.redisStatusChannel,
        redisTelemetryChannel: service.redisTelemetryChannel,
      })
    );
    return res.json({ ok: true, type: "async", jobId: job.id, jobKey, startedAt: job.createdAt });
  });

  // GET /fundamentals/update-market-daily - lista job attivi
  router.get("/update-market-daily", (req, res) => {
    const marketDailySvc = getService().marketDailySvc;
    return res.json({ ok: true, jobs: marketDailySvc.getActiveJobs() });
  });

  // DELETE /fundamentals/update-market-daily/:jobId - cancella job
  router.delete("/update-market-daily/:jobId", (req, res) => {
    const marketDailySvc = getService().marketDailySvc;
    const job = marketDailySvc.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, error: "Job non trovato" });
    if (job.status === "completed" || job.status === "error" || job.status === "cancelled") {
      return res.status(400).json({ ok: false, error: "Job già terminato" });
    }
    job.cancel = true;
    marketDailySvc.updateJob(job.id, { status: "cancelled", finishedAt: new Date().toISOString() });
    if (!job.persisted) {
      marketDailySvc.persistJobRecord(job.id, {
        job_id: job.id, status: "cancelled",
        total_symbols: job.totalSymbols || 0, processed: job.processed || 0,
        inserted: job.inserted || 0, updated: job.updated || 0,
        error_count: job.errors?.length || 0, errors_json: job.errors || [],
        params_json: {},
        started_at: job.startedAt ? job.startedAt.replace("T", " ").slice(0, 19) : null,
        finished_at: new Date().toISOString().replace("T", " ").slice(0, 19),
      });
    }
    return res.json({ ok: true, jobId: job.id });
  });

  // GET /fundamentals/market-daily/compare
  router.get("/market-daily/compare", async (req, res) => {
    const fn = "marketDaily.GET:/market-daily/compare";
    try {
      const tradeDate = req.query.trade_date ?? req.query.tradeDate ?? req.query.date ?? null;
      if (!tradeDate) return res.status(400).json({ ok: false, error: "trade_date obbligatoria" });

      const targetResp = await axios.get(`${dbmanagerUrl}/fundamentals/market-daily?trade_date=${encodeURIComponent(tradeDate)}`, { timeout: 12000 });
      const targetRows = Array.isArray(targetResp.data?.data) ? targetResp.data.data : Array.isArray(targetResp.data) ? targetResp.data : [];
      const symbols = [...new Set(targetRows.map((r) => (r?.symbol ? String(r.symbol).toUpperCase() : null)).filter(Boolean))];
      if (!symbols.length) return res.json({ ok: true, data: [] });

      const latestResp = await axios.get(`${dbmanagerUrl}/fundamentals/market-daily/latest?symbols=${encodeURIComponent(symbols.join(","))}`, { timeout: 12000 });
      const latestRows = Array.isArray(latestResp.data?.data) ? latestResp.data.data : Array.isArray(latestResp.data) ? latestResp.data : [];
      const latestBySymbol = new Map(latestRows.map((row) => [String(row.symbol).toUpperCase(), row]));

      const computeDelta = (latestVal, targetVal) => {
        const l = safeNum(latestVal);
        const t = safeNum(targetVal);
        if (l === null || t === null) return { abs: null, pct: null };
        const abs = l - t;
        return { abs, pct: t !== 0 ? (abs / t) * 100 : null };
      };

      const data = targetRows.map((row) => {
        const symbol = String(row.symbol).toUpperCase();
        const latest = latestBySymbol.get(symbol) || null;
        return {
          symbol,
          target: { trade_date: normalizeMarketDate(row.trade_date || row.tradeDate || row.date), open: safeNum(row.open), close: safeNum(row.close), high: safeNum(row.high), low: safeNum(row.low), volume: safeNum(row.volume) },
          latest: latest ? { trade_date: normalizeMarketDate(latest.trade_date || latest.tradeDate || latest.date), open: safeNum(latest.open), close: safeNum(latest.close), high: safeNum(latest.high), low: safeNum(latest.low), volume: safeNum(latest.volume) } : null,
          delta: {
            open_abs: computeDelta(latest?.open, row.open).abs, open_pct: computeDelta(latest?.open, row.open).pct,
            close_abs: computeDelta(latest?.close, row.close).abs, close_pct: computeDelta(latest?.close, row.close).pct,
            high_abs: computeDelta(latest?.high, row.high).abs, high_pct: computeDelta(latest?.high, row.high).pct,
            low_abs: computeDelta(latest?.low, row.low).abs, low_pct: computeDelta(latest?.low, row.low).pct,
          },
        };
      });
      return res.json({ ok: true, data });
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore confronto market_daily" });
    }
  });

  // CRUD market_daily_jobs (proxy verso datahub)
  router.get("/market-daily-jobs/:id", async (req, res) => {
    const fn = "marketDaily.GET:/market-daily-jobs/:id";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const resp = await datahubAxios.get(`/api/table/market_daily_jobs/${encodeURIComponent(id)}`);
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura market_daily_jobs" });
    }
  });

  router.get("/market-daily-jobs", async (req, res) => {
    const fn = "marketDaily.GET:/market-daily-jobs";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const { job_id, jobId, status, limit } = req.query;
      const requestedLimit = limit !== undefined ? Math.min(Math.max(Number(limit) || 20, 1), 1000) : 20;
      const qs = new URLSearchParams({
        ...(job_id !== undefined ? { job_id: String(job_id) } : {}),
        ...(jobId !== undefined ? { job_id: String(jobId) } : {}),
        ...(status !== undefined ? { status: String(status) } : {}),
        limit: "1000",
      });
      const resp = await datahubAxios.get(`/api/table/market_daily_jobs?${qs.toString()}`);
      const data = resp.data;
      if (Array.isArray(data?.items)) {
        data.items.sort((a, b) => (b.finished_at || "").localeCompare(a.finished_at || ""));
        data.items = data.items.slice(0, requestedLimit);
        data.count = data.items.length;
      }
      res.set("Cache-Control", "no-store");
      return res.json(data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura market_daily_jobs" });
    }
  });

  router.post("/market-daily-jobs", async (req, res) => {
    const fn = "marketDaily.POST:/market-daily-jobs";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const resp = await datahubAxios.post(`/api/table/market_daily_jobs`, req.body || {});
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore inserimento market_daily_jobs" });
    }
  });

  router.put("/market-daily-jobs/:id", async (req, res) => {
    const fn = "marketDaily.PUT:/market-daily-jobs/:id";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const resp = await datahubAxios.put(`/api/table/market_daily_jobs/${encodeURIComponent(id)}`, req.body || {});
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento market_daily_jobs" });
    }
  });

  router.delete("/market-daily-jobs/:id", async (req, res) => {
    const fn = "marketDaily.DELETE:/market-daily-jobs/:id";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const resp = await datahubAxios.delete(`/api/table/market_daily_jobs/${encodeURIComponent(id)}`);
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore cancellazione market_daily_jobs" });
    }
  });

  return router;
};
