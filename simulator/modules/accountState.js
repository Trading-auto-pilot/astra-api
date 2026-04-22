"use strict";

// ---------------------------------------------------------------------------
// accountState.js — In-memory portfolio state for simulation runs
//
// Tracks:
//   - Cash balance
//   - Open positions (symbol → { qty, avgCost, totalCost })
//   - Realized P&L (from closed trades)
//   - Unrealized P&L (mark-to-market from last prices)
//   - NAV = cash + sum(position market value)
//   - Max NAV (for drawdown calculation)
//   - Trade count
//
// Usage:
//   const accountState = require('./accountState');
//   accountState.init(100000);
//   accountState.applyFill('AAPL', 10, 'BUY', 150.50, 0.05);
//   accountState.markToMarket({ AAPL: 155.00 });
//   accountState.getSnapshot();
// ---------------------------------------------------------------------------

function round(v, decimals = 4) {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

const state = {
  initialCash:   0,
  cash:          0,
  positions:     {},   // symbol → { qty, avgCost, totalCost }
  realizedPnl:   0,
  unrealizedPnl: 0,
  lastPrices:    {},   // symbol → latest market price (from markToMarket)
  maxNAV:        0,    // high-water mark for drawdown
  tradeCount:    0,
};

/**
 * Initialize (or reset) account state with starting cash.
 * @param {number} initialCash
 */
function init(initialCash) {
  state.initialCash   = Number(initialCash) || 0;
  state.cash          = state.initialCash;
  state.positions     = {};
  state.realizedPnl   = 0;
  state.unrealizedPnl = 0;
  state.lastPrices    = {};
  state.maxNAV        = state.initialCash;
  state.tradeCount    = 0;
}

/**
 * Apply a confirmed fill to the account.
 * Long-only model: BUY opens/adds to position, SELL closes/reduces.
 *
 * @param {string} symbol
 * @param {number} qty         shares (positive)
 * @param {'BUY'|'SELL'} side
 * @param {number} fillPrice
 * @param {number} commission  total commission for this fill
 */
function applyFill(symbol, qty, side, fillPrice, commission) {
  const sym = String(symbol).toUpperCase();
  const pos = state.positions[sym] || { qty: 0, avgCost: 0, totalCost: 0 };

  if (side === "BUY") {
    const cost = qty * fillPrice;
    const newQty       = pos.qty + qty;
    const newTotalCost = pos.totalCost + cost;
    state.positions[sym] = {
      qty:       newQty,
      avgCost:   round(newTotalCost / newQty, 4),
      totalCost: round(newTotalCost, 4),
    };
    // Cash decreases by cost + commission
    state.cash = round(state.cash - cost - commission, 4);
  } else {
    // SELL
    const proceeds = qty * fillPrice;
    const realizedThisTrade = round(qty * (fillPrice - pos.avgCost) - commission, 4);
    const newQty = pos.qty - qty;

    if (newQty <= 0) {
      delete state.positions[sym];
      delete state.lastPrices[sym];
    } else {
      state.positions[sym] = {
        qty:       newQty,
        avgCost:   pos.avgCost,
        totalCost: round(newQty * pos.avgCost, 4),
      };
    }

    state.cash        = round(state.cash + proceeds - commission, 4);
    state.realizedPnl = round(state.realizedPnl + realizedThisTrade, 4);
  }

  state.tradeCount++;
}

/**
 * Mark all open positions to market using latest prices.
 * Updates unrealizedPnl and advances the high-water mark.
 *
 * @param {Object} prices  { [symbol]: price }
 */
function markToMarket(prices = {}) {
  for (const [sym, price] of Object.entries(prices)) {
    if (Number.isFinite(price) && price > 0) {
      state.lastPrices[sym.toUpperCase()] = price;
    }
  }

  let unrealized = 0;
  for (const [sym, pos] of Object.entries(state.positions)) {
    const price = state.lastPrices[sym];
    if (Number.isFinite(price)) {
      unrealized += pos.qty * (price - pos.avgCost);
    }
  }
  state.unrealizedPnl = round(unrealized, 4);

  // Advance high-water mark
  const nav = _computeNAV();
  if (nav > state.maxNAV) state.maxNAV = nav;
}

function _computeNAV() {
  let posValue = 0;
  for (const [sym, pos] of Object.entries(state.positions)) {
    const price = state.lastPrices[sym];
    // Fall back to totalCost (cost basis) if no market price yet
    posValue += Number.isFinite(price) ? pos.qty * price : pos.totalCost;
  }
  return round(state.cash + posValue, 4);
}

/** Current NAV (cash + market value of positions). */
function getNAV() {
  return _computeNAV();
}

/** Current drawdown % from high-water mark. */
function getDrawdownPct() {
  if (state.maxNAV <= 0) return 0;
  const nav = _computeNAV();
  return round(((state.maxNAV - nav) / state.maxNAV) * 100, 2);
}

/**
 * Return position for a single symbol, or null if not held.
 * @param {string} symbol
 */
function getPosition(symbol) {
  return state.positions[String(symbol).toUpperCase()] || null;
}

/**
 * Full account snapshot for API responses and DB persistence.
 */
function getSnapshot() {
  const nav = _computeNAV();
  return {
    initialCash:   state.initialCash,
    cash:          state.cash,
    nav,
    realizedPnl:   state.realizedPnl,
    unrealizedPnl: state.unrealizedPnl,
    totalPnl:      round(state.realizedPnl + state.unrealizedPnl, 4),
    maxNAV:        state.maxNAV,
    drawdownPct:   getDrawdownPct(),
    tradeCount:    state.tradeCount,
    positionCount: Object.keys(state.positions).length,
    positions:     { ...state.positions },
  };
}

module.exports = {
  init,
  applyFill,
  markToMarket,
  getNAV,
  getDrawdownPct,
  getPosition,
  getSnapshot,
};
