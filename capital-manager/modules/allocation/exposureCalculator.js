// modules/allocation/exposureCalculator.js
"use strict";

/**
 * Compute total notional reserved by open BUY orders.
 *
 * For each open order:
 *  - try to use: lmtPrice || auxPrice || price (limit price)
 *  - multiply by qty (totalQuantity || quantity || remainingQty)
 *  - only count BUY orders (action === "BUY")
 *
 * @param {Array} openOrders - From ibkr-bridge /orders/open
 * @param {number|null} [priceHint=null] - Optional price hint for orders missing a price
 * @returns {number} Total reserved notional in USD
 */
function computeOpenOrdersReserved(openOrders, priceHint = null) {
  if (!Array.isArray(openOrders) || openOrders.length === 0) return 0;

  let total = 0;
  for (const order of openOrders) {
    // Only count BUY side
    const action = String(order?.action ?? order?.side ?? "").toUpperCase();
    if (action !== "BUY") continue;

    // Price: prefer limit price
    const price =
      Number(order?.lmtPrice ?? order?.auxPrice ?? order?.price ?? order?.limitPrice ?? priceHint ?? 0);

    // Quantity
    const qty =
      Number(order?.totalQuantity ?? order?.quantity ?? order?.remainingQty ?? order?.qty ?? 0);

    if (price > 0 && qty > 0) {
      total += price * qty;
    }
  }

  return Math.floor(total * 100) / 100;
}

module.exports = { computeOpenOrdersReserved };
