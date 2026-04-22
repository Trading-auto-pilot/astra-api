"use strict";

// ---------------------------------------------------------------------------
// sessionState — singleton for the active simulation session
// ---------------------------------------------------------------------------

const simClock = require("../../shared/simClock");

// ms per timeframe unit
const TF_MS = {
  "1min":   60 * 1000,
  "5min":   5 * 60 * 1000,
  "15min":  15 * 60 * 1000,
  "30min":  30 * 60 * 1000,
  "1Hour":  60 * 60 * 1000,
  "4Hour":  4 * 60 * 60 * 1000,
  "1Day":   24 * 60 * 60 * 1000,
  "1Week":  7 * 24 * 60 * 60 * 1000,
  "1Month": 30 * 24 * 60 * 60 * 1000,
};

function normalizeTf(tf) {
  const raw = String(tf || "1Day").trim().toLowerCase();
  if (raw === "1min" || raw === "1m") return "1min";
  if (raw === "5min" || raw === "5m") return "5min";
  if (raw === "15min" || raw === "15m") return "15min";
  if (raw === "30min" || raw === "30m") return "30min";
  if (raw === "1hour" || raw === "1h" || raw === "60min") return "1Hour";
  if (raw === "4hour" || raw === "4h" || raw === "240min") return "4Hour";
  if (raw === "1day" || raw === "1d") return "1Day";
  if (raw === "1week" || raw === "1w") return "1Week";
  if (raw === "1month" || raw === "1mo") return "1Month";
  return "1Day";
}

const state = {
  active: false,
  startDate: null,         // ISO string
  endDate: null,           // ISO string
  currentDate: null,       // ISO string — advances each tick
  tf: "1Day",
  tickers: new Set(),
  dataSource: "cachemanager",   // "cachemanager" | "file" | "redis"
  dataSourceConfig: {},         // source-specific config (e.g. { path: "..." })
  tickCount: 0,
  lastTickAt: null,
  // Mode: "sync"    — POST /sim/tick driven, no timers, no Redis push (fastest)
  //       "passive" — serve on GET requests (decision-engine pulls)
  //       "inject"  — push directly onto Redis bus at intervalMs speed
  mode: "sync",
  intervalMs: 1000,
  getRequestsCount: 0,
  lastGetAt: null,
  lastGetType: null,
  lastGetSymbol: null,
  lastGetDate: null,
  // Per-symbol overrides for the next GET /candle (Mode 1 compatible)
  pendingCandles: {},      // { [SYMBOL]: candle }
  // Passive mode: track which subscribed tickers have been served at currentDate
  servedAtCurrentDate: new Set(),
};

function configure({ startDate, endDate, tf, dataSource, dataSourceConfig, mode, intervalMs }) {
  state.startDate = startDate;
  state.endDate = endDate;
  state.currentDate = startDate;
  state.tf = normalizeTf(tf);
  state.dataSource = dataSource || "cachemanager";
  state.dataSourceConfig = dataSourceConfig || {};
  state.active = true;
  state.tickCount = 0;
  state.lastTickAt = null;
  if (mode === "inject") state.mode = "inject";
  else if (mode === "passive") state.mode = "passive";
  else state.mode = "sync";
  state.intervalMs = (intervalMs && intervalMs > 0) ? Number(intervalMs) : 1000;
  state.getRequestsCount = 0;
  state.lastGetAt = null;
  state.lastGetType = null;
  state.lastGetSymbol = null;
  state.lastGetDate = null;
  state.pendingCandles = {};
  state.servedAtCurrentDate = new Set();
}

