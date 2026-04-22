"use strict";

// ---------------------------------------------------------------------------
// simController.js — Orchestrates the sim lifecycle (start / tick / stop)
//
// Designed for SYNC MODE (priority):
//   POST /sim/start  → preload all candles, init account, configure session
//   POST /sim/tick   → process one time step: fill orders, mark-to-market, advance clock
//   POST /sim/stop   → finalize run, return KPIs
//   GET  /sim/status → live progress snapshot
//
// Dependencies:
//   candleFetcher  — provided by MarketSimulator._fetcher (injected at start)
//   sessionState   — singleton session (with SimClock injection on advance)
//   accountState   — singleton portfolio state
//   orderBook      — singleton pending orders
//   fillEngine     — stateless fill logic
// ---------------------------------------------------------------------------

const sessionState  = require("../lib/sessionState");
const accountState  = require("./accountState");
const orderBook     = require("./orderBook");
const { fillOrder: computeFill } = require("./fillEngine");
const { publishSnapshot } = require("../lib/snapshotPublisher");
const candleLibrary = require("../lib/candleLibrary");

// Last completed run (in-memory, single run at a time)
let _lastRun  = null;
let _runId    = null;
let _fetcher  = null; // set by start()
let _bus      = null; // Redis bus — for publishing candles to DE
let _channel  = null; // market-data Redis channel

function _generateRunId() {
  return `SIM_RUN_${Date.now()}`;
}

/**
 * Start a simulation run.
 *
 * @param {object} params
 *   - fromDate        {string}  YYYY-MM-DD
 *   - toDate          {string}  YYYY-MM-DD
 *   - tickers         {string[]}
 *   - tf              {string}  timeframe (default '1Day')
 *   - initialCapital  {number}  (default 100 000)
 *   - slippagePct     {number}  (default 0.001)
 *   - commissionPerShare {number} (default 0.005)
 *   - dataSource      {string}  (default 'cachemanager')
 * @param {object} fetcher  candleFetcher instance from MarketSimulator
 * @param {object} logger
 * @returns {object}  { ok, runId, session, account, preloaded }
 */
