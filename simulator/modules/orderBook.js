"use strict";

// ---------------------------------------------------------------------------
// orderBook.js — In-memory order tracking for simulation runs
//
// Lifecycle: PENDING → FILLED | CANCELLED
//
// Each order stores the full bracket spec (entry + stop-loss + take-profit)
// so the tick loop can evaluate all legs against the current candle.
// ---------------------------------------------------------------------------

const orders = new Map(); // orderId → order object
let _counter = 1;

function _generateOrderId() {
  return `SIM_${Date.now()}_${_counter++}`;
}

/**
 * Create and register a new order.
 *
 * @param {object} params
 *   - symbol                  {string}
 *   - side                    {'BUY'|'SELL'}
 *   - quantity                {number}
 *   - orderType               {'MKT'|'LMT'}     default 'MKT'
 *   - limitPrice              {number?}          entry limit price
 *   - stopLossPrice           {number?}          stop-loss trigger
 *   - stopLossLimitPrice      {number?}
 *   - takeProfitPrice         {number?}
 *   - timeInForce             {string?}
 *   - externalCorrelationId   {string?}
 *   - decisionEngineRunId     {string?}
 * @returns {object} order
 */
function createOrder(params) {
  const orderId = _generateOrderId();
  const order = {
    orderId,
    symbol:                String(params.symbol || "").toUpperCase(),
    side:                  params.side || "BUY",
    quantity:              Number(params.quantity) || 0,
    orderType:             params.limitPrice ? "LMT" : "MKT",
    limitPrice:            params.limitPrice ?? null,
    stopLossPrice:         params.stopLossPrice ?? null,
    stopLossLimitPrice:    params.stopLossLimitPrice ?? null,
    takeProfitPrice:       params.takeProfitPrice ?? null,
    timeInForce:           params.timeInForce || "DAY",
    externalCorrelationId: params.externalCorrelationId || null,
    decisionEngineRunId:   params.decisionEngineRunId || null,
    status:                "PENDING",
    createdAt:             new Date().toISOString(),
    fillPrice:             null,
    filledAt:              null,
    cancelledAt:           null,
  };
  orders.set(orderId, order);
  return order;
}

function getOrder(orderId) {
  return orders.get(String(orderId)) || null;
}

/** All orders with status PENDING. */
function getPendingOrders() {
  return Array.from(orders.values()).filter((o) => o.status === "PENDING");
}

/** All orders (any status). */
function getAllOrders() {
  return Array.from(orders.values());
}

/**
 * Mark an order as FILLED.
 * @param {string} orderId
 * @param {number} fillPrice
 * @returns {object|null}
 */
function fillOrder(orderId, fillPrice) {
  const order = orders.get(String(orderId));
  if (!order || order.status !== "PENDING") return null;
  order.status    = "FILLED";
  order.fillPrice = fillPrice;
  order.filledAt  = new Date().toISOString();
  return order;
}

/**
 * Cancel a pending order.
 * @param {string} orderId
 * @returns {boolean}
 */
function cancelOrder(orderId) {
  const order = orders.get(String(orderId));
  if (!order || order.status !== "PENDING") return false;
  order.status      = "CANCELLED";
  order.cancelledAt = new Date().toISOString();
  return true;
}

/** Reset the book (call on sim stop/start). */
function clear() {
  orders.clear();
  _counter = 1;
}

module.exports = {
  createOrder,
  getOrder,
  getPendingOrders,
  getAllOrders,
  fillOrder,
  cancelOrder,
  clear,
};
