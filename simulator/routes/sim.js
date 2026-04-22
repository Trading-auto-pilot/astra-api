"use strict";

// ---------------------------------------------------------------------------
// routes/sim.js — Simulation control plane
//
// Mounted at /sim by server.js.
// These routes drive the sim lifecycle and are called by the sim-engine client
// (or by integration tests / the future SimScheduler).
//
// POST /sim/start          — initialize run (preload candles, reset account)
// POST /sim/tick           — advance one time step (sync mode)
// POST /sim/stop           — finalize and return KPIs
// GET  /sim/status         — live progress snapshot
// GET  /sim/results/:runId — last completed run KPIs
// ---------------------------------------------------------------------------

const express           = require("express");
const simController     = require("../modules/simController");
const { publishSnapshot } = require("../lib/snapshotPublisher");

function createSimRouter({ getService, logger }) {
  const router = express.Router();

  // POST /sim/start
  router.post("/start", async (req, res) => {
    try {
      const {
        fromDate, toDate, tickers,
        tf, initialCapital, slippagePct,
        commissionPerShare, dataSource, dataSourceConfig,
      } = req.body || {};

      if (!fromDate || !toDate) {
        return res.status(400).json({ ok: false, error: "fromDate and toDate are required" });
      }

      const svc = getService();
      if (!svc?._fetcher) {
        return res.status(503).json({ ok: false, error: "Simulator not initialized yet" });
      }

      // tickers[] is optional: if not provided, simController reads DE subscriptions from sessionState
      const result = await simController.start(
        { fromDate, toDate, tickers: Array.isArray(tickers) ? tickers : [], tf, initialCapital, slippagePct, commissionPerShare, dataSource, dataSourceConfig },
        svc._fetcher,
        logger,
        svc
      );
      return res.json(result);
    } catch (err) {
      logger?.warning?.(`[POST /sim/start] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: err?.message || "Start failed" });
    }
  });

  // GET /sim/preview — next-tick candles without advancing the clock
  router.get("/preview", async (req, res) => {
    try {
      const result = await simController.preview(logger);
      return res.json(result);
    } catch (err) {
      logger?.warning?.(`[GET /sim/preview] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: err?.message || "Preview failed" });
    }
  });

  // POST /sim/tick
  router.post("/tick", async (req, res) => {
    try {
      // Optional: candleOverrides from frontend (user-edited candles)
      const candleOverrides = (req.body && typeof req.body.candleOverrides === "object")
        ? req.body.candleOverrides
        : {};
      const result = await simController.tick(logger, candleOverrides);

      // Publish candles to Redis so DE receives them exactly as in live mode.
      // Done here (not in simController) to guarantee access to the live bus instance.
      const svc = getService();
      const bus = svc?.bus;
      const channel = svc?.marketDataChannel;
      if (bus && channel && result.candles && Object.keys(result.candles).length > 0) {
        await Promise.all(
          Object.entries(result.candles).map(([sym, candle]) =>
            publishSnapshot(bus, channel, sym, candle).catch((e) => {
              logger?.warning?.(`[tick] publish ${sym} failed: ${e?.message}`);
            })
          )
        );
        logger?.info?.(`[tick] published ${Object.keys(result.candles).length} candles to ${channel} date=${result.date}`);
      } else {
        logger?.warning?.(`[tick] publish skipped — bus=${!!bus} channel=${channel} candles=${Object.keys(result.candles ?? {}).length}`);
      }

      return res.json(result);
    } catch (err) {
      logger?.warning?.(`[POST /sim/tick] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: err?.message || "Tick failed" });
    }
  });

  // POST /sim/stop
  router.post("/stop", (req, res) => {
    try {
      const result = simController.stop(logger);
      return res.json(result);
    } catch (err) {
      logger?.warning?.(`[POST /sim/stop] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: err?.message || "Stop failed" });
    }
  });

  // GET /sim/status
  router.get("/status", (_req, res) => {
    try {
      return res.json(simController.getStatus());
    } catch (err) {
      logger?.warning?.(`[GET /sim/status] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: "Status unavailable" });
    }
  });

  // GET /sim/results/:runId
  router.get("/results/:runId", (req, res) => {
    try {
      const { runId } = req.params;
      const result = simController.getResults(runId);
      if (!result) {
        return res.status(404).json({ ok: false, error: `Run ${runId} not found` });
      }
      return res.json(result);
    } catch (err) {
      logger?.warning?.(`[GET /sim/results] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: "Results unavailable" });
    }
  });

  return router;
}

module.exports = createSimRouter;
