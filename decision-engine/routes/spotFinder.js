"use strict";

/**
 * routes/spotFinder.js
 *
 * Thin Express router for spot-finder endpoints.
 * All business logic delegated to modules/spotFinderOrchestrator.js and modules/spotFinderAnalysis.js.
 *
 * Routes:
 *  POST /:pipeId              — start async job
 *  GET  /jobs/:jobId          — job status
 *  POST /jobs/:jobId/stop     — cancel job
 *  GET  /latest/:pipeId       — latest Redis snapshot
 *  GET  /:pipeId              — sync pipe execution
 *  GET  /                     — single-ticker analysis
 */

const express = require("express");
const { asNumber, resolveSnapshotDate } = require("../modules/helpers");
const { getJob, cancelJob, buildSpotFinderRedisKey, persistSpotFinderSnapshot } = require("../modules/job-manager");
const { handlePipeSpotFinder, startAsyncSpotFinder } = require("../modules/spotFinderOrchestrator");
const { runSpotFinderAnalysis } = require("../modules/spotFinderAnalysis");

/**
 * @param {object} deps  Shared dependency context created by decision-engine factory
 * @returns {express.Router}
 */
function buildSpotFinderRouter(deps) {
  const { bus, logger, resolveUserId } = deps;
  const router = express.Router();

  // POST /:pipeId — start async job
  router.post("/:pipeId", async (req, res) => startAsyncSpotFinder(req, res, deps));

  // GET /jobs/:jobId — job status
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

  // POST /jobs/:jobId/stop — cancel job
  router.post("/jobs/:jobId/stop", async (req, res) => {
    const jobId = String(req.params.jobId || "").trim();
    const job = cancelJob(jobId);
    if (!job) {
      return res.status(404).json({ ok: false, error: "job not found" });
    }
    if (job.pipeId && job.userId) {
      await persistSpotFinderSnapshot(bus(), job.pipeId, job.userId, job, job.asOfDate, logger);
    }
    return res.json({ ok: true, jobId, status: job.status, finishedAt: job.finishedAt ?? null });
  });

  // GET /latest/:pipeId — latest Redis snapshot
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
      const key = buildSpotFinderRedisKey(b, pipeId, userId, snapshotDate);
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

  // GET /:pipeId — sync pipe execution (must come before GET /)
  router.get("/:pipeId", async (req, res) => handlePipeSpotFinder(req, res, deps));

  // GET / — single-ticker analysis
  router.get("/", async (req, res) => {
    const ticker = String(req.query.ticker || req.query.symbol || "").trim().toUpperCase();
    if (!ticker) {
      return res.status(400).json({ ok: false, error: "ticker is required" });
    }
    try {
      const result = await runSpotFinderAnalysis(req.query, {
        cachemanagerUrl: deps.cachemanagerUrl,
        cacheManagerTimeoutMs: deps.cacheManagerTimeoutMs,
        logger,
      });
      if (!result.ok && result._status) {
        const { _status, ...body } = result;
        return res.status(_status).json(body);
      }
      return res.json(result);
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
}

module.exports = { buildSpotFinderRouter };
