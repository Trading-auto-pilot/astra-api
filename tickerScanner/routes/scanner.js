"use strict";

const { Router } = require("express");
const path = require("path");
const fs = require("fs/promises");
const { reportJobDone } = require("../../shared/jobReporter");

module.exports = function buildScannerRouter({ logger, getService }) {
  const router = Router();

  // GET /screener
  router.get("/screener", async (_req, res) => {
    const service = getService();
    if (!service?.runScreener) {
      return res.status(501).json({ ok: false, error: "runScreener() not implemented" });
    }
    try {
      const result = await service.runScreener();
      return res.json({ ok: true, ...result });
    } catch (e) {
      logger.error(`[GET /screener] Error: ${e?.message || String(e)}`);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // GET /scan
  router.get("/scan", async (req, res) => {
    const service = getService();
    if (!service?.startScanJob) {
      return res.status(501).json({ ok: false, error: "startScanJob() not implemented" });
    }
    try {
      const overrides = { ...(req.query || {}) };
      const jobKey =
        (typeof req.query.jobKey === "string" && req.query.jobKey.trim()) ||
        (typeof req.headers["x-job-key"] === "string" && req.headers["x-job-key"].trim()) ||
        "";
      if (jobKey) overrides.__jobKey = jobKey;
      const info = await service.startScanJob(overrides);
      return res.json({ ok: true, type: "async", ...info });
    } catch (e) {
      logger.error(`[GET /scan] Error: ${e?.message || String(e)}`);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // GET /scan/force
  router.get("/scan/force", async (req, res) => {
    const service = getService();
    if (!service?.startScanJob) {
      return res.status(501).json({ ok: false, error: "startScanJob() not implemented" });
    }
    try {
      const overrides = { ...(req.query || {}) };
      const jobKey =
        (typeof req.query.jobKey === "string" && req.query.jobKey.trim()) ||
        (typeof req.headers["x-job-key"] === "string" && req.headers["x-job-key"].trim()) ||
        "";
      if (jobKey) overrides.__jobKey = jobKey;
      const info = await service.startScanJob(overrides, { forceRefresh: true });
      return res.json({ ok: true, type: "async", ...info });
    } catch (e) {
      logger.error(`[GET /scan/force] Error: ${e?.message || String(e)}`);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // GET /scan/status/:jobId
  router.get("/scan/status/:jobId", async (req, res) => {
    const service = getService();
    if (!service?.getScanStatus) {
      return res.status(501).json({ ok: false, error: "getScanStatus() not implemented" });
    }
    try {
      const job = service.getScanStatus(req.params.jobId);
      return res.json({ ok: true, job });
    } catch (e) {
      if (e.code === "NOT_FOUND") return res.status(404).json({ ok: false, error: "Job not found" });
      logger.error(`[GET /scan/status] Error: ${e?.message || String(e)}`);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // GET /scan/jobs
  router.get("/scan/jobs", async (_req, res) => {
    const service = getService();
    if (!service?.getRunningScanJobs) {
      return res.status(501).json({ ok: false, error: "getRunningScanJobs() not implemented" });
    }
    try {
      const jobs = service.getRunningScanJobs();
      return res.json({ ok: true, jobs });
    } catch (e) {
      logger.error(`[GET /scan/jobs] Error: ${e?.message || String(e)}`);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // DELETE /scan/jobs/:jobId
  router.delete("/scan/jobs/:jobId", async (req, res) => {
    const service = getService();
    if (!service?.cancelScanJob) {
      return res.status(501).json({ ok: false, error: "cancelScanJob() not implemented" });
    }
    try {
      const job = service.cancelScanJob(req.params.jobId);
      if (!job) return res.status(404).json({ ok: false, error: "Job not found" });
      return res.json({ ok: true, job });
    } catch (e) {
      logger.error(`[DELETE /scan/jobs] Error: ${e?.message || String(e)}`);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // POST /momentum/refresh
  router.post("/momentum/refresh", async (req, res) => {
    const service = getService();
    if (!service?.refreshMomentumAll) {
      return res.status(501).json({ ok: false, error: "refreshMomentumAll() not implemented" });
    }
    try {
      const jobKey =
        (typeof req.query.jobKey === "string" && req.query.jobKey.trim()) ||
        (typeof req.headers["x-job-key"] === "string" && req.headers["x-job-key"].trim()) ||
        (typeof req.body?.jobKey === "string" && req.body.jobKey.trim()) ||
        "manual";
      const jobId = `momentum_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const startedAt = new Date().toISOString();

      logger.info(`[momentumRefresh] jobId=${jobId} started jobKey=${jobKey}`);

      (async () => {
        const startedAtMs = Date.now();
        try {
          const info = await service.refreshMomentumAll();
          const finishedAt = new Date().toISOString();
          const payload = {
            type: "momentumRefresh", jobKey, jobId, startedAt, finishedAt,
            durationMs: Date.now() - startedAtMs,
            totalSymbols: info?.totalSymbols ?? 0, totalUpdated: info?.totalUpdated ?? 0,
            status: "COMPLETED", __source: "tickerscanner",
          };
          try {
            await service.bus?.publish?.(service.redisTelemetryChannel, payload);
          } catch (publishErr) {
            logger.warning?.(`[momentumRefresh] telemetry publish failed: ${publishErr?.message || String(publishErr)}`);
          }
          await reportJobDone(service.bus, service.redisStatusChannel, jobId, { status: "COMPLETED" });
          logger.info(`[momentumRefresh] jobId=${jobId} completed totalSymbols=${info?.totalSymbols ?? "?"} totalUpdated=${info?.totalUpdated ?? "?"}`);
        } catch (err) {
          const finishedAt = new Date().toISOString();
          const payload = {
            type: "momentumRefresh", jobKey, jobId, startedAt, finishedAt,
            durationMs: Date.now() - startedAtMs,
            status: "FAILED", error: err?.message || String(err), __source: "tickerscanner",
          };
          try {
            await service.bus?.publish?.(service.redisTelemetryChannel, payload);
          } catch (publishErr) {
            logger.warning?.(`[momentumRefresh] telemetry publish failed: ${publishErr?.message || String(publishErr)}`);
          }
          await reportJobDone(service.bus, service.redisStatusChannel, jobId, { status: "FAILED", error: err?.message || String(err) });
          logger.error(`[momentumRefresh] jobId=${jobId} failed: ${err?.message || String(err)}`);
        }
      })();

      return res.json({ ok: true, type: "async", started: true, jobId, jobKey, startedAt });
    } catch (e) {
      logger.error(`[POST /momentum/refresh] Error: ${e?.message || String(e)}`);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // GET /glossary/:fileName
  router.get("/glossary/:fileName", async (req, res) => {
    try {
      const fileName = String(req.params.fileName || "").trim();
      if (!fileName || !fileName.endsWith(".json")) {
        return res.status(400).json({ error: "Invalid glossary filename" });
      }
      if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
        return res.status(400).json({ error: "Invalid glossary filename" });
      }
      const glossaryDir = path.join(__dirname, "..", "Glossary");
      const filePath = path.join(glossaryDir, fileName);
      const raw = await fs.readFile(filePath, "utf8");
      return res.json(JSON.parse(raw));
    } catch (err) {
      if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
        return res.status(404).json({ error: "Glossary file not found" });
      }
      if (err instanceof SyntaxError) {
        logger.error(`[GET /glossary] Invalid JSON file: ${err.message}`);
        return res.status(500).json({ error: "Invalid glossary file content" });
      }
      logger.error(`[GET /glossary] Error: ${err?.message || String(err)}`);
      return res.status(500).json({ error: "Unable to load glossary file" });
    }
  });

  return router;
};
