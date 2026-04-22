"use strict";

// ---------------------------------------------------------------------------
// routes/candle.js — single candle fetch and custom snapshot injection
//
// GET  /candle          — fetch a candle from configured source
//                         ?symbol=X&date=ISO&tf=1Day[&source=cachemanager|file|redis]
// POST /candle/push     — push a custom candle as snapshot to Redis
//                         body: { symbol, candle: { t, o, h, l, c, v } }
// GET  /candle/range    — fetch a range of candles (for frontend preview)
//                         ?symbol=X&startDate=ISO&endDate=ISO&tf=1Day
// ---------------------------------------------------------------------------

const { Router } = require("express");
const { registerGetRequest } = require("../lib/sessionState");

module.exports = function createCandleRouter({ logger, getService }) {
  const router = Router();

  // GET /candle
  router.get("/", async (req, res) => {
    const { symbol, date, tf, source } = req.query;
    if (!symbol || !date) {
      return res.status(400).json({ ok: false, error: "symbol and date are required" });
    }
    const svc = getService();
    try {
      registerGetRequest({ type: "candle", symbol, date });
      const candle = await svc.fetchCandle({ symbol, date, tf: tf || "1Day", dataSource: source });
      if (!candle) {
        return res.status(404).json({ ok: false, error: `no candle found for ${symbol} at ${date}` });
      }
      res.json({ ok: true, candle });
    } catch (err) {
      logger?.warning?.(`[candle] fetch error ${symbol} ${date}: ${err?.message}`);
      res.status(500).json({ ok: false, error: err?.message || "fetch failed" });
    }
  });

  // GET /candle/range
  router.get("/range", async (req, res) => {
    const { symbol, startDate, endDate, tf } = req.query;
    if (!symbol || !startDate || !endDate) {
      return res.status(400).json({ ok: false, error: "symbol, startDate and endDate are required" });
    }
    const svc = getService();
    try {
      registerGetRequest({
        type: "range",
        symbol,
        date: `${String(startDate)}..${String(endDate)}`,
      });
      const candles = await svc.fetchRange({ symbol, startDate, endDate, tf: tf || "1Day" });
      res.json({ ok: true, count: candles.length, candles });
    } catch (err) {
      logger?.warning?.(`[candle/range] error ${symbol}: ${err?.message}`);
      res.status(500).json({ ok: false, error: err?.message || "fetch failed" });
    }
  });

  // POST /candle/push — inject a custom candle
  // body: { symbol, candle, target: "snapshot" | "pending" }
  //   "snapshot" (default) — publish directly to Redis bus
  //   "pending"            — store as override for next GET /candle (Mode 1)
  router.post("/push", async (req, res) => {
    const { symbol, candle, target = "snapshot" } = req.body || {};
    if (!symbol || !candle) {
      return res.status(400).json({ ok: false, error: "symbol and candle are required" });
    }
    if (candle.c == null && candle.close == null) {
      return res.status(400).json({ ok: false, error: "candle must have a close price (c or close)" });
    }
    if (target !== "snapshot" && target !== "pending") {
      return res.status(400).json({ ok: false, error: "target must be 'snapshot' or 'pending'" });
    }
    const svc = getService();
    try {
      if (target === "pending") {
        svc.setPendingCandle(String(symbol).toUpperCase(), candle);
        logger?.info?.(`[candle/push] stored pending override for ${symbol} close=${candle.c ?? candle.close}`);
        res.json({ ok: true, symbol, candle, target: "pending" });
      } else {
        await svc.pushCustomCandle(String(symbol).toUpperCase(), candle);
        logger?.info?.(`[candle/push] pushed custom snapshot for ${symbol} close=${candle.c ?? candle.close}`);
        res.json({ ok: true, symbol, candle, target: "snapshot" });
      }
    } catch (err) {
      logger?.warning?.(`[candle/push] error ${symbol}: ${err?.message}`);
      res.status(500).json({ ok: false, error: err?.message || "push failed" });
    }
  });

  return router;
};
