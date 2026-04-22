"use strict";

// ---------------------------------------------------------------------------
// routes/broker.js — Simulated broker-executor-ibkr API
//
// Mounted at "/" (root) because BROKER_EXECUTOR_IBKR_URL=http://sim-engine:3010
// means the decision-engine calls e.g. http://sim-engine:3010/order directly.
//
// Replicated endpoints (matching broker-executor-ibkr contract):
//   POST   /order             — place bracket order (MKT or LMT)
//   GET    /orders            — list open/all orders
//   GET    /positions         — list current positions (from accountState)
//   PUT    /order/:orderId    — modify order (stub — returns ok)
//   DELETE /order/:orderId    — cancel order
// ---------------------------------------------------------------------------

const express      = require("express");
const orderBook    = require("../modules/orderBook");
const accountState = require("../modules/accountState");

function createBrokerRouter({ logger }) {
  const router = express.Router();

  // POST /order — place order
  // Body matches broker-executor-ibkr contract:
  // { symbol, side, quantity, limitPrice?, stopLossPrice?, stopLossLimitPrice?,
  //   takeProfitPrice?, timeInForce?, externalCorrelationId?, decisionEngineRunId? }
  router.post("/order", (req, res) => {
    try {
      const {
        symbol, side, quantity,
        limitPrice, stopLossPrice, stopLossLimitPrice, takeProfitPrice,
        timeInForce, externalCorrelationId, decisionEngineRunId,
      } = req.body || {};

      if (!symbol || !side || !quantity) {
        return res.status(400).json({ ok: false, error: "symbol, side, and quantity are required" });
      }
      if (side !== "BUY" && side !== "SELL") {
        return res.status(400).json({ ok: false, error: "side must be BUY or SELL" });
      }
      if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) {
        return res.status(400).json({ ok: false, error: "quantity must be a positive number" });
      }

      const order = orderBook.createOrder({
        symbol, side, quantity: Number(quantity),
        limitPrice: limitPrice ? Number(limitPrice) : null,
        stopLossPrice: stopLossPrice ? Number(stopLossPrice) : null,
        stopLossLimitPrice: stopLossLimitPrice ? Number(stopLossLimitPrice) : null,
        takeProfitPrice: takeProfitPrice ? Number(takeProfitPrice) : null,
        timeInForce, externalCorrelationId, decisionEngineRunId,
      });

      logger?.info?.(`[broker] order created orderId=${order.orderId} symbol=${symbol} side=${side} qty=${quantity}`);
      return res.status(201).json({ ok: true, orderId: order.orderId, order });
    } catch (err) {
      logger?.warning?.(`[POST /order] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: "Failed to create order" });
    }
  });

  // GET /orders — list orders
  // Query: ?status=PENDING|FILLED|CANCELLED (optional filter)
  router.get("/orders", (req, res) => {
    try {
      const { status } = req.query;
      let orders = orderBook.getAllOrders();
      if (status) {
        orders = orders.filter((o) => o.status === String(status).toUpperCase());
      }
      return res.json({ ok: true, count: orders.length, orders });
    } catch (err) {
      logger?.warning?.(`[GET /orders] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: "Failed to list orders" });
    }
  });

  // GET /positions — list open positions from accountState
  router.get("/positions", (_req, res) => {
    try {
      const snap = accountState.getSnapshot();
      // Format as IBKR-like position list
      const positions = Object.entries(snap.positions).map(([symbol, pos]) => ({
        symbol,
        position:  pos.qty,
        avgCost:   pos.avgCost,
        mktValue:  null, // filled by mark-to-market separately
        unrealizedPnl: null,
      }));
      return res.json({ ok: true, count: positions.length, positions });
    } catch (err) {
      logger?.warning?.(`[GET /positions] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: "Failed to list positions" });
    }
  });

  // PUT /order/:orderId — modify order (stub: not supported in sim, returns ok)
  router.put("/order/:orderId", (req, res) => {
    const order = orderBook.getOrder(req.params.orderId);
    if (!order) {
      return res.status(404).json({ ok: false, error: "Order not found" });
    }
    if (order.status !== "PENDING") {
      return res.status(409).json({ ok: false, error: `Cannot modify order in status ${order.status}` });
    }
    // In sim mode, order modification is a no-op (accepted but not applied)
    logger?.info?.(`[broker] modify order stub orderId=${order.orderId} (no-op in sim mode)`);
    return res.json({ ok: true, orderId: order.orderId, note: "Order modification accepted (sim mode: no-op)" });
  });

  // DELETE /order/:orderId — cancel order
  router.delete("/order/:orderId", (req, res) => {
    try {
      const cancelled = orderBook.cancelOrder(req.params.orderId);
      if (!cancelled) {
        const order = orderBook.getOrder(req.params.orderId);
        if (!order) return res.status(404).json({ ok: false, error: "Order not found" });
        return res.status(409).json({ ok: false, error: `Cannot cancel order in status ${order.status}` });
      }
      logger?.info?.(`[broker] cancelled orderId=${req.params.orderId}`);
      return res.json({ ok: true, orderId: req.params.orderId });
    } catch (err) {
      logger?.warning?.(`[DELETE /order] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: "Failed to cancel order" });
    }
  });

  return router;
}

module.exports = createBrokerRouter;
