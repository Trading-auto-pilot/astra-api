"use strict";

/**
 * routes/internal.js
 *
 * Internal token-authenticated route handlers.
 * These are NOT mounted as a sub-router; instead they are exposed as arrays
 * [middleware, handler] so server.js can mount them at specific paths:
 *
 *   app.post("/internal/spot-finder/:pipeId",       ...handlers.spotFinder)
 *   app.post("/internal/spot-finder/live/:pipeId",  ...handlers.live)
 *   app.delete("/internal/spot-finder/live/:pipeId",...handlers.liveStop)
 *
 * The pattern preserves backwards-compatibility with the existing server.js
 * mounting code (Array.isArray(router._internalSpotFinder) check).
 */

const { verifyInternalToken } = require("../../shared/internalAuth");
const { getConfigString } = require("../../shared/loadSettings");
const { reportJobDone } = require("../../shared/jobReporter");
const C = require("../modules/constants");
const { newJobId } = require("../modules/job-manager");
const { startAsyncSpotFinder, runLiveSnapshot, stopLive } = require("../modules/spotFinderOrchestrator");

/**
 * Build requireInternalToken middleware for this service.
 * @param {object} [logger]
 * @returns {Function} Express async middleware
 */
function buildRequireInternalToken(logger) {
  return async (req, res, next) => {
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
        publicKey: getConfigString("INTERNAL_JWT_PUBLIC_KEY", ""),
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
}

/**
 * Resolve userId from internal request (body, query, headers, internalAuth).
 * Returns a numeric userId, or 0 for pipeId=0 (ranking daily), or null on error.
 */
function resolveInternalUserId(req, pipeId, logger, context) {
  const userIdRaw =
    req.body?.userId ??
    req.body?.user_id ??
    req.query?.userId ??
    req.query?.user_id ??
    req.headers["x-user-id"] ??
    req.internalAuth?.userId ??
    req.internalAuth?.sub;
  const userId = Number(userIdRaw);
  if (Number.isFinite(userId)) return userId;
  if (pipeId === C.RANKING_DAILY_PIPE_ID) {
    logger?.warning?.(
      `[decision-engine] ${context} missing/invalid userId for pipeId=0, fallback userId=0`
    );
    return 0;
  }
  logger?.warning?.(
    `[decision-engine] ${context} missing/invalid userId | pipeId=${pipeId} raw=${String(userIdRaw ?? "")}`
  );
  return null;
}

/**
 * Build all internal route handler arrays.
 *
 * @param {object} deps  Shared dependency context from decision-engine factory
 * @returns {{ spotFinder: Function[], live: Function[], liveStop: Function[] }}
 */
function buildInternalRouteHandlers(deps) {
  const { bus, resolveService, logger } = deps;
  const requireInternalToken = buildRequireInternalToken(logger);

  // POST /internal/spot-finder/:pipeId
  const internalSpotFinderHandler = async (req, res) => {
    const pipeId = Number(String(req.params.pipeId || "").trim());
    const userId = resolveInternalUserId(req, pipeId, logger, "internal spot-finder");
    if (userId === null) {
      return res.status(400).json({ ok: false, error: "userId obbligatorio" });
    }
    return startAsyncSpotFinder(req, res, deps, userId);
  };

  // POST /internal/spot-finder/live/:pipeId
  const internalSpotFinderLiveHandler = async (req, res) => {
    const pipeId = Number(String(req.params.pipeId || "").trim());
    if (!Number.isFinite(pipeId)) {
      return res.status(400).json({ ok: false, error: "pipeId must be a number" });
    }
    const userId = resolveInternalUserId(req, pipeId, logger, "internal live spot-finder");
    if (userId === null) {
      return res.status(400).json({ ok: false, error: "userId obbligatorio" });
    }
    const jobId = newJobId();
    const statusChannel = resolveService()?.redisStatusChannel;
    setImmediate(async () => {
      try {
        const summary = await runLiveSnapshot(req, pipeId, userId, deps);
        await reportJobDone(bus(), statusChannel, jobId, { status: "COMPLETED", summary });
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

  // DELETE /internal/spot-finder/live/:pipeId
  const internalSpotFinderLiveStopHandler = async (req, res) => {
    const pipeId = Number(String(req.params.pipeId || "").trim());
    const userId = resolveInternalUserId(req, pipeId, logger, "internal live stop");
    if (userId === null) {
      return res.status(400).json({ ok: false, error: "userId obbligatorio" });
    }
    return stopLive(req, res, deps, userId);
  };

  return {
    spotFinder: [requireInternalToken, internalSpotFinderHandler],
    live: [requireInternalToken, internalSpotFinderLiveHandler],
    liveStop: [requireInternalToken, internalSpotFinderLiveStopHandler],
  };
}

module.exports = { buildInternalRouteHandlers, buildRequireInternalToken };
