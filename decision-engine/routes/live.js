"use strict";

/**
 * routes/live.js
 *
 * Thin Express router for live-mode endpoints.
 * All business logic delegated to modules/spotFinderOrchestrator.js and modules/live-manager.js.
 *
 * Routes:
 *  POST   /live/:pipeId         — enable/disable live mode
 *  GET    /live/:pipeId         — live snapshot (async)
 *  GET    /live/:pipeId/status  — live status
 *  DELETE /live/:pipeId         — stop live
 */

const express = require("express");
const axios = require("axios");
const C = require("../modules/constants");
const { asBool, resolveSnapshotDate, pickAuthHeaders } = require("../modules/helpers");
const { loadSnapshotResults } = require("../modules/job-manager");
const { reportJobDone } = require("../../shared/jobReporter");
const { newJobId } = require("../modules/job-manager");
const { liveState, resetLiveState, activateLiveState, getLiveStatus } = require("../modules/live-manager");
const { runLiveSnapshot, stopLive } = require("../modules/spotFinderOrchestrator");
const { isTrendOk } = require("../modules/helpers");

/**
 * @param {object} deps  Shared dependency context created by decision-engine factory
 * @returns {express.Router}
 */
function buildLiveRouter(deps) {
  const { bus, resolveService, logger, marketdataserviceUrl, resolveUserId } = deps;
  const router = express.Router();

  // POST /live/:pipeId — enable or disable live mode
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
    logger?.info?.(
      `[decision-engine] POST /live/${pipeId} enable=${enable} userId=${userId} ` +
      `date=${req.query?.date || req.query?.asOfDate || req.query?.scoreDate || "-"}`
    );

    if (!enable) {
      resetLiveState("POST /live disabled", logger);
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
        pipeId, asOfDate: snapshotDate, userId, tickers: trendTickers,
        exchangeByTicker, query: req.query, authHeaders: headers,
      });

      return res.json({
        ok: true, active: true, pipeId, asOfDate: snapshotDate,
        subscribed: trendTickers, total: trendTickers.length,
      });
    } catch (err) {
      logger?.warning?.(
        `[decision-engine] live enable failed ${err?.message || String(err)}`
      );
      return res.status(502).json({ ok: false, error: "live enable failed" });
    }
  });

  // GET /live/:pipeId — run live snapshot (async job)
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
    const statusChannel = resolveService()?.redisStatusChannel;
    setImmediate(async () => {
      try {
        const summary = await runLiveSnapshot(req, pipeId, userId, deps);
        await reportJobDone(bus(), statusChannel, jobId, { status: "COMPLETED", summary });
      } catch (err) {
        logger?.warning?.(
          `[decision-engine] live snapshot failed ${err?.message || String(err)}`
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

  // GET /live/:pipeId/status — live status
  router.get("/live/:pipeId/status", async (req, res) => {
    const pipeId = Number(String(req.params.pipeId || "").trim());
    if (!Number.isFinite(pipeId)) {
      return res.status(400).json({ ok: false, error: "pipeId must be a number" });
    }
    return res.json(getLiveStatus(pipeId));
  });

  // DELETE /live/:pipeId — stop live
  router.delete("/live/:pipeId", async (req, res) => stopLive(req, res, deps));

  return router;
}

module.exports = { buildLiveRouter };