async function start(params, fetcher, logger, svc) {
  const {
    fromDate,
    toDate,
    tickers = [],
    tf = "1Day",
    initialCapital = 100000,
    slippagePct = 0.001,
    commissionPerShare = 0.005,
    dataSource = "cachemanager",
    dataSourceConfig = {},
  } = params;

  if (!fromDate || !toDate || fromDate > toDate) {
    throw new Error(`Invalid date range: from=${fromDate} to=${toDate}`);
  }

  // If no tickers passed explicitly, use whatever the decision-engine already subscribed.
  const resolvedTickers = tickers.length > 0
    ? tickers
    : Array.from(sessionState.state.tickers);

  if (!resolvedTickers.length) {
    throw new Error("No tickers: pass tickers[] or wait for decision-engine to subscribe first");
  }

  _fetcher = fetcher;
  _bus     = svc?.bus     ?? null;
  _channel = svc?.marketDataChannel ?? null;

  // Preload candle series BEFORE resetting state.
  // If cachemanager is unreachable the error is thrown here and sessionState is untouched
  // (DE subscriptions are preserved so the user does not need to re-subscribe).
  const preloaded = {};
  await Promise.all(
    resolvedTickers.map(async (sym) => {
      // Library mode: load candles directly from a stored file (per-ticker fileId)
      const fileId = dataSource === "library"
        ? (dataSourceConfig?.[sym]?.fileId ?? dataSourceConfig?.[sym] ?? null)
        : null;

      let count = 0;
      if (fileId != null) {
        try {
          const candles = candleLibrary.readCandles(Number(fileId));
          count = fetcher.preloadFromCandles(sym, tf, candles);
          preloaded[sym] = count;
          logger?.info?.(`[simController] library preload ${sym} fileId=${fileId} count=${count}`);
        } catch (libErr) {
          logger?.warning?.(`[simController] library preload failed ${sym}: ${libErr?.message}`);
          preloaded[sym] = 0;
        }
      } else {
        count = await fetcher.preload(sym, fromDate, toDate, tf);
        preloaded[sym] = count;
        if (count === 0) {
          logger?.warning?.(`[simController] preload WARNING: ${sym} returned 0 candles for range ${fromDate}→${toDate} tf=${tf} — ticks will have no data for this ticker`);
        } else {
          logger?.info?.(`[simController] preloaded ${sym} count=${count}`);
        }
      }
      // Unified: always position the index at the first candle >= fromDate.
      // Works for both cachemanager (user-chosen date) and library mode
      // (frontend sends file's date_from), keeping a single code path.
      if (count > 0) fetcher.resetIndexToDate(sym, tf, fromDate);
    })
  );

  // In library mode, derive session dates from actual candle timestamps so the
  // session clock covers the full candle range regardless of what the caller passed.
  let sessionFromDate = fromDate;
  let sessionToDate   = toDate;
  if (dataSource === "library") {
    const tfMs = sessionState.TF_MS[sessionState.normalizeTf(tf)] || sessionState.TF_MS["1Day"];
    // Collect the first/last candle timestamps across all loaded tickers
    let minTs = Infinity;
    let maxTs = -Infinity;
    for (const sym of resolvedTickers) {
      const fileId = dataSourceConfig?.[sym]?.fileId ?? dataSourceConfig?.[sym] ?? null;
      if (fileId == null) continue;
      try {
        const rec = candleLibrary.getFile(Number(fileId));
        if (rec?.date_from) { const t = new Date(rec.date_from).getTime(); if (t < minTs) minTs = t; }
        if (rec?.date_to)   { const t = new Date(rec.date_to).getTime();   if (t > maxTs) maxTs = t; }
      } catch (_) { /* non-fatal */ }
    }
    if (Number.isFinite(minTs)) sessionFromDate = new Date(minTs).toISOString();
    // Extend end by one TF so the clock doesn't stop on the last candle
    if (Number.isFinite(maxTs)) sessionToDate = new Date(maxTs + tfMs).toISOString();
    logger?.info?.(`[simController] library mode — session range overridden from=${sessionFromDate} to=${sessionToDate}`);
  }

  const totalCandles = Object.values(preloaded).reduce((s, n) => s + n, 0);
  if (totalCandles === 0) {
    logger?.warning?.(
      `[simController] preload returned 0 candles for all tickers [${resolvedTickers.join(", ")}] ` +
      `in range ${fromDate}→${toDate} tf=${tf}. ` +
      `Tick will fall back to live cachemanager fetch (getCached miss → getCandle).`
    );
  }

  // In library mode, pre-populate the Redis sim signal cache so the decision-engine
  // uses these fabricated candles for flag recalc instead of real cachemanager data.
  if (dataSource === "library" && _bus && typeof _bus.set === "function") {
    for (const sym of resolvedTickers) {
      const fileId = dataSourceConfig?.[sym]?.fileId ?? dataSourceConfig?.[sym] ?? null;
      if (fileId == null) continue;
      try {
        const libCandles = candleLibrary.readCandles(Number(fileId));
        // Normalize to decision-engine format: {t, high, low, close, volume}
        const normalized = libCandles
          .map((c) => ({
            t: new Date(c.t).getTime(),
            high:   Number(c.h ?? c.high),
            low:    Number(c.l ?? c.low),
            close:  Number(c.c ?? c.close),
            volume: Number(c.v ?? c.volume),
          }))
          .filter((c) => isFinite(c.high) && isFinite(c.low) && isFinite(c.close));
        const simSignalKey = _bus.key("sim", "signal-candles", sym.toUpperCase());
        await _bus.set(simSignalKey, { tf, candles: normalized }, { EX: 7200 });
        logger?.info?.(`[simController] sim signal cache populated ${sym} key=${simSignalKey} count=${normalized.length}`);
      } catch (e) {
        logger?.warning?.(`[simController] sim signal cache failed ${sym}: ${e?.message}`);
      }
    }
  }

  // Preload succeeded — safe to reset state now
  sessionState.stop();
  accountState.init(initialCapital);
  orderBook.clear();
  _lastRun = null;

  // Configure session (mode=sync)
  sessionState.configure({
    startDate: sessionFromDate,
    endDate:   sessionToDate,
    tf,
    dataSource,
    dataSourceConfig,
    mode: "sync",
  });
  sessionState.addTickers(resolvedTickers);

  _runId = _generateRunId();

  // Store fill config for use in tick loop
  _fetcher._simFillConfig = { slippagePct, commissionPerShare };

  logger?.info?.(`[simController] started runId=${_runId} from=${sessionFromDate} to=${sessionToDate} tickers=${resolvedTickers.join(',')}`);

  return {
    ok: true,
    runId: _runId,
    tickers: resolvedTickers,
    session: sessionState.getSnapshot(),
    account: accountState.getSnapshot(),
    preloaded,
  };
}

