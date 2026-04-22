"use strict";

// ---------------------------------------------------------------------------
// lib/fullRunState.js — Singleton state for a full multi-day simulation run
// ---------------------------------------------------------------------------

const state = {
  active:       false,
  runId:        null,
  fromDate:     null,
  toDate:       null,
  pipeId:       null,
  userId:       null,
  days:         [],
  currentDay:   null,
  currentPhase: null,
  dayIndex:     0,
  totalDays:    0,
  progressPct:  0,
  tickCount:    0,
  log:          [],
  error:        null,
  startedAt:    null,
  finishedAt:   null,
  // Per-day summaries: [{ date, tickers, ordersTotal, ordersFilled, ordersCancelled, ordersPending }]
  daySummaries: [],
  // Aggregate totals (updated after each day)
  totals: {
    ordersTotal:     0,
    ordersFilled:    0,
    ordersCancelled: 0,
    ordersPending:   0,
    tickersFound:    0,
  },
};

const MAX_LOG = 200;

function _pct(idx, total) {
  return total > 0 ? Math.round((idx / total) * 1000) / 10 : 0;
}

function start({ runId, fromDate, toDate, pipeId, userId, days }) {
  state.active       = true;
  state.runId        = runId;
  state.fromDate     = fromDate;
  state.toDate       = toDate;
  state.pipeId       = pipeId;
  state.userId       = userId;
  state.days         = days;
  state.currentDay   = days[0] ?? null;
  state.currentPhase = "market-daily";
  state.dayIndex     = 0;
  state.totalDays    = days.length;
  state.progressPct  = 0;
  state.tickCount    = 0;
  state.log          = [];
  state.error        = null;
  state.startedAt    = new Date().toISOString();
  state.finishedAt   = null;
  state.daySummaries = [];
  state.totals       = { ordersTotal: 0, ordersFilled: 0, ordersCancelled: 0, ordersPending: 0, tickersFound: 0 };
}

function setDay(idx) {
  state.dayIndex    = idx;
  state.currentDay  = state.days[idx] ?? null;
  state.progressPct = _pct(idx, state.totalDays);
}

function setPhase(phase) {
  state.currentPhase = phase;
}

function addTick() {
  state.tickCount++;
}

function addLog(line) {
  state.log.push(line);
  if (state.log.length > MAX_LOG) state.log.shift();
}

/** Called at end of each day with the day's order/ticker summary. */
function addDaySummary({ date, tickers, ordersTotal, ordersFilled, ordersCancelled, ordersPending }) {
  state.daySummaries.push({ date, tickers, ordersTotal, ordersFilled, ordersCancelled, ordersPending });
  state.totals.ordersTotal     += ordersTotal;
  state.totals.ordersFilled    += ordersFilled;
  state.totals.ordersCancelled += ordersCancelled;
  state.totals.ordersPending   += ordersPending;
  state.totals.tickersFound    += tickers.length;
}

function finish() {
  state.active       = false;
  state.currentPhase = "done";
  state.progressPct  = 100;
  state.finishedAt   = new Date().toISOString();
}

function fail(err) {
  state.active       = false;
  state.currentPhase = "error";
  state.error        = err?.message ?? String(err);
  state.finishedAt   = new Date().toISOString();
}

function getSnapshot() {
  return { ...state, log: [...state.log], daySummaries: [...state.daySummaries], totals: { ...state.totals } };
}

module.exports = { start, setDay, setPhase, addTick, addLog, addDaySummary, finish, fail, getSnapshot };
