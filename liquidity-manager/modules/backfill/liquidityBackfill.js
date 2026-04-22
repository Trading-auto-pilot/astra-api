"use strict";

// ---------------------------------------------------------------------------
// liquidityBackfill.js
//
// Computes liquidity scores for a historical date range and persists them
// to liquidity_daily_scores (upsert — existing live rows are NOT overwritten).
//
// Algorithm:
//   1. Fetch full historical series for all 4 providers in one batch
//      (from - WARMUP_DAYS to endDate inclusive)
//   2. Determine the list of trading days in [fromDate, toDate]
//   3. For each day, slice each series to data up-to-and-including that day,
//      run the same normalizers as the live engine, compute the weighted score
//   4. Apply EMA stabilization (same logic as main.js) carrying prev forward
//   5. Upsert the row to liquidity_daily_scores (409/duplicate → skip)
//
// Key constraints:
//   - SPY normalizer requires 210 bars → warm-up days must cover that
//   - EMA seed: first day in range uses raw score as EMA (no prev)
//   - source is always "backfill" → does not overwrite live/scheduler rows
// ---------------------------------------------------------------------------

const axios = require("axios");
const { getConfigNumber, getConfigString } = require("../../../shared/loadSettings");
const { normalizeVix } = require("../normalizers/vixNormalizer");
const { normalizeSpyTrend } = require("../normalizers/spyTrendNormalizer");
const { normalizeDxy } = require("../normalizers/dxyNormalizer");
const { normalizeCreditSpread } = require("../normalizers/creditNormalizer");

const defaultVixProvider    = require("../../providers/vixProvider");
const defaultSpyProvider    = require("../../providers/spyProvider");
const defaultDxyProvider    = require("../../providers/dxyProvider");
const defaultCreditProvider = require("../../providers/creditProvider");

// Warm-up days prepended before fromDate so the EMA and SMA(200) are stable
const WARMUP_DAYS = 250; // ~200 trading days

const DEFAULT_WEIGHTS = { vix: 0.35, spyTrend: 0.35, dxy: 0.15, credit: 0.15 };

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function round(v, p = 2) { const f = 10 ** p; return Math.round(v * f) / f; }

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function toDay(isoString) {
  return String(isoString || "").slice(0, 10);
}

/** Enumerate all calendar days from startDate to endDate inclusive (YYYY-MM-DD). */
function enumerateDays(startDate, endDate) {
  const days = [];
  let cur = startDate;
  while (cur <= endDate) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  return days;
}

/** Filter a time series to entries with timestamp <= dayStr (inclusive). */
function sliceUpTo(series, dayStr) {
  return series.filter((item) => toDay(item.timestamp) <= dayStr);
}

/** Find the latest value in a series with timestamp <= dayStr. */
function latestUpTo(series, dayStr) {
  const slice = sliceUpTo(series, dayStr);
  return slice[slice.length - 1] ?? null;
}

function resolveRiskRegime(score, confidence, minConf) {
  if (!Number.isFinite(Number(score)) || confidence < minConf) return "UNKNOWN";
  if (score < 30) return "RISK_OFF";
  if (score > 60) return "RISK_ON";
  return "NEUTRAL";
}

function resolveVolatilityRegime(vixRaw) {
  if (!Number.isFinite(vixRaw)) return "UNKNOWN";
  if (vixRaw <= 15) return "LOW";
  if (vixRaw >= 25) return "HIGH";
  return "NORMAL";
}

/**
 * Compute the raw score for a single day given pre-fetched series.
 * Returns { score, confidence, components, volatilityRegime } or null on total failure.
 */
