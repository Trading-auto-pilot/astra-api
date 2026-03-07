"use strict";

/**
 * routes/universe.js — HTTP layer per /universe
 *
 * Responsabilità esclusivamente HTTP:
 *   • proxy CRUD → datahub /api/table/universe
 *   • trigger / monitor job di scan Phase 1
 *
 * Logica di business → lib/universeService.js
 * Logica di job      → modules/scanJob.js (in-memory)
 */

const { Router } = require("express");
const axios      = require("axios");
const { createDatahubAdapter } = require("../../shared/datahubAdapter");
const { createFetchUserId }    = require("../lib/filterEngine");
const { createFetchApiKeyId }  = require("../lib/weightsConfig");
const { verifyInternalToken }  = require("../../shared/internalAuth");

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
      audience: "tickerscanner",
    });
    req.internalAuth = payload;
    return next();
  } catch (err) {
    return res.status(403).json({ ok: false, error: `Internal token non valido: ${err?.message || String(err)}` });
  }
};

const safeStringify = (v) => {
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
};

module.exports = function buildUniverseRouter({ logger, getService }) {
  const router = Router();

  const datahubUrl    = (process.env.DATAHUB_URL || process.env.DBMANAGER_URL || "http://datahub:3000").replace(/\/+$/, "");
  const authServiceUrl = (process.env.AUTHSERVICE_URL || "http://authservice:3015").replace(/\/+$/, "");

  const datahubAxios  = createDatahubAdapter(axios.create({ baseURL: datahubUrl, timeout: 10000 }));
  const fetchApiKeyId = createFetchApiKeyId({ axios, dbmanagerUrl: datahubUrl, logger });
  const fetchUserId   = createFetchUserId({ axios, authServiceUrl, logger, fetchApiKeyId });

  // ----------------------------------------------------------------
  // Scan job management (delegated to TickerScanner service)
  // ----------------------------------------------------------------

  // POST /universe/scan — scan solo simboli nuovi (non in universe)
  router.post("/scan", async (req, res) => {
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const service = getService();
      const info = await service.startUniverseScan(req.body || {}, { forceRefresh: false });
      return res.json({ ok: true, type: "async", ...info });
    } catch (err) {
      logger.error(`[POST /universe/scan] ${safeStringify(err?.message || err)}`);
      return res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // POST /universe/scan/force — forza ricalcolo su tutti i simboli
  router.post("/scan/force", async (req, res) => {
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const service = getService();
      const info = await service.startUniverseScan(req.body || {}, { forceRefresh: true });
      return res.json({ ok: true, type: "async", ...info });
    } catch (err) {
      logger.error(`[POST /universe/scan/force] ${safeStringify(err?.message || err)}`);
      return res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // GET /universe/scan/jobs — elenco job attivi
  router.get("/scan/jobs", async (req, res) => {
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const service = getService();
      const jobs = service.getActiveUniverseJobs();
      return res.json({ ok: true, jobs });
    } catch (err) {
      logger.error(`[GET /universe/scan/jobs] ${safeStringify(err?.message || err)}`);
      return res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // GET /universe/scan/status/:jobId — stato di un job specifico
  router.get("/scan/status/:jobId", async (req, res) => {
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const service = getService();
      const job = service.getUniverseScanStatus(req.params.jobId);
      return res.json({ ok: true, job });
    } catch (err) {
      if (err?.code === "NOT_FOUND") return res.status(404).json({ ok: false, error: "Job non trovato" });
      logger.error(`[GET /universe/scan/status] ${safeStringify(err?.message || err)}`);
      return res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // DELETE /universe/scan/jobs/:jobId — cancella un job
  router.delete("/scan/jobs/:jobId", async (req, res) => {
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const service = getService();
      const job = service.cancelUniverseScanJob(req.params.jobId);
      return res.json({ ok: true, job });
    } catch (err) {
      if (err?.code === "NOT_FOUND") return res.status(404).json({ ok: false, error: "Job non trovato" });
      logger.error(`[DELETE /universe/scan/jobs] ${safeStringify(err?.message || err)}`);
      return res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // ----------------------------------------------------------------
  // CRUD proxy → datahub /api/table/universe
  // ----------------------------------------------------------------

  // GET /universe — lista simboli (paginabile con ?limit=&offset=)
  router.get("/", async (req, res) => {
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const { limit = 5000, offset = 0, ...rest } = req.query;
      const qs = new URLSearchParams({ limit: String(limit), offset: String(offset), ...rest });
      const resp = await datahubAxios.get(`/api/table/universe?${qs.toString()}`);
      return res.json({ ok: true, ...resp.data });
    } catch (err) {
      logger.error(`[GET /universe] ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura universe" });
    }
  });

  // GET /universe/:symbol — record singolo
  // NOTA: questa route deve essere ULTIMA (catch-all sul segment :symbol)
  router.get("/:symbol", async (req, res) => {
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const symbol = String(req.params.symbol).toUpperCase();
      const resp = await datahubAxios.get(`/api/table/universe/${encodeURIComponent(symbol)}`);
      return res.json({ ok: true, data: resp.data });
    } catch (err) {
      if (err?.response?.status === 404) {
        return res.status(404).json({ ok: false, error: "Simbolo non trovato" });
      }
      logger.error(`[GET /universe/:symbol] ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura universe" });
    }
  });

  return router;
};

/**
 * buildInternalUniverseRouter — internal endpoints for scheduler/system calls.
 * Authenticated via x-internal-token (no user session required).
 * Mount at: /internal/universe
 */
module.exports.buildInternalUniverseRouter = function buildInternalUniverseRouter({ logger, getService }) {
  const router = Router();

  // POST /internal/universe/scan — avvia scan (no userId richiesto, auth via x-internal-token)
  router.post("/scan", requireInternalToken, async (req, res) => {
    try {
      const service = getService();
      const info = await service.startUniverseScan(req.body || {}, { forceRefresh: false });
      return res.json({ ok: true, type: "async", ...info });
    } catch (err) {
      logger.error(`[INTERNAL POST /universe/scan] ${safeStringify(err?.message || err)}`);
      return res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // POST /internal/universe/scan/force — forza ricalcolo su tutti i simboli
  router.post("/scan/force", requireInternalToken, async (req, res) => {
    try {
      const service = getService();
      const info = await service.startUniverseScan(req.body || {}, { forceRefresh: true });
      return res.json({ ok: true, type: "async", ...info });
    } catch (err) {
      logger.error(`[INTERNAL POST /universe/scan/force] ${safeStringify(err?.message || err)}`);
      return res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  return router;
};
