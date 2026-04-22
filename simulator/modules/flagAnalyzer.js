"use strict";

// ---------------------------------------------------------------------------
// flagAnalyzer.js
//
// Rolling-window analysis of the bull-flag pattern across historical candles.
// Self-contained: embeds the indicator functions and detectTrendFlagBreakout
// logic copied from decision-engine/modules/{indicators,zones,constants}.js
// so that this file works inside the sim-engine Docker container which does
// not have access to the decision-engine source tree.
// ---------------------------------------------------------------------------

// ── Constants (from decision-engine/modules/constants.js) ──────────────────
const DEFAULT_TRAILING_ATR_K  = 2;
const PRICE_EPS_FACTOR        = 0.0001;
const MIN_EPS                 = 1e-6;
const MIN_CANDLES_FOR_PATTERN = 60;

// ── Indicators (from decision-engine/modules/indicators.js) ────────────────

const _atr = (candles, n) => {
  const tr = Array(candles.length).fill(null);
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high ?? candles[i].h;
    const l = candles[i].low  ?? candles[i].l;
    const pc = (candles[i - 1].close ?? candles[i - 1].c);
    if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(pc)) { tr[i] = null; continue; }
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  const atrSeries = Array(candles.length).fill(null);
  for (let i = 1; i < tr.length; i++) {
    const start = Math.max(1, i - n + 1);
    const slice = tr.slice(start, i + 1).filter((v) => Number.isFinite(v));
    atrSeries[i] = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  }
  return atrSeries;
};

const _sma = (values, period) => {
  const out = Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - period + 1);
    const slice = values.slice(start, i + 1).filter((v) => Number.isFinite(v));
    out[i] = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  }
  return out;
};

const _ema = (values, period) => {
  const out = Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) { out[i] = prev; continue; }
    prev = prev == null ? v : v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
};

const _linearRegressionSlope = (values) => {
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(values[i])) return 0;
    sumX += i; sumY += values[i]; sumXY += i * values[i]; sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
};

const _findSwings = (candles, window) => {
  const swings = [];
  for (let i = window; i < candles.length - window; i++) {
    const hi = candles[i].high ?? candles[i].h;
    const lo = candles[i].low  ?? candles[i].l;
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) continue;
    let isHigh = true, isLow = true;
    for (let k = i - window; k <= i + window; k++) {
      if (k === i) continue;
      const ch = candles[k].high ?? candles[k].h;
      const cl = candles[k].low  ?? candles[k].l;
      if (Number.isFinite(ch) && ch >= hi) isHigh = false;
      if (Number.isFinite(cl) && cl <= lo) isLow  = false;
    }
    if (isHigh) swings.push({ index: i, price: hi, type: "HIGH" });
    if (isLow)  swings.push({ index: i, price: lo, type: "LOW" });
  }
  return swings;
};

// ── detectTrendFlagBreakout (from decision-engine/modules/zones.js) ─────────
// Candles must have fields: { high|h, low|l, close|c, volume|v }

