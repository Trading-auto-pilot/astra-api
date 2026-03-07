"use strict";

const axios = require("axios");
const { Router } = require("express");
const { createDatahubAdapter } = require("../../shared/datahubAdapter");
const { createFetchUserId } = require("../lib/filterEngine");
const { createFetchApiKeyId } = require("../lib/weightsConfig");

const safeStringify = (val) => {
  if (val === undefined) return "";
  if (typeof val === "string") return val;
  try { return JSON.stringify(val); } catch { return String(val); }
};

module.exports = function buildTickerDataRouter({ logger, getService }) {
  const router = Router();
  const dbmanagerUrl = (process.env.DATAHUB_URL || process.env.DBMANAGER_URL || "http://datahub:3000").replace(/\/+$/, "");
  const authServiceUrl = (process.env.AUTHSERVICE_URL || "http://authservice:3015").replace(/\/+$/, "");

  const datahubAxios = createDatahubAdapter(axios.create({ baseURL: dbmanagerUrl, timeout: 8000 }));

  const fetchApiKeyId = createFetchApiKeyId({ axios, dbmanagerUrl, logger });
  const fetchUserId = createFetchUserId({ axios, authServiceUrl, logger, fetchApiKeyId });

  // CRUD ticker_scan_jobs (storico scan/force)
  router.get("/ticker-scan-jobs/:id", async (req, res) => {
    const fn = "tickerData.GET:/ticker-scan-jobs/:id";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const resp = await datahubAxios.get(`/api/table/ticker_scan_jobs/${encodeURIComponent(id)}`);
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura ticker_scan_jobs" });
    }
  });

  router.get("/ticker-scan-jobs", async (req, res) => {
    const fn = "tickerData.GET:/ticker-scan-jobs";
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
      const resp = await datahubAxios.get(`/api/table/ticker_scan_jobs?${qs.toString()}`);
      const data = resp.data;
      if (Array.isArray(data?.items)) {
        data.items.sort((a, b) => (b.finished_at || "").localeCompare(a.finished_at || ""));
        data.items = data.items.slice(0, requestedLimit);
        data.count = data.items.length;
      }
      res.set("Cache-Control", "no-store");
      return res.json(data);
    } catch (err) {
      logger.error(`tickerData.GET:/ticker-scan-jobs error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura ticker_scan_jobs" });
    }
  });

  router.post("/ticker-scan-jobs", async (req, res) => {
    const fn = "tickerData.POST:/ticker-scan-jobs";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const resp = await datahubAxios.post(`/api/table/ticker_scan_jobs`, req.body || {});
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore inserimento ticker_scan_jobs" });
    }
  });

  router.put("/ticker-scan-jobs/:id", async (req, res) => {
    const fn = "tickerData.PUT:/ticker-scan-jobs/:id";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const resp = await datahubAxios.put(`/api/table/ticker_scan_jobs/${encodeURIComponent(id)}`, req.body || {});
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento ticker_scan_jobs" });
    }
  });

  router.delete("/ticker-scan-jobs/:id", async (req, res) => {
    const fn = "tickerData.DELETE:/ticker-scan-jobs/:id";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const resp = await datahubAxios.delete(`/api/table/ticker_scan_jobs/${encodeURIComponent(id)}`);
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore cancellazione ticker_scan_jobs" });
    }
  });

  // GET /scores-daily/counts/:pipeId
  router.get("/scores-daily/counts/:pipeId", async (req, res) => {
    const fn = "tickerData.GET:/scores-daily/counts/:pipeId";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const pipeId = Number(req.params.pipeId);
      if (!Number.isFinite(pipeId)) return res.status(400).json({ ok: false, error: "pipe_id non valido" });
      const url = `${dbmanagerUrl}/fundamentals/scores-daily/counts?user_id=${encodeURIComponent(userId)}&pipe_id=${encodeURIComponent(pipeId)}`;
      const resp = await axios.get(url, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura counts scores_daily" });
    }
  });

  // GET /scores-daily/by-user/:pipeId/:scoreDate
  router.get("/scores-daily/by-user/:pipeId/:scoreDate", async (req, res) => {
    const fn = "tickerData.GET:/scores-daily/by-user/:pipeId/:scoreDate";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const pipeId = Number(req.params.pipeId);
      const scoreDate = req.params.scoreDate;
      if (!Number.isFinite(pipeId) || !scoreDate) {
        return res.status(400).json({ ok: false, error: "pipe_id e score_date obbligatori" });
      }
      const url = `${dbmanagerUrl}/fundamentals/scores-daily/by-user?user_id=${encodeURIComponent(userId)}&pipe_id=${encodeURIComponent(pipeId)}&score_date=${encodeURIComponent(scoreDate)}`;
      const resp = await axios.get(url, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura scores_daily by-user" });
    }
  });

  // GET /history?symbol=XYZ&days=70
  router.get("/history", async (req, res) => {
    const fn = "tickerData.GET:/history";
    const { symbol, days } = req.query;
    try {
      const service = getService();
      const data = await service.fundamentalService.getHistory({
        symbol,
        days: days ? Number(days) : undefined,
      });
      return res.json(data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.message || err)}`);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
};