// Advance currentDate. Returns true if there are more steps.
// In sync mode, pass nextDate = candle.t + TF_MS to advance per actual candle
// (avoids re-serving the same candle when currentDate falls between candle timestamps).
// Falls back to fixed TF step when nextDate is null.
function advance(nextDate = null) {
  if (!state.active || !state.currentDate) return false;
  const tfMs = TF_MS[normalizeTf(state.tf)] || TF_MS["1Day"];
  const current = new Date(state.currentDate).getTime();
  const end = new Date(state.endDate).getTime();
  if (current >= end) return false;

  let next;
  if (nextDate != null) {
    next = Math.min(new Date(nextDate).getTime(), end);
  } else {
    next = Math.min(current + tfMs, end);
  }

  state.currentDate = new Date(next).toISOString();
  state.tickCount++;
  state.lastTickAt = new Date().toISOString();
  // Inject virtual time into simClock so decision-engine business logic
  // uses the candle timestamp instead of wall-clock time.
  try { simClock.inject(next); } catch (_) { /* non-fatal */ }
  state.servedAtCurrentDate = new Set(); // reset served set for next step
  return new Date(state.currentDate).getTime() < end;
}

function stop() {
  state.active = false;
  state.tickers.clear();
  state.tickCount = 0;
  simClock.reset(); // restore wall-clock time
  state.lastTickAt = null;
  state.getRequestsCount = 0;
  state.lastGetAt = null;
  state.lastGetType = null;
  state.lastGetSymbol = null;
  state.lastGetDate = null;
  state.pendingCandles = {};
  state.servedAtCurrentDate = new Set();
}

// Passive mode helpers — track which subscribed tickers have been served at currentDate
function markServedPassive(symbol) {
  state.servedAtCurrentDate.add(String(symbol).toUpperCase());
}

// Returns true if all subscribed tickers have been served for currentDate
function shouldAdvancePassive() {
  if (!state.tickers.size) return false;
  for (const t of state.tickers) {
    if (!state.servedAtCurrentDate.has(t)) return false;
  }
  return true;
}

function registerGetRequest({ type = "candle", symbol = null, date = null } = {}) {
  state.getRequestsCount = Number(state.getRequestsCount || 0) + 1;
  state.lastGetAt = new Date().toISOString();
  state.lastGetType = String(type || "candle");
  state.lastGetSymbol = symbol ? String(symbol).toUpperCase() : null;
  state.lastGetDate = date ? String(date) : null;
}

function setPendingCandle(symbol, candle) {
  state.pendingCandles[String(symbol).toUpperCase()] = candle;
}

function getPendingCandle(symbol) {
  return state.pendingCandles[String(symbol).toUpperCase()] || null;
}

function clearPendingCandle(symbol) {
  delete state.pendingCandles[String(symbol).toUpperCase()];
}

function addTickers(tickers) {
  for (const t of tickers) {
    if (t) state.tickers.add(String(t).toUpperCase());
  }
}

function removeTicker(symbol) {
  state.tickers.delete(String(symbol).toUpperCase());
}

function clearTickers() {
  state.tickers.clear();
}

function getSnapshot() {
  return {
    active: state.active,
    startDate: state.startDate,
    endDate: state.endDate,
    currentDate: state.currentDate,
    tf: state.tf,
    dataSource: state.dataSource,
    dataSourceConfig: state.dataSourceConfig,
    tickers: Array.from(state.tickers),
    tickCount: state.tickCount,
    lastTickAt: state.lastTickAt,
    mode: state.mode,
    intervalMs: state.intervalMs,
    getRequestsCount: state.getRequestsCount,
    lastGetAt: state.lastGetAt,
    lastGetType: state.lastGetType,
    lastGetSymbol: state.lastGetSymbol,
    lastGetDate: state.lastGetDate,
    hasMore: state.currentDate && state.endDate
      ? new Date(state.currentDate).getTime() < new Date(state.endDate).getTime()
      : false,
  };
}

module.exports = {
  state, TF_MS,
  normalizeTf,
  configure, advance, stop,
  addTickers, removeTicker, clearTickers,
  getSnapshot,
  registerGetRequest,
  setPendingCandle, getPendingCandle, clearPendingCandle,
  markServedPassive, shouldAdvancePassive,
};
