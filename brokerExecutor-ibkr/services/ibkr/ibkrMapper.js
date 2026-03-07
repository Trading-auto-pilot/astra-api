"use strict";

function asNumber(...values) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asString(...values) {
  for (const v of values) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function mapOrderStatus(rawStatus) {
  const status = String(rawStatus || "").trim().toUpperCase();
  if (!status) return "UNKNOWN";
  if (["SUBMITTED", "PRESUBMITTED", "PENDING_SUBMIT", "WORKING", "OPEN"].includes(status)) {
    return "WORKING";
  }
  if (["FILLED"].includes(status)) return "FILLED";
  if (["CANCELLED", "API_CANCELLED", "INACTIVE", "CLOSED"].includes(status)) return "CANCELLED";
  if (["REJECTED"].includes(status)) return "REJECTED";
  return "UNKNOWN";
}

function extractBracket(raw = {}) {
  const bracket = {
    stopLossPrice: null,
    stopLossLimitPrice: null,
    takeProfitPrice: null,
  };

  const children = Array.isArray(raw.children) ? raw.children : [];
  for (const child of children) {
    const side = String(child.side || child.order_action || child.action || "").toUpperCase();
    if (side !== "SELL") continue;

    const type = String(child.orderType || child.order_type || child.type || "").toUpperCase();
    if (type === "LMT") {
      bracket.takeProfitPrice = asNumber(child.price, child.limitPrice, child.lmt_price);
    }
    if (type === "STP" || type === "STOP") {
      bracket.stopLossPrice = asNumber(child.auxPrice, child.stopPrice);
    }
    if (type === "STP LMT" || type === "STP_LMT" || type === "STOP_LIMIT" || type === "STOP LMT") {
      bracket.stopLossPrice = asNumber(child.auxPrice, child.stopPrice);
      bracket.stopLossLimitPrice = asNumber(child.price, child.limitPrice, child.lmt_price);
    }
  }

  if (!Number.isFinite(bracket.stopLossPrice)) {
    bracket.stopLossPrice = asNumber(raw.stopLossPrice, raw.stop_price, raw.auxPrice);
  }
  if (!Number.isFinite(bracket.stopLossLimitPrice)) {
    bracket.stopLossLimitPrice = asNumber(raw.stopLossLimitPrice, raw.stop_limit_price);
  }
  if (!Number.isFinite(bracket.takeProfitPrice)) {
    bracket.takeProfitPrice = asNumber(raw.takeProfitPrice, raw.take_profit, raw.tpPrice);
  }

  return bracket;
}

function normalizeOrder(raw = {}, extra = {}) {
  const orderId = asString(raw.orderId, raw.order_id, raw.id, extra.orderId);
  const parentOrderId = asString(raw.parent_order_id, raw.parentId, raw.parent_id, extra.parentOrderId);
  const symbol = asString(raw.symbol, raw.ticker, raw.localSymbol, extra.symbol);
  const side = String(raw.side || raw.order_action || raw.action || extra.side || "BUY")
    .trim()
    .toUpperCase();
  const rawOrderType = String(raw.orderType || raw.order_type || raw.type || extra.orderType || "LMT")
    .trim()
    .toUpperCase();

  const limitPrice = asNumber(raw.limitPrice, raw.price, raw.lmt_price, extra.limitPrice);
  const quantity = asNumber(raw.quantity, raw.size, raw.qty, raw.totalQuantity, raw.totalSize, raw.remainingQuantity, extra.quantity);
  const tif = asString(raw.tif, raw.timeInForce, extra.tif);
  const status = mapOrderStatus(raw.status || raw.order_status || extra.status);
  const createdAt = asString(raw.createdAt, raw.createTime, raw.create_time, extra.createdAt);
  const updatedAt = asString(raw.updatedAt, raw.lastUpdateTime, raw.lastExecutionTime, extra.updatedAt);

  const bracket = extractBracket(raw);
  const stopLossPrice = Number.isFinite(bracket.stopLossPrice)
    ? bracket.stopLossPrice
    : asNumber(extra.stopLossPrice);
  const stopLossLimitPrice = Number.isFinite(bracket.stopLossLimitPrice)
    ? bracket.stopLossLimitPrice
    : asNumber(extra.stopLossLimitPrice);
  const takeProfitPrice = Number.isFinite(bracket.takeProfitPrice)
    ? bracket.takeProfitPrice
    : asNumber(extra.takeProfitPrice);
  const normalizedType =
    rawOrderType === "STP LMT" ||
    rawOrderType === "STP_LMT" ||
    rawOrderType === "STOP_LIMIT" ||
    rawOrderType === "STOP LMT"
      ? "STOP_LIMIT"
      : rawOrderType === "STP" || rawOrderType === "STOP"
        ? "STOP"
      : rawOrderType === "LMT"
        ? "LIMIT"
        : rawOrderType || "LIMIT";
  let bracketRole = extra.bracketRole ? String(extra.bracketRole).toUpperCase() : "";
  if (!bracketRole) {
    if (parentOrderId) {
      if (
        rawOrderType === "STP" ||
        rawOrderType === "STOP" ||
        rawOrderType === "STP LMT" ||
        rawOrderType === "STP_LMT" ||
        rawOrderType === "STOP_LIMIT" ||
        rawOrderType === "STOP LMT"
      ) bracketRole = "SL";
      else if (rawOrderType === "LMT") bracketRole = "TP";
      else bracketRole = "CHILD";
    } else {
      bracketRole = "PARENT";
    }
  }

  return {
    orderId: orderId || "",
    broker: "IBKR",
    status,
    symbol: symbol || "",
    side: side === "SELL" ? "SELL" : "BUY",
    type: normalizedType,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    limitPrice: Number.isFinite(limitPrice) ? limitPrice : 0,
    ...(parentOrderId ? { parentOrderId } : {}),
    ...(bracketRole ? { bracketRole } : {}),
    ...(Number.isFinite(stopLossPrice) ? { stopLossPrice } : {}),
    ...(Number.isFinite(stopLossLimitPrice) ? { stopLossLimitPrice } : {}),
    ...(Number.isFinite(takeProfitPrice) ? { takeProfitPrice } : {}),
    ...(tif ? { tif } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(extra.externalCorrelationId ? { externalCorrelationId: extra.externalCorrelationId } : {}),
    ...(extra.decisionEngineRunId ? { decisionEngineRunId: extra.decisionEngineRunId } : {}),
    ...(extra.includeRaw ? { raw } : {}),
  };
}

function extractReferencePrice(rawOrder = {}) {
  return asNumber(
    rawOrder.limitPrice,
    rawOrder.price,
    rawOrder.avgPrice,
    rawOrder.avgFillPrice,
    rawOrder.lmt_price
  );
}

function normalizePosition(raw = {}, extra = {}) {
  const symbol = asString(
    raw.contractDesc,
    raw.description,
    raw.symbol,
    raw.ticker,
    extra.symbol
  );

  return {
    broker: "IBKR",
    accountId: asString(raw.acctId, raw.account, raw.accountId, extra.accountId) || "",
    conid: asString(raw.conid, raw.contractId, extra.conid) || "",
    symbol: symbol || "",
    quantity: asNumber(raw.position, raw.pos, raw.quantity, extra.quantity) || 0,
    avgPrice: asNumber(raw.avgPrice, raw.avg_cost, extra.avgPrice) || 0,
    marketPrice: asNumber(raw.mktPrice, raw.marketPrice, raw.last, extra.marketPrice) || 0,
    marketValue: asNumber(raw.mktValue, raw.marketValue, extra.marketValue) || 0,
    currency: asString(raw.currency, extra.currency) || "",
    ...(extra.includeRaw ? { raw } : {}),
  };
}

module.exports = {
  normalizeOrder,
  normalizePosition,
  extractReferencePrice,
};
