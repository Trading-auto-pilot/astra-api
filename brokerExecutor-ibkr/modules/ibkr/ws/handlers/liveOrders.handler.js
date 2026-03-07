"use strict";

function asNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asString(...values) {
  for (const value of values) {
    if (value == null) continue;
    const s = String(value).trim();
    if (s) return s;
  }
  return "";
}

function normalizeStatus(rawStatus, filledQty) {
  const status = String(rawStatus || "").trim().toUpperCase();
  const filled = Number(filledQty || 0);

  if (["FILLED"].includes(status)) return "FILLED";
  if (["CANCELLED", "API_CANCELLED", "INACTIVE", "CLOSED"].includes(status)) return "CANCELLED";
  if (["REJECTED"].includes(status)) return "REJECTED";
  if (filled > 0 && ["SUBMITTED", "PRESUBMITTED", "WORKING", "OPEN", "PARTIAL", "PARTIALLY_FILLED"].includes(status)) {
    return "PARTIALLY_FILLED";
  }
  if (["SUBMITTED", "PRESUBMITTED", "WORKING", "OPEN", "PENDING_SUBMIT"].includes(status)) {
    return "WORKING";
  }
  return "UNKNOWN";
}

function toArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.orders)) return payload.orders;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload && typeof payload === "object") return [payload];
  return [];
}

function extractLiveOrderEvents(payload, logger) {
  const items = toArray(payload);
  const updates = [];

  for (const item of items) {
    const orderId = asString(item?.orderId, item?.order_id, item?.id);
    if (!orderId) continue;

    const parentOrderId = asString(item?.parentId, item?.parent_order_id, item?.parent_id);
    const symbol = asString(item?.symbol, item?.ticker, item?.localSymbol, item?.contractDesc);
    const side = asString(item?.side, item?.order_action, item?.action).toUpperCase();
    const status = normalizeStatus(item?.status || item?.order_status, asNumber(item?.filledQuantity, item?.filledQty, item?.cumQty));
    const filledQty = asNumber(item?.filledQuantity, item?.filledQty, item?.cumQty, 0) || 0;
    const avgFillPrice = asNumber(item?.avgFillPrice, item?.avgPrice, item?.lastFillPrice);
    const limitPrice = asNumber(item?.price, item?.limitPrice, item?.lmt_price);
    const stopLossPrice = asNumber(item?.auxPrice, item?.stopPrice);
    const stopLossLimitPrice = asNumber(item?.price, item?.limitPrice, item?.lmt_price);
    const orderType = asString(item?.orderType, item?.order_type, item?.type).toUpperCase();
    const decisionEngineRunId = asString(item?.referrer, item?.decisionEngineRunId);
    const externalCorrelationId = asString(item?.order_ref, item?.orderRef, item?.externalCorrelationId, item?.cOID);
    const ts = new Date().toISOString();

    let bracketRole = "PARENT";
    if (parentOrderId) {
      if (orderType === "STP" || orderType === "STOP" || orderType === "STP LMT" || orderType === "STP_LMT" || orderType === "STOP_LIMIT" || orderType === "STOP LMT") bracketRole = "SL";
      else if (orderType === "LMT") bracketRole = "TP";
      else bracketRole = "CHILD";
    }

    updates.push({
      orderId,
      parentOrderId: parentOrderId || null,
      symbol: symbol || null,
      side: side || null,
      status,
      filledQty,
      avgFillPrice: Number.isFinite(avgFillPrice) ? avgFillPrice : null,
      limitPrice: Number.isFinite(limitPrice) ? limitPrice : null,
      stopLossPrice: Number.isFinite(stopLossPrice) ? stopLossPrice : null,
      stopLossLimitPrice: Number.isFinite(stopLossLimitPrice) ? stopLossLimitPrice : null,
      decisionEngineRunId: decisionEngineRunId || null,
      externalCorrelationId: externalCorrelationId || null,
      bracketRole,
      ts,
      raw: item,
    });
  }

  if (!updates.length) {
    logger.trace?.("[extractLiveOrderEvents] no order updates in payload");
  }
  return updates;
}

module.exports = {
  extractLiveOrderEvents,
};