/**
 * Advance one time step in sync mode.
 *
 * Sequence (mirrors live trading):
 *   1. Fetch candles for currentDate from preloaded cache
 *   2. Fill any pending orders placed by DE from the previous tick's candle
 *   3. Mark account to market (unrealized P&L)
 *   4. Publish candles to Redis → DE receives them, runs its logic, places new orders
 *   5. Advance SimClock to next date
 *
 * Orders placed by DE in step 4 will be filled in step 2 of the NEXT tick.
 *
 * @param {object} logger
 * @returns {Promise<object>} tick result
 */
async function tick(logger, candleOverrides = {}) {
  const snap = sessionState.getSnapshot();
  if (!snap.active) {
    throw new Error("No active simulation session. Call POST /sim/start first.");
  }

  const currentDate = snap.currentDate;
  const tf = snap.tf;
  const tickers = snap.tickers;
  const fillConfig = _fetcher?._simFillConfig || {};

  const candles = {};
  const fills = [];

  // 1. Fetch candles — candleOverrides take priority (user-edited via frontend),
  //    then preloaded cache, then live cachemanager fetch as last resort.
  const { dataSource, dataSourceConfig } = snap;
  for (const sym of tickers) {
    // User override from frontend (editable textarea)
    if (candleOverrides[sym]) {
      // Consume the index even when override is applied, to keep position in sync
      _fetcher?.getCachedNext?.(sym, tf);
      candles[sym] = candleOverrides[sym];
      logger?.info?.(`[simController] candle override applied for ${sym}`);
      continue;
    }
    let candle = _fetcher?.getCachedNext?.(sym, tf);
    if (!candle && _fetcher) {
      try {
        candle = await _fetcher.getCandle(sym, currentDate, tf, dataSource, dataSourceConfig, _bus);
        if (candle) logger?.info?.(`[simController] cache miss ${sym} — fetched live from cachemanager date=${currentDate}`);
      } catch (e) {
        logger?.warning?.(`[simController] getCandle fallback failed for ${sym}: ${e?.message}`);
      }
    }
    if (candle) candles[sym] = candle;
  }

  // 2. Fill pending orders (placed by DE from previous tick)
  for (const order of orderBook.getPendingOrders()) {
    const candle = candles[order.symbol];
    if (!candle) continue;

    const result = computeFill(
      { symbol: order.symbol, qty: order.quantity, side: order.side, orderType: order.orderType, limitPrice: order.limitPrice },
      candle,
      fillConfig
    );

    if (result.filled) {
      orderBook.fillOrder(order.orderId, result.fillPrice);
      accountState.applyFill(order.symbol, result.qty, result.side, result.fillPrice, result.commission);
      fills.push({ orderId: order.orderId, ...result });
      logger?.info?.(`[simController] fill orderId=${order.orderId} symbol=${order.symbol} side=${order.side} qty=${result.qty} fillPrice=${result.fillPrice}`);
    }
  }

  // 3. Mark to market with close prices
  const prices = {};
  for (const [sym, candle] of Object.entries(candles)) {
    if (Number.isFinite(candle.c)) prices[sym] = candle.c;
  }
  accountState.markToMarket(prices);

  // 4. Advance clock — use the actual candle timestamp so progress tracking is accurate.
  const tfMs = sessionState.TF_MS[sessionState.normalizeTf(tf)] || sessionState.TF_MS["1Day"];
  const candleTs = Object.values(candles)
    .map((c) => { const t = new Date(c.t).getTime(); return Number.isFinite(t) ? t : null; })
    .filter((t) => t !== null);
  const nextDate = candleTs.length > 0
    ? new Date(Math.max(...candleTs) + tfMs).toISOString()
    : null; // fallback: fixed TF advance (no candles served this tick)
  const clockHasMore = sessionState.advance(nextDate);

  // Also check if the index has candles remaining for any ticker
  const indexHasMore = tickers.some((sym) => _fetcher?.peekCachedNext?.(sym, tf) != null);
  const hasMore = clockHasMore && (indexHasMore || Object.keys(candles).length === 0);

  return {
    ok: true,
    date: currentDate,
    hasMore,
    tickCount: sessionState.state.tickCount,
    fills,
    candles,                          // returned so route can publish to Redis
    candleCount: Object.keys(candles).length,
    account: accountState.getSnapshot(),
  };
}

