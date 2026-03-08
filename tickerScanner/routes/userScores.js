"use strict";

const axios = require("axios");
const { Router } = require("express");
const { createDatahubAdapter } = require("../../shared/datahubAdapter");
const { verifyInternalToken } = require("../../shared/internalAuth");
const { createFetchUserId } = require("../lib/filterEngine");
const { createFetchApiKeyId } = require("../lib/weightsConfig");

const safeStringify = (val) => {
  if (val === undefined) return "";
  if (typeof val === "string") return val;
  try { return JSON.stringify(val); } catch { return String(val); }
};

const getDateInTz = (zone) => {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
};

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

/**
 * buildUserScoresRouter - routes for user daily score jobs
 * Mounts at /fundamentals
 */
module.exports = function buildUserScoresRouter({ logger, getService }) {
  const router = Router();
  const dbmanagerUrl = (process.env.DATAHUB_URL || process.env.DBMANAGER_URL || "http://datahub:3000").replace(/\/+$/, "");
  const authServiceUrl = (process.env.AUTHSERVICE_URL || "http://authservice:3015").replace(/\/+$/, "");

  const datahubAxios = createDatahubAdapter(axios.create({ baseURL: dbmanagerUrl, timeout: 8000 }));
  const fetchApiKeyId = createFetchApiKeyId({ axios, dbmanagerUrl, logger });
  const fetchUserId = createFetchUserId({ axios, authServiceUrl, logger, fetchApiKeyId });

  const parseJobParams = (req, defaultJobKey = "manual") => {
    const jobKey =
      (typeof req.query.jobKey === "string" && req.query.jobKey.trim()) ||
      (typeof req.headers["x-job-key"] === "string" && req.headers["x-job-key"].trim()) ||
      (typeof req.body?.jobKey === "string" && req.body.jobKey.trim()) ||
      defaultJobKey;
    const tz =
      req.body?.timezone ||
      req.query?.timezone ||
      process.env.DEFAULT_JOB_TIMEZONE ||
      process.env.SCHEDULER_TIMEZONE ||
      "UTC";
    const defaultDate = getDateInTz(tz);
    const targetDate = (req.body?.date || req.query?.date || defaultDate).toString().slice(0, 10);
    const pipeIdRaw = req.body?.pipeId ?? req.body?.pipe_id ?? req.query?.pipeId ?? req.query?.pipe_id ?? undefined;
    const pipeId = pipeIdRaw !== undefined && pipeIdRaw !== null && pipeIdRaw !== "" ? Number(pipeIdRaw) : undefined;
    const modelName = req.body?.name ?? req.body?.note ?? req.body?.description ?? "Non specificate";
    const modelVersion = req.body?.version ?? "1.0";
    return { jobKey, targetDate, pipeId, modelName, modelVersion };
  };

  // POST /fundamentals/user-daily-scores - avvia job asincrono (authenticated user)
  router.post("/user-daily-scores", async (req, res) => {
    const fn = "userScores.POST:/user-daily-scores";
    try {
      const userId = await fetchUserId(req);
      if (!userId) {
        logger.warning(`${fn} missing auth: user-daily-scores denied`);
        return res.status(401).json({ ok: false, error: "Autenticazione mancante" });
      }
      const { jobKey, targetDate, pipeId, modelName, modelVersion } = parseJobParams(req);
      const service = getService();
      const result = await service.userDailySvc.launchJobsForUser(
        { userId, targetDate, pipeId, modelName, modelVersion, jobKey },
        { bus: service.bus, redisStatusChannel: service.redisStatusChannel, redisTelemetryChannel: service.redisTelemetryChannel }
      );
      if (result.ok === false) {
        return res.status(result.status || 400).json({ ok: false, error: result.error });
      }
      return res.json(result);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore avvio calcolo user_daily_scores" });
    }
  });

  // GET /fundamentals/user-daily-scores - lista job attivi
  router.get("/user-daily-scores", (req, res) => {
    return res.json({ ok: true, jobs: getService().userDailySvc.getActiveJobs() });
  });

  // DELETE /fundamentals/user-daily-scores/:jobId - cancella job
  router.delete("/user-daily-scores/:jobId", (req, res) => {
    const fn = "userScores.DELETE:/user-daily-scores/:jobId";
    const userDailySvc = getService().userDailySvc;
    const job = userDailySvc.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, error: "Job non trovato" });
    if (job.status === "completed" || job.status === "error") {
      return res.status(400).json({ ok: false, error: "Job già terminato" });
    }
    job.cancel = true;
    userDailySvc.updateJob(job.id, { status: "cancelled", finishedAt: new Date().toISOString() });
    if (!job.persisted) {
      userDailySvc.persistJobRecord(job.id, {
        job_id: job.id,
        user_id: Number.isFinite(Number(job.userId)) ? Number(job.userId) : null,
        pipe_id: job.pipeId ?? null,
        status: "cancelled",
        target_date: job.date,
        model_name: job.modelName || "Manual update",
        model_version: job.modelVersion || "1.0",
        total_items: job.total || 0,
        saved_items: job.saved || 0,
        error_count: job.errors?.length || 0,
        errors_json: job.errors || [],
        started_at: (job.startedAt || job.createdAt || new Date().toISOString()).replace("T", " ").slice(0, 19),
        finished_at: new Date().toISOString().replace("T", " ").slice(0, 19),
      });
    }
    logger.info(`${fn} cancelled jobId=${job.id}`);
    return res.json({ ok: true, jobId: job.id });
  });

  // GET /fundamentals/jobs - aggregate: active market-daily + user-daily-score jobs
  router.get("/jobs", async (req, res) => {
    const fn = "userScores.GET:/jobs";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const service = getService();
      const marketJobs = service.marketDailySvc.getActiveJobs();
      const userJobs = service.userDailySvc.getActiveJobs();
      const allJobs = [
        ...marketJobs.map((j) => ({ ...j, type: "market-daily" })),
        ...userJobs.map((j) => ({ ...j, type: "user-daily-score" })),
      ];
      return res.json({ ok: true, jobs: allJobs, count: allJobs.length, marketDaily: marketJobs.length, userDailyScore: userJobs.length });
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura jobs attivi" });
    }
  });

  // CRUD user_daily_score_jobs (proxy verso datahub)
  router.get("/user-daily-score-jobs/:id", async (req, res) => {
    const fn = "userScores.GET:/user-daily-score-jobs/:id";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const resp = await datahubAxios.get(`/api/table/user_daily_score_jobs/${encodeURIComponent(id)}`);
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura user_daily_score_jobs" });
    }
  });

  router.get("/user-daily-score-jobs", async (req, res) => {
    const fn = "userScores.GET:/user-daily-score-jobs";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const { pipe_id, pipeId, job_id, jobId, status, limit } = req.query;
      const requestedLimit = limit !== undefined ? Math.min(Math.max(Number(limit) || 20, 1), 1000) : 20;
      const qs = new URLSearchParams({
        user_id: String(userId),
        ...(pipe_id !== undefined ? { pipe_id: String(pipe_id) } : {}),
        ...(pipeId !== undefined ? { pipe_id: String(pipeId) } : {}),
        ...(job_id !== undefined ? { job_id: String(job_id) } : {}),
        ...(jobId !== undefined ? { job_id: String(jobId) } : {}),
        ...(status !== undefined ? { status: String(status) } : {}),
        limit: "1000",
      });
      const resp = await datahubAxios.get(`/api/table/user_daily_score_jobs?${qs.toString()}`);
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
      return res.status(500).json({ ok: false, error: "Errore lettura user_daily_score_jobs" });
    }
  });

  router.post("/user-daily-score-jobs", async (req, res) => {
    const fn = "userScores.POST:/user-daily-score-jobs";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const resp = await datahubAxios.post(`/api/table/user_daily_score_jobs`, { ...(req.body || {}), user_id: userId });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore inserimento user_daily_score_jobs" });
    }
  });

  router.put("/user-daily-score-jobs/:id", async (req, res) => {
    const fn = "userScores.PUT:/user-daily-score-jobs/:id";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const resp = await datahubAxios.put(`/api/table/user_daily_score_jobs/${encodeURIComponent(id)}`, req.body || {});
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento user_daily_score_jobs" });
    }
  });

  router.delete("/user-daily-score-jobs/:id", async (req, res) => {
    const fn = "userScores.DELETE:/user-daily-score-jobs/:id";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const resp = await datahubAxios.delete(`/api/table/user_daily_score_jobs/${encodeURIComponent(id)}`);
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore cancellazione user_daily_score_jobs" });
    }
  });

  return router;
};