const _detectTrendFlagBreakout = (candles, options = {}) => {
  const {
    atrPeriod     = 20,
    swingWindow   = 3,
    trendBars     = 12,
    trendMinAbove = 8,
    pivotLookback = 60,
    impulseBars   = 80,
    flagBars      = 20,
    breakoutLookback = 20,
    flagAtrK      = 1.3,
    flagPctK      = 0.0025,
    volMult       = 1.2,
  } = options;

  // Normalize candle fields to {high, low, close, volume}
  const norm = candles.map((c) => ({
    t:      c.t,
    high:   Number(c.high   ?? c.h),
    low:    Number(c.low    ?? c.l),
    close:  Number(c.close  ?? c.c),
    volume: Number(c.volume ?? c.v),
  }));

  if (norm.length < Math.max(MIN_CANDLES_FOR_PATTERN, flagBars + 5)) {
    return {
      trendOk: false, flagOk: false, breakoutOk: false, pullbackOk: false,
      breakLevel: null, flagHigh: null, flagLow: null,
      breakoutEntry: null,
      targets: { tp1: null, tp2: null, trailingAtrK: DEFAULT_TRAILING_ATR_K },
      confidence: 0,
      debug: { reason: "not enough candles" },
    };
  }

  const closes  = norm.map((c) => c.close);
  const volumes = norm.map((c) => c.volume);
  const atrSeries = _atr(norm, atrPeriod);
  const lastIdx = norm.length - 1;
  const atrLast = atrSeries[lastIdx] ?? atrSeries.slice().reverse().find((v) => Number.isFinite(v)) ?? 0;
  const ema20 = _ema(closes, 20);
  const ema50 = _ema(closes, 50);
  const lastClose = closes[lastIdx];
  const lastVol   = volumes[lastIdx];
  const prevVol1  = lastIdx > 0 ? volumes[lastIdx - 1] : null;
  const prevVol2  = lastIdx > 1 ? volumes[lastIdx - 2] : null;
  const volMa20   = _sma(volumes, 20)[lastIdx];
  const priceLast = Number.isFinite(lastClose) ? lastClose : 0;
  const eps = Math.max(MIN_EPS, priceLast * PRICE_EPS_FACTOR);

  // Trend check
  const lastN = Math.min(trendBars, norm.length);
  let aboveEma20Count = 0, consideredBars = 0;
  for (let i = norm.length - lastN; i <= lastIdx; i++) {
    const ev = ema20[i], cv = closes[i];
    if (!Number.isFinite(ev) || !Number.isFinite(cv)) continue;
    consideredBars++;
    if (cv >= ev - eps) aboveEma20Count++;
  }
  let trendOk = false, trendReason = null;
  if (!Number.isFinite(ema20[lastIdx]) || !Number.isFinite(ema50[lastIdx])) trendReason = "ema not available";
  else if (ema20[lastIdx] <= ema50[lastIdx]) trendReason = "ema20 below ema50";
  else if (consideredBars < trendMinAbove)   trendReason = "insufficient ema bars";
  else if (aboveEma20Count < trendMinAbove)  trendReason = "close not above ema20";
  else trendOk = true;

  // HH/HL check
  let hhhlOk = true;
  const swings = _findSwings(norm, swingWindow);
  const recentSwings = swings.filter((s) => s.index >= norm.length - pivotLookback);
  const highs = recentSwings.filter((s) => s.type === "HIGH");
  const lows  = recentSwings.filter((s) => s.type === "LOW");
  const countHigher = (arr) => { let c = 0; for (let i = 1; i < arr.length; i++) if (arr[i].price > arr[i-1].price) c++; return c; };
  if (highs.length >= 2 && lows.length >= 2) {
    hhhlOk = countHigher(highs) >= 2 && countHigher(lows) >= 2;
  }

  // Flag metrics
  const flagSlice    = norm.slice(-flagBars);
  const impulseSlice = norm.slice(-impulseBars);
  const impulseForVol = impulseSlice.slice(0, Math.max(1, impulseSlice.length - flagBars));

  const flagHigh  = Math.max(...flagSlice.map((c) => c.high));
  const flagLow   = Math.min(...flagSlice.map((c) => c.low));
  const flagRange = flagHigh - flagLow;
  const flagAtrAvg = (() => {
    const vals = atrSeries.slice(-flagBars).filter((v) => Number.isFinite(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  })();
  const flagSlope    = _linearRegressionSlope(flagSlice.map((c) => c.close));
  const avgFlagVols  = flagSlice.map((c) => c.volume).filter((v) => Number.isFinite(v));
  const avgImpVols   = impulseForVol.map((c) => c.volume).filter((v) => Number.isFinite(v));
  const avgFlag      = avgFlagVols.length  ? avgFlagVols.reduce((a, b) => a + b, 0)  / avgFlagVols.length  : null;
  const avgImpulse   = avgImpVols.length   ? avgImpVols.reduce((a, b) => a + b, 0)   / avgImpVols.length   : null;
  const flagThreshold  = Math.max(flagAtrK * atrLast, flagPctK * priceLast);
  const slopeThreshold = Math.max(0.05 * atrLast, 0.0005 * priceLast);

  const flagOk =
    Number.isFinite(flagAtrAvg) &&
    flagRange < flagThreshold &&
    flagSlope >= -slopeThreshold &&
    (avgImpulse == null || avgFlag == null || avgFlag < 0.9 * avgImpulse);

  // Breakout / pullback
  const breakLevel  = flagHigh;
  const safeClose   = Number.isFinite(lastClose) ? lastClose : 0;
  const buffer      = Math.max(0.1 * atrLast, 0.0005 * safeClose);
  const priceBreakOk = Number.isFinite(lastClose) && lastClose > breakLevel + buffer;
  const volPass = Number.isFinite(lastVol) && Number.isFinite(volMa20) && lastVol >= volMa20 * volMult;
  const breakoutOk = priceBreakOk && volPass;

  let breakoutRecent = false, breakoutVol = null;
  norm.slice(-breakoutLookback).forEach((c) => {
    if (c.close > breakLevel + buffer) { breakoutRecent = true; breakoutVol = Math.max(breakoutVol ?? 0, c.volume ?? 0); }
  });
  const lastBar = norm[lastIdx];
  const pullbackSlice = norm.slice(-3);
  const pullbackAvgVol = pullbackSlice.map((c) => c.volume).filter((v) => Number.isFinite(v));
  const pullbackAvg = pullbackAvgVol.length ? pullbackAvgVol.reduce((a, b) => a + b, 0) / pullbackAvgVol.length : null;
  const pullbackTouch = breakoutRecent && lastBar.low <= breakLevel + buffer && lastBar.close > breakLevel;
  const pullbackOk = pullbackTouch && (breakoutVol == null || pullbackAvg == null || pullbackAvg <= breakoutVol);

  const volumeThreshold = Number.isFinite(volMa20) ? volMa20 * volMult : null;
  const volRef = [lastVol, prevVol1, prevVol2].filter((v) => Number.isFinite(v)).reduce((acc, v) => (acc == null ? v : Math.max(acc, v)), null);

  const trendOkFinal = trendOk && hhhlOk;
  const entryBreakout = Number.isFinite(breakLevel) ? breakLevel + buffer : null;

  return {
    trendOk: trendOkFinal, flagOk, breakoutOk, pullbackOk,
    breakLevel, flagHigh, flagLow,
    breakoutEntry: { breakLevel, buffer, entryTriggerPrice: entryBreakout, volumeThreshold, volumeObserved: volRef },
    targets: { tp1: null, tp2: null, trailingAtrK: DEFAULT_TRAILING_ATR_K },
    confidence: Math.min(100, Math.round((trendOk ? 30 : 0) + (flagOk ? 25 : 0) + (breakoutOk ? 25 : 0) + (pullbackOk ? 20 : 0))),
    debug: {
      trendReason, hhhlOk, priceLast, flagRange, atrLast,
      flagThresholdUsed: flagThreshold, slope: flagSlope,
      avgVolFlag: avgFlag, avgVolImpulse: avgImpulse,
      volLast: lastVol, volMA20: volMa20, volMult, volumeThreshold, buffer,
    },
  };
};

// ── Analysis constants ───────────────────────────────────────────────────────

const DEFAULT_FLAG_BARS    = 20;
const DEFAULT_FLAG_ATR_K   = 1.3;
const DEFAULT_FLAG_PCT_K   = 0.0025;
const DEFAULT_VOL_MULT     = 1.2;
const DEFAULT_ATR_PERIOD   = 20;
const DEFAULT_SWING_WINDOW = 3;
const DEFAULT_IMPULSE_BARS = 80;
const DEFAULT_LOOKAHEAD    = 20;
const DEFAULT_SPIKE_PCT    = 0.005;

// ── Main analysis function ───────────────────────────────────────────────────

/**
 * Analizza una serie di candele con rolling window e rileva eventi flag.
 *
 * @param {object[]} candles   Serie completa normalizzata { t, h|high, l|low, c|close, v|volume }
 * @param {string}   symbol
 * @param {string}   tf
 * @param {object}   params    Override parametri
 * @param {string}   runId
 * @returns {object[]}         Array di eventi da persistere
 */
function analyzeCandles(candles, symbol, tf, params = {}, runId) {
  const flagBars    = params.flagBars      ?? DEFAULT_FLAG_BARS;
  const flagAtrK    = params.flagAtrK      ?? DEFAULT_FLAG_ATR_K;
  const flagPctK    = params.flagPctK      ?? DEFAULT_FLAG_PCT_K;
  const volMult     = params.volMult       ?? DEFAULT_VOL_MULT;
  const atrPeriod   = params.atrPeriod     ?? DEFAULT_ATR_PERIOD;
  const swingWindow = params.swingWindow   ?? DEFAULT_SWING_WINDOW;
  const impulseBars = params.impulseBars   ?? DEFAULT_IMPULSE_BARS;
  const lookahead   = params.lookaheadBars ?? DEFAULT_LOOKAHEAD;
  const spikePct    = params.spikePct      ?? DEFAULT_SPIKE_PCT;
  // stride: quante candele saltare tra una finestra e la successiva.
  // stride=1 (default) = rolling window classica, finestre sovrapposte al 99% → bias.
  // stride=flagBars = finestre non sovrapposte nel periodo flag → eventi indipendenti.
  const stride      = Math.max(1, Math.round(params.stride ?? 1));

  const windowSize = Math.max(MIN_CANDLES_FOR_PATTERN, impulseBars + flagBars);
  const events     = [];
  let totalTrendOkWindows = 0; // tutti i window con trend_ok=true, indipendentemente da flag/spike

  // Contatori per-condizione su TUTTE le finestre trendOk (per capire i colli di bottiglia)
  const condFail = {
    range_too_wide:        0,
    slope_negative:        0,
    volume_not_contracted: 0,
  };

  if (!Array.isArray(candles) || candles.length < windowSize + 1) return { events, totalTrendOkWindows };

  const toMysqlTs = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().replace("T", " ").slice(0, 19);
  };

  for (let i = windowSize - 1; i < candles.length; i += stride) {
    const window  = candles.slice(i - windowSize + 1, i + 1);
    const pattern = _detectTrendFlagBreakout(window, { atrPeriod, swingWindow, impulseBars, flagBars, flagAtrK, flagPctK, volMult });
    if (!pattern) continue;

    if (pattern.trendOk) {
      totalTrendOkWindows++; // conta TUTTI i window con trend ok (senza filtri)
      // Accumula per-condizione su TUTTE le finestre trendOk, non solo quelle con spike
      if (!pattern.flagOk) {
        const dbg = pattern.debug || {};
        if (Number.isFinite(dbg.flagRange) && Number.isFinite(dbg.flagThresholdUsed) && dbg.flagRange >= dbg.flagThresholdUsed)
          condFail.range_too_wide++;
        if (Number.isFinite(dbg.slope) && Number.isFinite(dbg.atrLast)) {
          const st = Math.max(0.05 * dbg.atrLast, 0.0005 * (dbg.priceLast || 0));
          if (dbg.slope < -st) condFail.slope_negative++;
        }
        if (Number.isFinite(dbg.avgVolFlag) && Number.isFinite(dbg.avgVolImpulse) && dbg.avgVolFlag >= 0.9 * dbg.avgVolImpulse)
          condFail.volume_not_contracted++;
      }
    }

    const lastCandle    = window[window.length - 1];
    const priceAtSignal = Number(lastCandle.c ?? lastCandle.close);
    const breakLevel    = pattern.breakLevel;
    const buffer        = pattern.breakoutEntry?.buffer ?? 0;
    const volThreshold  = pattern.breakoutEntry?.volumeThreshold ?? null;

    // Lookahead analysis
    const futureCandles = candles.slice(i + 1, i + 1 + lookahead);
    let spikeDetected = false, spikeCandle = null, spikePctValue = null;
    let breakoutConfirmed = false, maxHigh = priceAtSignal, minLow = priceAtSignal;

    for (const fc of futureCandles) {
      const fh = Number(fc.h ?? fc.high);
      const fl = Number(fc.l ?? fc.low);
      const fc2 = Number(fc.c ?? fc.close);
      const fv = Number(fc.v ?? fc.volume);
      if (Number.isFinite(fh)) maxHigh = Math.max(maxHigh, fh);
      if (Number.isFinite(fl)) minLow  = Math.min(minLow, fl);
      if (!spikeDetected && Number.isFinite(breakLevel) && Number.isFinite(fc2)) {
        if (fc2 > breakLevel + buffer) {
          spikeDetected = true;
          spikeCandle   = fc;
          spikePctValue = priceAtSignal > 0 ? ((fc2 - priceAtSignal) / priceAtSignal) * 100 : null;
          if (Number.isFinite(volThreshold) && Number.isFinite(fv) && fv >= volThreshold) breakoutConfirmed = true;
        }
      }
    }

    const maxSpikePct    = priceAtSignal > 0 ? ((maxHigh - priceAtSignal) / priceAtSignal) * 100 : null;
    const maxDrawdownPct = priceAtSignal > 0 ? ((minLow  - priceAtSignal) / priceAtSignal) * 100 : null;

    const isMissedOpportunity = !pattern.flagOk && spikeDetected &&
      Number.isFinite(maxSpikePct) && maxSpikePct >= spikePct * 100;

    if (!pattern.flagOk && !isMissedOpportunity) continue;

    // Fail reason diagnosis
    let failReason = null;
    if (!pattern.flagOk) {
      const reasons = [];
      const dbg = pattern.debug || {};
      if (Number.isFinite(dbg.flagRange) && Number.isFinite(dbg.flagThresholdUsed) && dbg.flagRange >= dbg.flagThresholdUsed)
        reasons.push("range_too_wide");
      if (Number.isFinite(dbg.slope) && Number.isFinite(dbg.atrLast)) {
        const st = Math.max(0.05 * dbg.atrLast, 0.0005 * (dbg.priceLast || 0));
        if (dbg.slope < -st) reasons.push("slope_negative");
      }
      if (Number.isFinite(dbg.avgVolFlag) && Number.isFinite(dbg.avgVolImpulse) && dbg.avgVolFlag >= 0.9 * dbg.avgVolImpulse)
        reasons.push("volume_not_contracted");
      failReason = reasons.length === 0 ? "unknown" : reasons.join("+");
    }

    events.push({
      run_id:             runId,
      symbol:             symbol.toUpperCase(),
      candle_ts:          toMysqlTs(lastCandle.t),
      tf,
      flag_ok:            pattern.flagOk ? 1 : 0,
      trend_ok:           pattern.trendOk ? 1 : 0,
      breakout_ok:        pattern.breakoutOk ? 1 : 0,
      pullback_ok:        pattern.pullbackOk ? 1 : 0,
      price_at_signal:    Number.isFinite(priceAtSignal) ? priceAtSignal : null,
      break_level:        Number.isFinite(breakLevel) ? breakLevel : null,
      flag_high:          Number.isFinite(pattern.flagHigh) ? pattern.flagHigh : null,
      flag_low:           Number.isFinite(pattern.flagLow)  ? pattern.flagLow  : null,
      flag_range:         Number.isFinite(pattern.debug?.flagRange) ? pattern.debug.flagRange : null,
      flag_threshold:     Number.isFinite(pattern.debug?.flagThresholdUsed) ? pattern.debug.flagThresholdUsed : null,
      atr_last:           Number.isFinite(pattern.debug?.atrLast) ? pattern.debug.atrLast : null,
      slope:              Number.isFinite(pattern.debug?.slope) ? pattern.debug.slope : null,
      // DECIMAL(20,2) max = 99999999999999999.99 — clamp per sicurezza
      avg_vol_flag:       Number.isFinite(pattern.debug?.avgVolFlag)     && pattern.debug.avgVolFlag     < 1e18 ? Math.round(pattern.debug.avgVolFlag)     : null,
      avg_vol_impulse:    Number.isFinite(pattern.debug?.avgVolImpulse)  && pattern.debug.avgVolImpulse  < 1e18 ? Math.round(pattern.debug.avgVolImpulse)  : null,
      fail_reason:        failReason,
      lookahead_bars:     lookahead,
      spike_detected:     spikeDetected ? 1 : 0,
      spike_pct:          Number.isFinite(spikePctValue) ? spikePctValue : null,
      spike_candle_ts:    toMysqlTs(spikeCandle?.t),
      breakout_confirmed: breakoutConfirmed ? 1 : 0,
      max_drawdown_pct:   Number.isFinite(maxDrawdownPct) ? maxDrawdownPct : null,
      flag_bars:          flagBars,
      flag_atr_k:         flagAtrK,
      flag_pct_k:         flagPctK,
    });
  }

  return { events, totalTrendOkWindows, condFail };
}

module.exports = { analyzeCandles };