/**
 * Stop the simulation and finalize results.
 * @param {object} logger
 * @returns {object} final KPIs
 */
function stop(logger) {
  const snap = sessionState.getSnapshot();
  const accountSnap = accountState.getSnapshot();

  sessionState.stop();
  _fetcher?.clearCache?.();

  const result = {
    ok:        true,
    runId:     _runId,
    fromDate:  snap.startDate,
    toDate:    snap.endDate,
    tf:        snap.tf,
    tickers:   snap.tickers,
    tickCount: snap.tickCount,
    account:   accountSnap,
    orders: {
      total:     orderBook.getAllOrders().length,
      filled:    orderBook.getAllOrders().filter((o) => o.status === "FILLED").length,
      cancelled: orderBook.getAllOrders().filter((o) => o.status === "CANCELLED").length,
      pending:   orderBook.getPendingOrders().length,
    },
    completedAt: new Date().toISOString(),
  };

  _lastRun = result;
  logger?.info?.(`[simController] stopped runId=${_runId} tickCount=${snap.tickCount} nav=${accountSnap.nav}`);

  return result;
}

/**
 * Current status snapshot (for GET /sim/status).
 */
function getStatus() {
  const snap = sessionState.getSnapshot();
  const account = accountState.getSnapshot();

  let progressPct = 0;
  if (snap.startDate && snap.endDate && snap.currentDate) {
    const total = new Date(snap.endDate).getTime() - new Date(snap.startDate).getTime();
    const done  = new Date(snap.currentDate).getTime() - new Date(snap.startDate).getTime();
    progressPct = total > 0 ? Math.round((done / total) * 100 * 10) / 10 : 0;
  }

  return {
    ok: true,
    runId: _runId,
    active: snap.active,
    progressPct,
    session: snap,
    account,
    pendingOrders: orderBook.getPendingOrders().length,
  };
}

/**
 * Retrieve the last completed run result (for GET /sim/results/:runId).
 * @param {string} runId
 */
function getResults(runId) {
  if (!_lastRun) return null;
  if (runId && _lastRun.runId !== runId) return null;
  return _lastRun;
}

/**
 * Preview the candles that would be sent on the next tick (read-only, no advance).
 * Returns the same candle map tick() would use, so the frontend can show/edit them.
 */
async function preview(logger) {
  const snap = sessionState.getSnapshot();
  if (!snap.active) return { ok: false, error: "No active session" };

  const { currentDate, tf, tickers } = snap;
  const { dataSource, dataSourceConfig } = snap;
  const candles = {};

  for (const sym of tickers) {
    let candle = _fetcher?.peekCachedNext?.(sym, tf);
    if (!candle && _fetcher) {
      try {
        candle = await _fetcher.getCandle(sym, currentDate, tf, dataSource, dataSourceConfig, _bus);
      } catch (e) {
        logger?.warning?.(`[preview] getCandle failed for ${sym}: ${e?.message}`);
      }
    }
    if (candle) candles[sym] = candle;
  }

  return { ok: true, date: currentDate, tf, candles };
}

module.exports = { start, tick, stop, getStatus, getResults, preview };
