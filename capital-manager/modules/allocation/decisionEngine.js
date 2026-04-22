// modules/allocation/decisionEngine.js
"use strict";

const { clamp } = require("../utils/clamp");
const { getConfigNumber } = require("../../../shared/loadSettings");

// Default values read from env at startup — used when no runtime override is set in Redis.
const DEFAULT_CONFIG = {
  FALLBACK_RESERVED_CASH_PCT: getConfigNumber("FALLBACK_RESERVED_CASH_PCT", 0.60),
  SCORE_RESERVED_MIN:         getConfigNumber("SCORE_RESERVED_MIN", 0.20),
  SCORE_RESERVED_MAX:         getConfigNumber("SCORE_RESERVED_MAX", 0.70),
  RISK_OFF_ADD_PCT:           getConfigNumber("RISK_OFF_ADD_PCT", 0.10),
  VOL_ADD_MAX_PCT:            getConfigNumber("VOL_ADD_MAX_PCT", 0.10),
  VOL_SCALE:                  getConfigNumber("VOL_SCALE", 100),
  MIN_ORDER_NOTIONAL:         getConfigNumber("MIN_ORDER_NOTIONAL", 50),
  CONFIDENCE_THRESHOLD:       getConfigNumber("CONFIDENCE_THRESHOLD", 69),
  // Allocation concentration limits — env var → Redis override
  MAX_PERC_TICKER:            getConfigNumber("MAX_PERC_TICKER", 0.10),
  MAX_PERC_SECTOR:            getConfigNumber("MAX_PERC_SECTOR", 0.40),
  MAX_PERC_INDUSTRY:          getConfigNumber("MAX_PERC_INDUSTRY", 0.30),
  MAX_PERC_AREA:              getConfigNumber("MAX_PERC_AREA", 0.50),
};

/**
 * Compute reservedCashPct from liquidity data.
 *
 * Formula:
 *   if confidence < CONFIDENCE_THRESHOLD → fallback FALLBACK_RESERVED_CASH_PCT
 *   else:
 *     base = SCORE_RESERVED_MAX - (score / 100) * (SCORE_RESERVED_MAX - SCORE_RESERVED_MIN)
 *     if riskRegime == "OFF" → base += RISK_OFF_ADD_PCT
 *     base += clamp(volatility / VOL_SCALE, 0, VOL_ADD_MAX_PCT)
 *     reservedCashPct = clamp(base, SCORE_RESERVED_MIN, 0.85)
 *
 * @param {{score:number, riskRegime:string, volatility:number, confidence:number}} liquidity
 * @param {object} [config] - Runtime config overrides (from Redis). Falls back to DEFAULT_CONFIG.
 * @returns {{reservedCashPct:number, reasons:string[], usedFallback:boolean}}
 */
function computeReservedCashPct(liquidity, config = {}) {
  const {
    CONFIDENCE_THRESHOLD,
    FALLBACK_RESERVED_CASH_PCT,
    SCORE_RESERVED_MIN,
    SCORE_RESERVED_MAX,
    RISK_OFF_ADD_PCT,
    VOL_ADD_MAX_PCT,
    VOL_SCALE,
  } = { ...DEFAULT_CONFIG, ...config };

  // Prefer EMA-smoothed score and hysteresis regime when available
  const score = Number.isFinite(liquidity.score_ema) ? liquidity.score_ema : liquidity.score;
  const riskRegime = liquidity.riskRegimeSmoothed ?? liquidity.riskRegime;
  const { volatility, confidence } = liquidity;
  const reasons = [];

  if (confidence < CONFIDENCE_THRESHOLD) {
    reasons.push(`confidence=${confidence} < ${CONFIDENCE_THRESHOLD} → fallback ${FALLBACK_RESERVED_CASH_PCT}`);
    return { reservedCashPct: FALLBACK_RESERVED_CASH_PCT, reasons, usedFallback: true };
  }

  // Base: linear interpolation between SCORE_RESERVED_MAX (score=0) and SCORE_RESERVED_MIN (score=100)
  let base = SCORE_RESERVED_MAX - (score / 100) * (SCORE_RESERVED_MAX - SCORE_RESERVED_MIN);
  reasons.push(`score=${score} → base=${base.toFixed(3)}`);

  const normalizedRegime = String(riskRegime || "").toUpperCase();
  if (normalizedRegime === "OFF" || normalizedRegime === "RISK_OFF") {
    base += RISK_OFF_ADD_PCT;
    reasons.push(`riskRegime=OFF → +${RISK_OFF_ADD_PCT}`);
  }

  const volAdj = clamp(volatility / VOL_SCALE, 0, VOL_ADD_MAX_PCT);
  if (volAdj > 0) {
    base += volAdj;
    reasons.push(`volatility=${volatility} / volScale=${VOL_SCALE} → +${volAdj.toFixed(3)}`);
  }

  const reservedCashPct = clamp(base, SCORE_RESERVED_MIN, 0.85);
  if (reservedCashPct !== base) {
    reasons.push(`clamped to [${SCORE_RESERVED_MIN}, 0.85] → ${reservedCashPct.toFixed(3)}`);
  }

  return { reservedCashPct, reasons, usedFallback: false };
}