function computeDayScore(dayStr, { vixSeries, spySeries, dxySeries, creditSeries, weights, minConf }) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const totalWeight = Object.values(w).reduce((s, v) => s + Number(v), 0);

  const vixLatest    = latestUpTo(vixSeries, dayStr);
  const spySlice     = sliceUpTo(spySeries, dayStr);
  const dxySlice     = sliceUpTo(dxySeries, dayStr);
  const creditLatest = latestUpTo(creditSeries, dayStr);

  const components = {};

  // VIX
  if (vixLatest && Number.isFinite(Number(vixLatest.value))) {
    const raw = Number(vixLatest.value);
    const n = normalizeVix(raw);
    components.vix = {
      raw,
      normalized: Number.isFinite(n.normalized) ? round(n.normalized, 2) : null,
      weight: w.vix,
      timestamp: vixLatest.timestamp,
      source: vixLatest.source,
      details: n.details,
      status: Number.isFinite(n.normalized) ? "OK" : "MISSING",
    };
  } else {
    components.vix = { raw: null, normalized: null, weight: w.vix, status: "MISSING" };
  }

  // SPY (needs full slice for SMA calculations)
  {
    const dxyLatest = dxySlice[dxySlice.length - 1] ?? null;
    const n = normalizeSpyTrend(spySlice);
    const latestSpy = spySlice[spySlice.length - 1] ?? null;
    components.spyTrend = {
      raw: latestSpy ? Number(latestSpy.value) : null,
      normalized: Number.isFinite(n.normalized) ? round(n.normalized, 2) : null,
      weight: w.spyTrend,
      timestamp: latestSpy?.timestamp ?? null,
      source: latestSpy?.source ?? null,
      details: n.details,
      status: Number.isFinite(n.normalized) ? "OK" : "MISSING",
    };
    void dxyLatest; // suppress lint
  }

  // DXY
  {
    const n = normalizeDxy(dxySlice);
    const latestDxy = dxySlice[dxySlice.length - 1] ?? null;
    components.dxy = {
      raw: latestDxy ? Number(latestDxy.value) : null,
      normalized: Number.isFinite(n.normalized) ? round(n.normalized, 2) : null,
      weight: w.dxy,
      timestamp: latestDxy?.timestamp ?? null,
      source: latestDxy?.source ?? null,
      details: n.details,
      status: Number.isFinite(n.normalized) ? "OK" : "MISSING",
    };
  }

  // Credit spread
  if (creditLatest && Number.isFinite(Number(creditLatest.value))) {
    const raw = Number(creditLatest.value);
    const n = normalizeCreditSpread(raw);
    components.credit = {
      raw,
      normalized: Number.isFinite(n.normalized) ? round(n.normalized, 2) : null,
      weight: w.credit,
      timestamp: creditLatest.timestamp,
      source: creditLatest.source,
      details: n.details,
      status: Number.isFinite(n.normalized) ? "OK" : "MISSING",
    };
  } else {
    components.credit = { raw: null, normalized: null, weight: w.credit, status: "MISSING" };
  }

  let availableWeight = 0;
  let weightedSum = 0;
  for (const [key, comp] of Object.entries(components)) {
    if (comp.status === "OK" && Number.isFinite(comp.normalized)) {
      availableWeight += w[key];
      weightedSum += comp.normalized * w[key];
    }
  }

  const score = availableWeight > 0 ? clamp(round(weightedSum / availableWeight, 2), 0, 100) : null;
  const confidence = totalWeight > 0 ? clamp(round(availableWeight / totalWeight, 2), 0, 1) : 0;
  const riskRegime = resolveRiskRegime(score, confidence, minConf);
  const volatilityRegime = resolveVolatilityRegime(components.vix?.raw);

  return { score, confidence, riskRegime, volatilityRegime, components };
}

/**
 * Apply EMA stabilization (mirrors main.js logic exactly).
 * Returns { score_ema, riskRegimeSmoothed, score_rate_limited, _ema }.
 */
