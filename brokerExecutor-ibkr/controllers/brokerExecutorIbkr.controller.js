"use strict";

const {
  ValidationError,
  parseOrderId,
  validateCreateOrderPayload,
} = require("../validation/brokerExecutorIbkr.validation");

function toErrorResponse(err) {
  const statusCode = Number(err?.statusCode) || 500;
  const payload = {
    ok: false,
    error: err?.message || "Unexpected error",
  };
  if (err?.code) payload.code = err.code;
  if (err?.details != null) payload.details = err.details;
  return { statusCode, payload };
}

function createBrokerExecutorIbkrController({ service, logger, wsStatusProvider }) {
  async function getPositions(_req, res) {
    try {
      const items = await service.listPositions();
      return res.json({ items, count: items.length });
    } catch (err) {
      logger.error(`[getPositions] ${err?.message || String(err)}`);
      const { statusCode, payload } = toErrorResponse(err);
      return res.status(statusCode).json(payload);
    }
  }

  async function getOrders(_req, res) {
    try {
      const items = await service.listOpenOrders();
      return res.json({ items, count: items.length });
    } catch (err) {
      logger.error(`[getOrders] ${err?.message || String(err)}`);
      const { statusCode, payload } = toErrorResponse(err);
      return res.status(statusCode).json(payload);
    }
  }

  async function postOrder(req, res) {
    try {
      const payload = validateCreateOrderPayload(req.body || {});
      const result = await service.createBracketOrder(payload);
      return res.status(result?.idempotent ? 200 : 201).json({
        order: result.order,
        ...(result?.idempotent ? { idempotent: true } : {}),
      });
    } catch (err) {
      const error = err instanceof ValidationError ? err : err;
      logger.error(`[postOrder] ${error?.message || String(error)}`);
      const { statusCode, payload } = toErrorResponse(error);
      return res.status(statusCode).json(payload);
    }
  }

  async function putOrder(req, res) {
    try {
      const orderId = parseOrderId(req.params.orderId);
      const result = await service.updateBracketOrder(orderId, req.body || {});
      return res.json({ order: result.order });
    } catch (err) {
      const error = err instanceof ValidationError ? err : err;
      logger.error(`[putOrder] ${error?.message || String(error)}`);
      const { statusCode, payload } = toErrorResponse(error);
      return res.status(statusCode).json(payload);
    }
  }

  async function deleteOrder(req, res) {
    try {
      const orderId = parseOrderId(req.params.orderId);
      const result = await service.deleteOrder(orderId);
      return res.json(result);
    } catch (err) {
      const error = err instanceof ValidationError ? err : err;
      logger.error(`[deleteOrder] ${error?.message || String(error)}`);
      const { statusCode, payload } = toErrorResponse(error);
      return res.status(statusCode).json(payload);
    }
  }

  async function getWsStatus(_req, res) {
    try {
      const data = typeof wsStatusProvider === "function" ? wsStatusProvider() : null;
      return res.json({
        ok: true,
        data: data || {
          connection: { listenerStatus: "unavailable", connected: false },
          messages: [],
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      logger.error(`[getWsStatus] ${err?.message || String(err)}`);
      const { statusCode, payload } = toErrorResponse(err);
      return res.status(statusCode).json(payload);
    }
  }

  return {
    getPositions,
    getOrders,
    postOrder,
    putOrder,
    deleteOrder,
    getWsStatus,
  };
}

module.exports = {
  createBrokerExecutorIbkrController,
};