/**
 * buildInternalUserScoresRouter - internal endpoint (requires x-internal-token)
 * Mounts at /internal/fundamentals
 */
module.exports.buildInternalUserScoresRouter = function buildInternalUserScoresRouter({ logger, getService }) {
  const router = Router();
  const dbmanagerUrl = (process.env.DATAHUB_URL || process.env.DBMANAGER_URL || "http://datahub:3000").replace(/\/+$/, "");

  router.post("/user-daily-scores", requireInternalToken, async (req, res) => {
    const fn = "userScores.INTERNAL.POST:/user-daily-scores";
    try {
      const jobKey =
        (typeof req.query.jobKey === "string" && req.query.jobKey.trim()) ||
        (typeof req.headers["x-job-key"] === "string" && req.headers["x-job-key"].trim()) ||
        (typeof req.body?.jobKey === "string" && req.body.jobKey.trim()) ||
        "internal";
      const tz =
        req.body?.timezone ||
        req.query?.timezone ||
        process.env.DEFAULT_JOB_TIMEZONE ||
        process.env.SCHEDULER_TIMEZONE ||
        "UTC";
      const defaultDate = getDateInTz(tz);
      const targetDate = (req.body?.date || req.query?.date || defaultDate).toString().slice(0, 10);
      const pipeIdRaw = req.body?.pipeId ?? req.body?.pipe_id ?? req.query?.pipeId ?? req.query?.pipe_id ?? undefined;
      const pipeId = pipeIdRaw !== undefined && pipeIdRaw !== null && pipeIdRaw !== "" ? Number(pipeIdRaw) : undefined;
      const modelName = req.body?.name ?? req.body?.note ?? req.body?.description ?? "Non specificate";
      const modelVersion = req.body?.version ?? "1.0";

      const userIdRaw =
        req.body?.userId ??
        req.body?.user_id ??
        req.query?.userId ??
        req.query?.user_id ??
        req.headers["x-user-id"];
      if (userIdRaw === undefined || userIdRaw === null || userIdRaw === "") {
        logger.warning(
          `${fn} missing userId | jobKey=${jobKey} | internalSub=${safeStringify(req?.internalAuth?.sub)}`
        );
        return res.status(400).json({ ok: false, error: "userId obbligatorio" });
      }
      const userId = Number(userIdRaw);
      if (!Number.isFinite(userId)) {
        logger.warning(
          `${fn} invalid userId=${safeStringify(userIdRaw)} | jobKey=${jobKey} | internalSub=${safeStringify(req?.internalAuth?.sub)}`
        );
        return res.status(400).json({ ok: false, error: "userId non valido" });
      }

      const service = getService();
      const result = await service.userDailySvc.launchJobsForUser(
        { userId, targetDate, pipeId, modelName, modelVersion, jobKey },
        { bus: service.bus, redisStatusChannel: service.redisStatusChannel, redisTelemetryChannel: service.redisTelemetryChannel }
      );
      if (result.ok === false) {
        return res.status(result.status || 400).json({ ok: false, error: result.error });
      }
      return res.json(result);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore avvio calcolo user_daily_scores interno" });
    }
  });

  return router;
};
