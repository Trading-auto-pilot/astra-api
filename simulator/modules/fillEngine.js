"use strict";

// ---------------------------------------------------------------------------
// fillEngine.js — Order fill simulation
//
// fillOrder(order, candle, config) → fill result
//
// Supports:
//   - MKT orders: fill at close ± slippage
//   - LMT orders: fill only if candle range crosses limit price
//   - MIN/MAX price guards (reject fills outside acceptable range)
//   - Commission per share
// ---------------------------------------------------------------------------

function round(v, decimals = 4) {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/**
 * Attempt to fill an order against the current candle.
 *
 * @param {object} order
 *   - symbol      {string}           ticker symbol
 *   - qty         {number}           shares (always positive)
 *   - side        {'BUY'|'SELL'}
 *   - orderType   {'MKT'|'LMT'}
 *   - limitPrice  {number?}          required for LMT orders
 *
 * @param {object} candle  { o, h, l, c, v }  normalized OHLCV
 *
 * @param {object} config
 *   - slippagePct        {number}  e.g. 0.001 → 0.1% of close price
 *   - commissionPerShare {number}  e.g. 0.005 per share
 *   - minPrice           {number?} reject fill if fillPrice < minPrice
 *   - maxPrice           {number?} reject fill if fillPrice > maxPrice
 *
 * @returns {{
 *   filled:       boolean,
 *   fillPrice?:   number,
 *   commission?:  number,
 *   slippageAmt?: number,
 *   qty?:         number,
 *   symbol?:      string,
 *   side?:        string,
 *   reason?:      string,   // only present when filled=false
 * }}
 */
function fillOrder(order, candle, config = {}) {
  const { symbol, qty, side, orderType, limitPrice } = order;
  const {
    slippagePct = 0.001,
    commissionPerShare = 0.005,
    minPrice,
    maxPrice,
  } = config;

  // Guard: candle must have a valid close
  if (!candle || !Number.isFinite(Number(candle.c)) || Number(candle.c) <= 0) {
    return { filled: false, reason: "no_candle_data" };
  }

  const close = Number(candle.c);
  const high  = Number.isFinite(Number(candle.h)) ? Number(candle.h) : close;
  const low   = Number.isFinite(Number(candle.l)) ? Number(candle.l) : close;

  if (!Number.isFinite(qty) || qty <= 0) {
    return { filled: false, reason: "invalid_qty" };
  }
  if (side !== "BUY" && side !== "SELL") {
    return { filled: false, reason: "invalid_side" };
  }

  let fillPrice;
  let slippageAmt = 0;

  if (orderType === "LMT") {
    if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
      return { filled: false, reason: "invalid_limit_price" };
    }

    if (side === "BUY") {
      // Fill if the candle's low touched or crossed the limit price
      if (low > limitPrice) {
        return { filled: false, reason: "limit_not_reached" };
      }
      // Fill at the limit price (or candle open if gap-down open was better)
      fillPrice = Math.min(limitPrice, high);
    } else {
      // SELL: fill if the candle's high touched or crossed the limit price
      if (high < limitPrice) {
        return { filled: false, reason: "limit_not_reached" };
      }
      fillPrice = Math.max(limitPrice, low);
    }
  } else {
    // MKT: fill at close with slippage
    const slip = close * slippagePct;
    slippageAmt = round(qty * slip, 4);
    fillPrice = side === "BUY" ? close + slip : close - slip;
  }

  fillPrice = round(fillPrice, 4);

  // MIN/MAX price guards
  if (Number.isFinite(minPrice) && fillPrice < minPrice) {
    return { filled: false, reason: `fill_below_min: ${fillPrice} < ${minPrice}` };
  }
  if (Number.isFinite(maxPrice) && fillPrice > maxPrice) {
    return { filled: false, reason: `fill_above_max: ${fillPrice} > ${maxPrice}` };
  }

  const commission = round(qty * commissionPerShare, 4);

  return {
    filled: true,
    symbol: String(symbol).toUpperCase(),
    side,
    qty,
    fillPrice,
    commission,
    slippageAmt,
  };
}

module.exports = { fillOrder };