/**
 * Compute the full allocation decision for a quote request.
 *
 * @param {object} params
 * @param {number} params.cashAvailable        - From ibkr-bridge account summary
 * @param {number} params.openOrdersReserved   - From exposureCalculator
 * @param {number} params.reservationsReserved - From reservationsStore
 * @param {{score, riskRegime, volatility, confidence}} params.liquidity
 * @param {string} params.symbol
 * @param {string} params.market
 * @param {object} [params.config]             - Runtime config overrides (from Redis)
 * @param {object} [params.logger]
 * @returns {{ok:boolean, decision:object, error:object|null}}
 */
function computeAllocationDecision({
  cashAvailable,
  openOrdersReserved,
  reservationsReserved,
  liquidity,
  symbol,
  market,
  config = {},
  logger,
}) {
  const effectiveConfig = { ...DEFAULT_CONFIG, ...config };
  const { MIN_ORDER_NOTIONAL, CONFIDENCE_THRESHOLD } = effectiveConfig;

  const { reservedCashPct, reasons, usedFallback } = computeReservedCashPct(liquidity, effectiveConfig);

  const reservedCash = cashAvailable * reservedCashPct;
  const maxInvestable = Math.max(
    0,
    cashAvailable - reservedCash - reservationsReserved - openOrdersReserved
  );

  const decision = {
    symbol,
    market,
    maxInvestable: Math.floor(maxInvestable * 100) / 100,
    reservedCashPct,
    reservedCash: Math.floor(reservedCash * 100) / 100,
    riskRegime: liquidity.riskRegime,
    liquidityScore: liquidity.confidence >= CONFIDENCE_THRESHOLD
      ? (Number.isFinite(liquidity.score_ema) ? liquidity.score_ema : liquidity.score)
      : null,
    confidence: liquidity.confidence,
    volatility: liquidity.volatility,
    constraints: {
      cashAvailable,
      openOrdersReserved,
      reservationsReserved,
    },
    reasons,
    usedFallback,
    ts: new Date().toISOString(),
  };

  if (logger) {
    logger.info(`[decisionEngine] ${symbol} maxInvestable=${maxInvestable.toFixed(2)} (cash=${cashAvailable}, reservedPct=${reservedCashPct.toFixed(3)}, openOrders=${openOrdersReserved}, reservations=${reservationsReserved})`);
  }

  if (decision.maxInvestable < MIN_ORDER_NOTIONAL) {
    return {
      ok: false,
      decision,
      error: {
        code: "INSUFFICIENT_CAPITAL",
        message: `maxInvestable ${decision.maxInvestable} is below minimum order notional ${MIN_ORDER_NOTIONAL}`,
        details: { maxInvestable: decision.maxInvestable, minOrderNotional: MIN_ORDER_NOTIONAL },
      },
    };
  }

  return { ok: true, decision, error: null };
}

/**
 * Return the default config values (env vars resolved at startup).
 * Used to initialize Redis settings on first boot.
 */
function getDefaultConfig() {
  return { ...DEFAULT_CONFIG };
}

module.exports = { computeReservedCashPct, computeAllocationDecision, getDefaultConfig };
