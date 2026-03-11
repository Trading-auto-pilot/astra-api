"use strict";

// ---------------------------------------------------------------------------
// routes/session.js — simulation session management
//
// POST   /session        — configure session (startDate, endDate, tf, dataSource)
// GET    /session        — get current session state
// DELETE /session        — stop session
// POST   /session/tick   — advance one step and publish snapshots to Redis
// ---------------------------------------------------------------------------

const { Router } = require("express");

module.exports = function createSessionRouter({ logger, getService }) {
  const router = Router();

  // GET /session
  router.get("/", (req, res) => {
    const svc = getService();
    res.json({ ok: true, session: svc.getSession() });
  });

  // POST /session
  router.post("/", (req, res) => {
    const { startDate, endDate, tf, dataSource, dataSourceConfig, mode, intervalMs, tickers } = req.body || {};
    if (!startDate || !endDate) {
      return res.status(400).json({ ok: false, error: "startDate and endDate are required" });
    }
    try {
      new Date(startDate).toISOString();
      new Date(endDate).toISOString();
    } catch {
      return res.status(400).json({ ok: false, error: "startDate / endDate must be valid ISO dates" });
    }
    if (new Date(startDate) >= new Date(endDate)) {
      return res.status(400).json({ ok: false, error: "startDate must be before endDate" });
    }
    if (mode && mode !== "passive" && mode !== "inject") {
      return res.status(400).json({ ok: false, error: "mode must be 'passive' or 'inject'" });
    }

    const svc = getService();
    if (Array.isArray(tickers) && tickers.length > 0) {
      svc.addSubscriptions(tickers);
      logger?.info?.(`[session] auto-subscribed ${tickers.length} tickers from POST /session`);
    }
    const subscribed = svc.getSubscriptions();
    if (mode === "inject" && subscribed.length === 0) {
      logger?.warning?.(
        "[session] inject mode started with 0 tickers — waiting for subscriptions"
      );
    }
    svc.configureSession({ startDate, endDate, tf, dataSource, dataSourceConfig, mode, intervalMs });
    logger?.info?.(
      `[session] configured startDate=${startDate} endDate=${endDate} tf=${tf || "1Day"} source=${dataSource || "cachemanager"} mode=${mode || "passive"} tickers=${subscribed.length}`
    );

    // Mode 2: start auto-inject loop immediately
    if (mode === "inject") {
      svc.startInjectLoop();
    }

    res.json({ ok: true, session: svc.getSession() });
  });

  // DELETE /session
  router.delete("/", (req, res) => {
    const svc = getService();
    svc.stopSession();
    logger?.info?.("[session] stopped");
    res.json({ ok: true });
  });

  // POST /session/tick — advance one candle step and publish snapshots for all tickers
  router.post("/tick", async (req, res) => {
    const svc = getService();
    try {
      const result = await svc.tick();
      res.json({ ok: true, ...result });
    } catch (err) {
      logger?.warning?.(`[session/tick] ${err?.message || String(err)}`);
      res.status(400).json({ ok: false, error: err?.message || "tick failed" });
    }
  });

  return router;
};