function applyEma(rawScore, prev, config) {
  const {
    emaAlpha, emaMaxDailyChange, emaDecayThreshold, emaDecayRate,
    hysteresisRiskOffEnter, hysteresisRiskOffExit,
    hysteresisRiskOnEnter, hysteresisRiskOnExit,
    minConfidenceForRegime,
    confidence,
    prevRegime,
  } = config;

  const prevEma =
    prev?.score_ema != null && Number.isFinite(Number(prev.score_ema)) ? Number(prev.score_ema) :
    prev?.score_raw != null && Number.isFinite(Number(prev.score_raw)) ? Number(prev.score_raw) :
    null;

  if (prevEma == null || rawScore == null) {
    return {
      score_ema: rawScore,
      riskRegimeSmoothed: null,
      score_rate_limited: null,
      _ema: { alphaEffective: null, decayApplied: false, prevRegime, rateLimited: false },
    };
  }

  let scoreEma;
  let alphaEffective = null;
  let decayApplied = false;
  let rateLimited = false;

  if (confidence < emaDecayThreshold) {
    decayApplied = true;
    scoreEma = prevEma + emaDecayRate * (50 - prevEma);
  } else {
    alphaEffective = Math.min(1, emaAlpha * confidence);
    scoreEma = alphaEffective * rawScore + (1 - alphaEffective) * prevEma;
  }

  const delta = scoreEma - prevEma;
  let score_rate_limited = null;
  if (Math.abs(delta) > emaMaxDailyChange) {
    rateLimited = true;
    scoreEma = prevEma + Math.sign(delta) * emaMaxDailyChange;
    score_rate_limited = Math.round(scoreEma * 100) / 100;
  }

  scoreEma = Math.round(scoreEma * 100) / 100;

  // Hysteresis regime
  function resolveHysteresis(ema, prev_) {
    if (!Number.isFinite(ema) || confidence < minConfidenceForRegime) return "UNKNOWN";
    if (prev_ === "RISK_OFF") {
      if (ema > hysteresisRiskOffExit) return ema > hysteresisRiskOnEnter ? "RISK_ON" : "NEUTRAL";
      return "RISK_OFF";
    }
    if (prev_ === "RISK_ON") {
      if (ema < hysteresisRiskOnExit) return ema < hysteresisRiskOffEnter ? "RISK_OFF" : "NEUTRAL";
      return "RISK_ON";
    }
    if (ema < hysteresisRiskOffEnter) return "RISK_OFF";
    if (ema > hysteresisRiskOnEnter)  return "RISK_ON";
    return "NEUTRAL";
  }

  return {
    score_ema: scoreEma,
    riskRegimeSmoothed: resolveHysteresis(scoreEma, prevRegime),
    score_rate_limited,
    _ema: { alphaEffective, decayApplied, prevRegime, rateLimited },
  };
}

/**
 * Upsert one row to liquidity_daily_scores via datahub.
 * source="backfill" — a 409/duplicate means a live row already exists → skip.
 */
async function upsertRow(datahubUrl, row) {
  try {
    await axios.post(`${datahubUrl}/api/table/liquidity_daily_scores`, row, { timeout: 8000 });
    return "inserted";
  } catch (err) {
    const status = err?.response?.status;
    const msg = err?.response?.data?.message || err?.response?.data?.error || err?.message || "";
    if (status === 409 || String(msg).toLowerCase().includes("duplicate")) {
      return "skipped";
    }
    // Re-throw with full datahub detail for diagnosability
    const detail = err?.response?.data ? JSON.stringify(err.response.data) : err?.message;
    throw new Error(`datahub status=${status ?? "?"}: ${detail}`);
  }
}

/**
 * Main backfill function.
 *
 * @param {object} opts
 * @param {string} opts.fromDate  - YYYY-MM-DD (inclusive)
 * @param {string} opts.toDate    - YYYY-MM-DD (inclusive)
 * @param {object} opts.config    - EMA / hysteresis params (from LiquidityManager)
 * @param {object} opts.providers - optional provider overrides (for testing)
 * @param {object} opts.logger
 * @param {Function} opts.onProgress - optional callback(dayStr, result)
 * @returns {{ processed, inserted, skipped, errors, days }}
 */
