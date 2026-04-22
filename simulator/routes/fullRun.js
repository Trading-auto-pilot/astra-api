"use strict";

// ---------------------------------------------------------------------------
// routes/fullRun.js — Full multi-day simulation endpoints
//
// POST /sim/fullrun/start  — avvia la simulazione multi-giorno (async)
// GET  /sim/fullrun/status — stato corrente del run
//
// Il run esegue in background: per ogni giorno lavorativo nel range:
//   1. update-market-daily  (tickerscanner)
//   2. user-daily-scores    (tickerscanner)
//   3. ranking/daily        (tickerscanner)
//   4. spot-finder pipe     (decision-engine)
//   5. loop intraday tick   (simulator)
// ---------------------------------------------------------------------------

const express                = require("express");
const { randomUUID }         = require("crypto");
const { runFullSimulation }  = require("../lib/fullRunOrchestrator");
const fullRunState           = require("../lib/fullRunState");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function createFullRunRouter({ getService, logger }) {
  const router = express.Router();

  // POST /sim/fullrun/start
  router.post("/start", async (req, res) => {
    const snap = fullRunState.getSnapshot();
    if (snap.active) {
      return res.status(409).json({
        ok: false,
        error: `A full run is already active (runId=${snap.runId}, day=${snap.currentDay})`,
      });
    }

    const { fromDate, toDate, pipeId, userId, tf = "1min" } = req.body || {};

    if (!fromDate || !DATE_RE.test(fromDate)) {
      return res.status(400).json({ ok: false, error: "fromDate (YYYY-MM-DD) required" });
    }
    if (!toDate || !DATE_RE.test(toDate)) {
      return res.status(400).json({ ok: false, error: "toDate (YYYY-MM-DD) required" });
    }
    if (fromDate > toDate) {
      return res.status(400).json({ ok: false, error: "fromDate must be <= toDate" });
    }
    if (!pipeId) {
      return res.status(400).json({ ok: false, error: "pipeId required" });
    }
    if (!userId) {
      return res.status(400).json({ ok: false, error: "userId required" });
    }

    const svc = getService();
    if (!svc?._fetcher) {
      return res.status(503).json({ ok: false, error: "Simulator not initialized yet" });
    }

    const runId = `FULLRUN_${randomUUID().slice(0, 8).toUpperCase()}`;

    // Fire-and-forget: the orchestrator runs in background.
    // Errors are captured in fullRunState.
    setImmediate(() =>
      runFullSimulation({
        runId,
        fromDate,
        toDate,
        pipeId,
        userId,
        tf,
        svc,
        fetcher: svc._fetcher,
        logger,
      })
    );

    logger?.info?.(`[fullRun] started runId=${runId} from=${fromDate} to=${toDate} pipeId=${pipeId}`);
    return res.json({ ok: true, runId, fromDate, toDate, pipeId, userId, tf });
  });

  // GET /sim/fullrun/status
  router.get("/status", (_req, res) => {
    return res.json({ ok: true, ...fullRunState.getSnapshot() });
  });

  // POST /sim/fullrun/stop — abort in-progress run
  router.post("/stop", (_req, res) => {
    const snap = fullRunState.getSnapshot();
    if (!snap.active) {
      return res.status(400).json({ ok: false, error: "No active full run" });
    }
    fullRunState.fail(new Error("Stopped by user"));
    logger?.info?.(`[fullRun] stopped by user runId=${snap.runId}`);
    return res.json({ ok: true, runId: snap.runId });
  });

  return router;
}

module.exports = createFullRunRouter;
