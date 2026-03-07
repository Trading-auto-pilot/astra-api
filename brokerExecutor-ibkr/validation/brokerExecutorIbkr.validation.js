"use strict";

class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "ValidationError";
    this.statusCode = 400;
    this.details = details;
  }
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function parseOrderId(orderId) {
  const trimmed = String(orderId || "").trim();
  if (!trimmed) throw new ValidationError("orderId is required");
  return trimmed;
}

function validateCreateOrderPayload(body = {}) {
  const allowedTif = new Set(["DAY", "GTC", "IOC", "OPG"]);
  const side = String(body.side || "BUY").trim().toUpperCase();
  const symbol = String(body.symbol || "").trim().toUpperCase();
  const quantity = toNumber(body.quantity);
  const limitPrice = toNumber(body.limitPrice);
  const stopLossPrice = toNumber(body.stopLossPrice);
  const stopLossLimitPriceRaw = toNumber(body.stopLossLimitPrice);
  const stopLossLimitPrice = Number.isFinite(stopLossLimitPriceRaw)
    ? stopLossLimitPriceRaw
    : stopLossPrice;
  const takeProfitPrice = toNumber(body.takeProfitPrice);
  const rawTif = String(body.timeInForce || "DAY").trim().toUpperCase();
  const timeInForce = allowedTif.has(rawTif) ? rawTif : "DAY";
  const externalCorrelationId = body.externalCorrelationId
    ? String(body.externalCorrelationId).trim()
    : null;
  const decisionEngineRunId = body.decisionEngineRunId
    ? String(body.decisionEngineRunId).trim()
    : null;

  if (!symbol) throw new ValidationError("symbol is required");
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new ValidationError("quantity must be > 0");
  }
  if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
    throw new ValidationError("limitPrice must be > 0");
  }
  if (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0) {
    throw new ValidationError("stopLossPrice must be > 0");
  }
  if (!Number.isFinite(stopLossLimitPrice) || stopLossLimitPrice <= 0) {
    throw new ValidationError("stopLossLimitPrice must be > 0");
  }
  if (!Number.isFinite(takeProfitPrice) || takeProfitPrice <= 0) {
    throw new ValidationError("takeProfitPrice must be > 0");
  }
  if (side !== "BUY" && side !== "SELL") {
    throw new ValidationError("side must be BUY or SELL");
  }

  if (side === "BUY") {
    if (!(stopLossPrice < limitPrice)) {
      throw new ValidationError("stopLossPrice must be < limitPrice for BUY");
    }
    if (!(stopLossLimitPrice <= stopLossPrice)) {
      throw new ValidationError("stopLossLimitPrice must be <= stopLossPrice for BUY");
    }
    if (!(takeProfitPrice > limitPrice)) {
      throw new ValidationError("takeProfitPrice must be > limitPrice for BUY");
    }
  } else {
    if (!(stopLossPrice > limitPrice)) {
      throw new ValidationError("stopLossPrice must be > limitPrice for SELL");
    }
    if (!(stopLossLimitPrice >= stopLossPrice)) {
      throw new ValidationError("stopLossLimitPrice must be >= stopLossPrice for SELL");
    }
    if (!(takeProfitPrice < limitPrice)) {
      throw new ValidationError("takeProfitPrice must be < limitPrice for SELL");
    }
  }

  return {
    side,
    symbol,
    quantity,
    limitPrice,
    stopLossPrice,
    stopLossLimitPrice,
    takeProfitPrice,
    timeInForce: timeInForce || "DAY",
    externalCorrelationId,
    decisionEngineRunId,
  };
}

function validateUpdateOrderPayload(body = {}, context = {}) {
  const side = String(context?.side || "BUY").trim().toUpperCase();
  const defaultLimitPrice = toNumber(context?.referencePrice);
  const inputLimitPrice = toNumber(body.limitPrice);
  const limitPrice = Number.isFinite(inputLimitPrice) ? inputLimitPrice : defaultLimitPrice;
  const stopLossPrice = toNumber(body.stopLossPrice);
  const stopLossLimitPriceInput = toNumber(body.stopLossLimitPrice);
  const stopLossLimitPrice = Number.isFinite(stopLossLimitPriceInput)
    ? stopLossLimitPriceInput
    : stopLossPrice;
  const takeProfitPrice = toNumber(body.takeProfitPrice);
  const reason = body.reason ? String(body.reason).trim() : null;
  const decisionEngineRunId = body.decisionEngineRunId
    ? String(body.decisionEngineRunId).trim()
    : null;

  if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
    throw new ValidationError("limitPrice must be > 0");
  }
  if (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0) {
    throw new ValidationError("stopLossPrice must be > 0");
  }
  if (!Number.isFinite(stopLossLimitPrice) || stopLossLimitPrice <= 0) {
    throw new ValidationError("stopLossLimitPrice must be > 0");
  }
  if (!Number.isFinite(takeProfitPrice) || takeProfitPrice <= 0) {
    throw new ValidationError("takeProfitPrice must be > 0");
  }

  if (side !== "BUY" && side !== "SELL") {
    throw new ValidationError("side must be BUY or SELL");
  }

  if (side === "BUY") {
    if (!(stopLossPrice < limitPrice)) {
      throw new ValidationError("stopLossPrice must be < limitPrice for BUY", {
        limitPrice,
      });
    }
    if (!(takeProfitPrice > limitPrice)) {
      throw new ValidationError("takeProfitPrice must be > limitPrice for BUY", {
        limitPrice,
      });
    }
    if (!(stopLossLimitPrice <= stopLossPrice)) {
      throw new ValidationError("stopLossLimitPrice must be <= stopLossPrice for BUY", {
        stopLossPrice,
      });
    }
  } else {
    if (!(stopLossPrice > limitPrice)) {
      throw new ValidationError("stopLossPrice must be > limitPrice for SELL", {
        limitPrice,
      });
    }
    if (!(takeProfitPrice < limitPrice)) {
      throw new ValidationError("takeProfitPrice must be < limitPrice for SELL", {
        limitPrice,
      });
    }
    if (!(stopLossLimitPrice >= stopLossPrice)) {
      throw new ValidationError("stopLossLimitPrice must be >= stopLossPrice for SELL", {
        stopLossPrice,
      });
    }
  }

  return {
    side,
    limitPrice,
    stopLossPrice,
    stopLossLimitPrice,
    takeProfitPrice,
    reason,
    decisionEngineRunId,
  };
}

module.exports = {
  ValidationError,
  parseOrderId,
  validateCreateOrderPayload,
  validateUpdateOrderPayload,
};