async function runBackfill({
  fromDate,
  toDate,
  config = {},
  providers: providerOverrides = {},
  logger = console,
  onProgress,
} = {}) {
  if (!fromDate || !toDate || fromDate > toDate) {
    throw new Error(`Invalid date range: fromDate=${fromDate} toDate=${toDate}`);
  }

  const emaConfig = {
    emaAlpha:               config.emaAlpha               ?? getConfigNumber("LIQ_EMA_ALPHA", 0.2),
    emaMaxDailyChange:      config.emaMaxDailyChange       ?? getConfigNumber("LIQ_MAX_DAILY_SCORE_CHANGE", 8),
    emaDecayThreshold:      config.emaDecayThreshold       ?? getConfigNumber("LIQ_DECAY_CONFIDENCE_THRESHOLD", 0.3),
    emaDecayRate:           config.emaDecayRate            ?? getConfigNumber("LIQ_DECAY_RATE", 0.05),
    hysteresisRiskOffEnter: config.hysteresisRiskOffEnter  ?? getConfigNumber("LIQ_HYSTERESIS_RISK_OFF_ENTER", 28),
    hysteresisRiskOffExit:  config.hysteresisRiskOffExit   ?? getConfigNumber("LIQ_HYSTERESIS_RISK_OFF_EXIT", 32),
    hysteresisRiskOnEnter:  config.hysteresisRiskOnEnter   ?? getConfigNumber("LIQ_HYSTERESIS_RISK_ON_ENTER", 62),
    hysteresisRiskOnExit:   config.hysteresisRiskOnExit    ?? getConfigNumber("LIQ_HYSTERESIS_RISK_ON_EXIT", 58),
    minConfidenceForRegime: config.minConfidenceForRegime  ?? getConfigNumber("LIQ_MIN_CONFIDENCE_FOR_REGIME", 0.6),
  };

  const datahubUrl = getConfigString(["DATAHUB_URL", "DBMANAGER_URL"], "http://datahub:3000").replace(/\/+$/, "");
  const mode = "live"; // backfill always uses live provider data (historical series)
  const timeoutMs = getConfigNumber("LIQ_PROVIDER_TIMEOUT_MS", 15000);

  const providers = {
    vix:    providerOverrides.vix    ?? defaultVixProvider,
    spy:    providerOverrides.spy    ?? defaultSpyProvider,
    dxy:    providerOverrides.dxy    ?? defaultDxyProvider,
    credit: providerOverrides.credit ?? defaultCreditProvider,
  };

  // Fetch window: start WARMUP_DAYS before fromDate so SMA(200) is warm
  const fetchFrom = addDays(fromDate, -WARMUP_DAYS);

  logger.info?.(`[backfill] fetching provider data fetchFrom=${fetchFrom} toDate=${toDate}`);

  // Fetch all series in parallel
  const [vixSeries, spySeries, dxySeries, creditSeries] = await Promise.all([
    providers.vix.getHistory(fetchFrom, toDate, { mode, timeoutMs, logger })
      .catch((err) => { logger.warning?.(`[backfill] vix fetch failed: ${err?.message}`); return []; }),
    providers.spy.getHistory(fetchFrom, toDate, { mode, timeoutMs, logger })
      .catch((err) => { logger.warning?.(`[backfill] spy fetch failed: ${err?.message}`); return []; }),
    providers.dxy.getHistory(fetchFrom, toDate, { mode, timeoutMs, logger })
      .catch((err) => { logger.warning?.(`[backfill] dxy fetch failed: ${err?.message}`); return []; }),
    providers.credit.getHistory(fetchFrom, toDate, { mode, timeoutMs, logger })
      .catch((err) => { logger.warning?.(`[backfill] credit fetch failed: ${err?.message}`); return []; }),
  ]);

  logger.info?.(
    `[backfill] series fetched vix=${vixSeries.length} spy=${spySeries.length} ` +
    `dxy=${dxySeries.length} credit=${creditSeries.length}`
  );

  const days = enumerateDays(fromDate, toDate);
  logger.info?.(`[backfill] processing ${days.length} calendar days from=${fromDate} to=${toDate}`);

  const stats = { processed: 0, inserted: 0, skipped: 0, errors: 0, days: days.length, firstError: null };

  // EMA carries forward across the loop
  let prevEmaState = null; // { score_raw, score_ema, riskRegimeSmoothed }
  let prevRegime   = "NEUTRAL";

  for (const dayStr of days) {
    try {
      const { score, confidence, riskRegime, volatilityRegime, components } = computeDayScore(dayStr, {
        vixSeries, spySeries, dxySeries, creditSeries,
        weights: DEFAULT_WEIGHTS,
        minConf: emaConfig.minConfidenceForRegime,
      });

      const emaResult = applyEma(score, prevEmaState, {
        ...emaConfig,
        confidence,
        prevRegime,
      });

      const c = components;
      const ema = emaResult._ema;
      const componentsBitmask =
        (c.vix?.status      === "OK" ? 1 : 0) |
        (c.spyTrend?.status === "OK" ? 2 : 0) |
        (c.dxy?.status      === "OK" ? 4 : 0) |
        (c.credit?.status   === "OK" ? 8 : 0);

      const currentRegime = emaResult.riskRegimeSmoothed ?? riskRegime;
      const regimeChanged  = prevRegime != null && currentRegime != null && prevRegime !== currentRegime ? 1 : 0;

      const row = {
        score_date:           dayStr,
        calculated_at:        dayStr + "T00:00:00.000Z",
        source:               "backfill",
        score_raw:            score,
        score_ema:            emaResult.score_ema,
        score_rate_limited:   emaResult.score_rate_limited ?? null,
        confidence,
        alpha_effective:      ema.alphaEffective  ?? null,
        decay_applied:        ema.decayApplied    ? 1 : 0,
        ema_staleness_days:   0,
        components_available: componentsBitmask,
        vix_value:            c.vix?.raw              ?? null,
        vix_score:            c.vix?.normalized       ?? null,
        vix_weight_used:      c.vix?.weight           ?? null,
        spy_return_1d:        c.spyTrend?.raw         ?? null,
        spy_sma50:            c.spyTrend?.details?.sma50  ?? null,
        spy_sma200:           c.spyTrend?.details?.sma200 ?? null,
        spy_score:            c.spyTrend?.normalized   ?? null,
        spy_weight_used:      c.spyTrend?.weight       ?? null,
        dxy_value:            c.dxy?.raw               ?? null,
        dxy_score:            c.dxy?.normalized        ?? null,
        dxy_weight_used:      c.dxy?.weight            ?? null,
        credit_spread_value:  c.credit?.raw            ?? null,
        credit_score:         c.credit?.normalized     ?? null,
        credit_weight_used:   c.credit?.weight         ?? null,
        risk_regime:          currentRegime,
        previous_risk_regime: prevRegime ?? null,
        regime_changed:       regimeChanged,
        volatility_regime:    volatilityRegime,
        notes:                null,
      };

      const outcome = await upsertRow(datahubUrl, row);
      stats.processed++;
      if (outcome === "inserted") stats.inserted++;
      else stats.skipped++;

      // Advance EMA state for next iteration
      prevEmaState = { score_raw: score, score_ema: emaResult.score_ema };
      prevRegime   = currentRegime ?? prevRegime;

      onProgress?.(dayStr, { outcome, score, score_ema: emaResult.score_ema, confidence });
    } catch (err) {
      stats.processed++;
      stats.errors++;
      const errMsg = err?.message || String(err);
      if (!stats.firstError) stats.firstError = `day=${dayStr}: ${errMsg}`;
      logger.warning?.(`[backfill] error on day=${dayStr}: ${errMsg}`);
      onProgress?.(dayStr, { outcome: "error", error: err?.message });
    }
  }

  logger.info?.(
    `[backfill] done processed=${stats.processed} inserted=${stats.inserted} ` +
    `skipped=${stats.skipped} errors=${stats.errors}`
  );

  return stats;
}

module.exports = { runBackfill };
