"use strict";

// ---------------------------------------------------------------------------
// routes/subscriptions.js — ticker subscription management
//
// Same API surface as market-data-service so decision-engine can point here
// by changing MARKETDATASERVICE_URL env var.
//
// POST   /subscriptions           — subscribe tickers (body: { tickers: [...] })
// GET    /subscriptions           — list subscribed tickers
// DELETE /subscriptions/:symbol   — unsubscribe one ticker
// DELETE /subscriptions           — clear all tickers
// ---------------------------------------------------------------------------

const { Router } = require("express");

module.exports = function createSubscriptionsRouter({ logger, getService }) {
  const router = Router();

  // POST /subscriptions — { tickers: ["AAPL", "MRNA"] }
  router.post("/", (req, res) => {
    const { tickers } = req.body || {};
    if (!Array.isArray(tickers) || !tickers.length) {
      return res.status(400).json({ ok: false, error: "tickers array is required" });
    }
    const svc = getService();
    svc.addSubscriptions(tickers);
    const subscribed = svc.getSubscriptions();
    logger?.info?.(`[subscriptions] +${tickers.length} tickers → total=${subscribed.length}`);
    res.json({ ok: true, subscribed });
  });

  // GET /subscriptions
  router.get("/", (req, res) => {
    const svc = getService();
    res.json({ ok: true, subscribed: svc.getSubscriptions() });
  });

  // DELETE /subscriptions — clear all (must be before /:symbol to avoid ambiguity)
  router.delete("/", (req, res) => {
    const svc = getService();
    svc.clearSubscriptions();
    logger?.info?.("[subscriptions] all cleared");
    res.json({ ok: true, subscribed: [] });
  });

  // DELETE /subscriptions/:symbol
  router.delete("/:symbol", (req, res) => {
    const symbol = String(req.params.symbol || "").toUpperCase();
    if (!symbol) return res.status(400).json({ ok: false, error: "symbol required" });
    const svc = getService();
    svc.removeSubscription(symbol);
    logger?.info?.(`[subscriptions] removed ${symbol}`);
    res.json({ ok: true, subscribed: svc.getSubscriptions() });
  });

  return router;
};
