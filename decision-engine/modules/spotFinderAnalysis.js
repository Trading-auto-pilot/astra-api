"use strict";

/**
 * spotFinderAnalysis.js
 *
 * Pure async function for single-ticker spot-finder analysis.
 * Extracted from the GET / route handler in decision-engine.js.
 *
 * Usage:
 *   const result = await runSpotFinderAnalysis(req.query, { cachemanagerUrl, cacheManagerTimeoutMs, logger });
 *   if (!result.ok && result._status) return res.status(result._status).json({ ok: false, error: result.error, data: result.data });
 *   return res.json(result);
 */

const axios = require("axios");
const C = require("./constants");
const { asNumber, asBool, subDays, normalizeAndSortCandles } = require("./helpers");
const { pickCandidate, pickClosestByDistance } = require("./indicators");
const { buildZones, detectTrendFlagBreakout, computeEntryLevels } = require("./zones");
const { fetchAndAnalyze } = require("./candle-fetcher");

/**
 * @param {object} query                 Raw query-string params (same shape as req.query)
 * @param {object} deps
 * @param {string} deps.cachemanagerUrl
 * @param {number} deps.cacheManagerTimeoutMs
 * @param {object} [deps.logger]
 * @returns {Promise<object>}            Response body — on known HTTP errors includes `_status` field
 */
async function runSpotFinderAnalysis(query, deps) {
  const { cachemanagerUrl, cacheManagerTimeoutMs, logger } = deps;

  const ticker = String(query.ticker || query.symbol || "").trim().toUpperCase();
  const lookbackDays = asNumber(query.lookbackDays ?? query.periodDays, C.DEFAULT_LOOKBACK_DAYS);
  const lookbackBars = Math.max(C.MIN_LOOKBACK_BARS, asNumber(query.lookbackBars, C.DEFAULT_LOOKBACK_BARS));
  const tf = String(query.tf || query.timeframe || C.DEFAULT_TF).trim() || C.DEFAULT_TF;
  const exchange = String(query.exchange || "").trim();
  const confirmLookbackDays = asNumber(query.confirmLookbackDays, C.CONFIRM_LOOKBACK_DAYS);
  const confirmLookbackBars = Math.max(C.MIN_LOOKBACK_BARS, asNumber(query.confirmLookbackBars, C.CONFIRM_LOOKBACK_BARS));
  const confirmTf = String(query.confirmTf || C.DEFAULT_CONFIRM_TF).trim() || C.DEFAULT_CONFIRM_TF;
  const recentLookbackDays = asNumber(query.recentLookbackDays, C.RECENT_LOOKBACK_DAYS);
  const recentLookbackBars = Math.max(C.MIN_LOOKBACK_BARS, asNumber(query.recentLookbackBars, C.RECENT_LOOKBACK_BARS));
  const recentTf = String(query.recentTf || C.DEFAULT_RECENT_TF).trim() || C.DEFAULT_RECENT_TF;
  const intradayLookbackDays = asNumber(query.intradayLookbackDays, C.INTRADAY_LOOKBACK_DAYS);
  const intradayLookbackBars = Math.max(C.MIN_LOOKBACK_BARS, asNumber(query.intradayLookbackBars, C.INTRADAY_LOOKBACK_BARS));
  const intradayTf = String(query.intradayTf || C.DEFAULT_INTRADAY_TF).trim() || C.DEFAULT_INTRADAY_TF;
  const signalLookbackDays = asNumber(query.signalLookbackDays, C.SIGNAL_LOOKBACK_DAYS);
  const signalLookbackBars = Math.max(C.MIN_LOOKBACK_BARS, asNumber(query.signalLookbackBars, C.SIGNAL_LOOKBACK_BARS));
  const signalTf = String(query.signalTf || C.DEFAULT_SIGNAL_TF).trim() || C.DEFAULT_SIGNAL_TF;
  const flagAtrK = asNumber(query.flagAtrK, C.DEFAULT_FLAG_ATR_K);
  const flagPctK = asNumber(query.flagPctK, C.DEFAULT_FLAG_PCT_K);
  const volMult = asNumber(query.volMult, C.DEFAULT_VOL_MULT);
  const minStopAtrK = asNumber(query.minStopAtrK, C.DEFAULT_MIN_STOP_ATR_K);
  const minTp2AtrK = asNumber(query.minTp2AtrK, C.DEFAULT_MIN_TP2_ATR_K);
  const enableConfirm = asBool(query.confirm, true);
  const swingWindow = Math.max(1, asNumber(query.swingWindow, C.DEFAULT_SWING_WINDOW));
  const atrPeriod = Math.max(2, asNumber(query.atrPeriod, C.DEFAULT_ATR_PERIOD));
  const clusterMultiplier = Math.max(0.1, asNumber(query.clusterMultiplier, C.DEFAULT_CLUSTER_MULTIPLIER));
  const reactionLookahead = Math.max(2, asNumber(query.reactionLookahead, C.DEFAULT_REACTION_LOOKAHEAD));
  const minTouches = Math.max(1, asNumber(query.minTouches, C.DEFAULT_MIN_TOUCHES));
  const minScore = Math.max(0, asNumber(query.minScore, C.DEFAULT_MIN_SCORE));
  const minRecentBars = Math.max(1, asNumber(query.minRecentBars, C.DEFAULT_RECENT_BARS));
  const recencyRecent = Math.max(1, asNumber(query.recencyRecent, C.DEFAULT_RECENCY_RECENT));
  const recencyMid = Math.max(recencyRecent, asNumber(query.recencyMid, C.DEFAULT_RECENCY_MID));
  const weightRecent = asNumber(query.weightRecent, C.DEFAULT_WEIGHT_RECENT);
  const weightMid = asNumber(query.weightMid, C.DEFAULT_WEIGHT_MID);
  const weightOld = asNumber(query.weightOld, C.DEFAULT_WEIGHT_OLD);
  const zoneFillK = asNumber(query.zoneFillK, C.DEFAULT_ZONE_FILL_K);
  const breakoutK = asNumber(query.breakoutK, C.DEFAULT_BREAKOUT_K);
  const structuralK = asNumber(query.structuralK, C.DEFAULT_STRUCTURAL_K);
  const volatilityK = asNumber(query.volatilityK, C.DEFAULT_VOLATILITY_K);
  const tpAtrK = asNumber(query.tpAtrK, C.DEFAULT_TP_ATR_K);
  const maxLevelDistanceAtr = Math.max(0.5, asNumber(query.maxLevelDistanceAtr, C.DEFAULT_MAX_LEVEL_DISTANCE_ATR));
  const inputCurrentPrice = asNumber(query.currentPrice, null);
  const currentPrice = Number.isFinite(inputCurrentPrice) ? inputCurrentPrice : null;

  const endDate = new Date();
  const startDate = subDays(endDate, lookbackDays);
  const fetchParams = {
    symbol: ticker,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    tf,
  };
  if (exchange) fetchParams.exchange = exchange;

  const zoneOpts = {
    lookbackBars, atrPeriod, swingWindow, clusterMultiplier,
    reactionLookahead, minTouches, minScore, minRecentBars,
    recencyRecent, recencyMid, weightRecent, weightMid, weightOld,
  };

  // --- Base timeframe ---
  const resp = await axios.get(`${cachemanagerUrl}/candles`, {
    params: fetchParams,
    timeout: cacheManagerTimeoutMs,
  });
  const candles = resp.data;
  if (!Array.isArray(candles) || candles.length === 0) {
    return { ok: false, _status: 404, error: "no candles", data: { ticker, tf, window: fetchParams } };
  }

  const normalized = normalizeAndSortCandles(candles);
  const lastClose = normalized[normalized.length - 1]?.close;
  const baseResult = buildZones(normalized, { lookbackBars, ...zoneOpts });
  if (!baseResult.ok || !baseResult.zones.length) {
    return {
      ok: false,
      _status: 422,
      error: baseResult.error || "support not available",
      data: { ticker, tf, window: fetchParams },
    };
  }

  const mkParams = (days, timeframe) => {
    const e = new Date();
    const s = subDays(e, days);
    const p = { symbol: ticker, startDate: s.toISOString(), endDate: e.toISOString(), tf: timeframe };
    if (exchange) p.exchange = exchange;
    return p;
  };

  // --- Confirm timeframe ---
  let confirm = null;
  if (enableConfirm) {
    try {
      const r = await fetchAndAnalyze(
        cachemanagerUrl, mkParams(confirmLookbackDays, confirmTf),
        cacheManagerTimeoutMs, { ...zoneOpts, lookbackBars: confirmLookbackBars }
      );
      if (r) {
        confirm = {
          timeframe: confirmTf, lookbackDays: confirmLookbackDays,
          lookbackBars: r.sliceSize, atr20: r.atrValue ?? null,
          zones: r.zones || [], eps: r.eps ?? null,
        };
      }
    } catch (err) {
      logger?.warning?.(`[decision-engine] confirm fetch failed: ${err?.message || String(err)}`);
    }
  }

  // --- Recent timeframe ---
  let recent = null;
  let recentLastClose = null;
  try {
    const recentP = mkParams(recentLookbackDays, recentTf);
    const r = await fetchAndAnalyze(
      cachemanagerUrl, recentP, cacheManagerTimeoutMs, { ...zoneOpts, lookbackBars: recentLookbackBars }
    );
    if (r) {
      recentLastClose = r.lastClose;
      recent = {
        timeframe: recentTf, lookbackDays: recentLookbackDays, lookbackBars: r.sliceSize,
        atr20: r.atrValue ?? null, zones: r.zones || [], eps: r.eps ?? null,
        stats: { rawCandles: r.rawCount, filteredCandles: r.filteredCount },
        window: { startDate: recentP.startDate, endDate: recentP.endDate },
      };
    }
  } catch (err) {
    logger?.warning?.(`[decision-engine] recent fetch failed: ${err?.message || String(err)}`);
  }

  // --- Intraday timeframe ---
  let intraday = null;
  let intradayLastClose = null;
  try {
    const intradayP = mkParams(intradayLookbackDays, intradayTf);
    const r = await fetchAndAnalyze(
      cachemanagerUrl, intradayP, cacheManagerTimeoutMs, { ...zoneOpts, lookbackBars: intradayLookbackBars }
    );
    if (r) {
      intradayLastClose = r.lastClose;
      intraday = {
        timeframe: intradayTf, lookbackDays: intradayLookbackDays, lookbackBars: r.sliceSize,
        atr20: r.atrValue ?? null, zones: r.zones || [], eps: r.eps ?? null,
        window: { startDate: intradayP.startDate, endDate: intradayP.endDate },
      };
    }
  } catch (err) {
    logger?.warning?.(`[decision-engine] intraday fetch failed: ${err?.message || String(err)}`);
  }

  // --- Signal timeframe ---
  let signal = null;
  let signalCandles = null;
  let signalLastClose = null;
  try {
    const signalP = mkParams(signalLookbackDays, signalTf);
    const r = await fetchAndAnalyze(
      cachemanagerUrl, signalP, cacheManagerTimeoutMs, { ...zoneOpts, lookbackBars: signalLookbackBars }
    );
    if (r) {
      signalCandles = r.candles;
      signalLastClose = r.lastClose;
      signal = {
        timeframe: signalTf, lookbackDays: signalLookbackDays, lookbackBars: r.sliceSize,
        atr20: r.atrValue ?? null, zones: r.zones || [],
        stats: { rawCandles: r.rawCount, filteredCandles: r.filteredCount },
        window: { startDate: signalP.startDate, endDate: signalP.endDate },
      };
    }
  } catch (err) {
    logger?.warning?.(`[decision-engine] signal fetch failed: ${err?.message || String(err)}`);
  }

  // --- Price ref ---
  const priceRef =
    Number.isFinite(currentPrice) ? currentPrice
    : Number.isFinite(intradayLastClose) ? intradayLastClose
    : lastClose;

  // --- Merge zones ---
  const zonePriority = { intraday: 3, recent: 2, base: 1 };
  const mergedZones = [
    ...(baseResult.zones || []).map((z) => ({ ...z, source: "base" })),
    ...(recent?.zones || []).map((z) => ({ ...z, source: "recent" })),
    ...(intraday?.zones || []).map((z) => ({ ...z, source: "intraday" })),
  ]
    .map((z) => ({
      ...z,
      structType: z.structType ?? z.type,
      relativeType: Number.isFinite(priceRef)
        ? z.midPrice < priceRef ? "SUPPORT" : "RESISTANCE"
        : z.structType ?? z.type,
      sourcePriority: zonePriority[z.source] ?? 0,
    }))
    .sort(
      (a, b) =>
        (b.sourcePriority - a.sourcePriority) ||
        (a.recencyBars - b.recencyBars) ||
        (b.score - a.score)
    );

  const supports = mergedZones.filter(
    (z) => z.relativeType === "SUPPORT" && Number.isFinite(priceRef) && z.midPrice <= priceRef
  );
  const resistances = mergedZones.filter(
    (z) => z.relativeType === "RESISTANCE" && Number.isFinite(priceRef) && z.midPrice >= priceRef
  );

  // --- Signal pattern ---
  const signalPattern =
    signalCandles && signalCandles.length
      ? detectTrendFlagBreakout(signalCandles, {
          atrPeriod, swingWindow: 3, mergedResistances: resistances, flagAtrK, flagPctK, volMult,
        })
      : null;

  const actionableBreakout = !!signalPattern && signalPattern.trendOk && signalPattern.flagOk && signalPattern.breakoutOk;
  const actionablePullback = !!signalPattern && signalPattern.trendOk && signalPattern.flagOk && signalPattern.pullbackOk;
  const breakoutReason = !signalPattern ? "pattern not available"
    : !signalPattern.trendOk ? "trend not confirmed"
    : !signalPattern.flagOk ? "flag not confirmed"
    : "breakout not confirmed by close+volume";
  const pullbackReason = !signalPattern ? "pattern not available"
    : !signalPattern.trendOk ? "trend not confirmed"
    : !signalPattern.flagOk ? "flag not confirmed"
    : "pullback not confirmed";

  // --- Entry levels ---
  const atrForTrading = [signal?.atr20, recent?.atr20, baseResult.atrValue].find((v) => Number.isFinite(v)) ?? 0;
  const atrSource = Number.isFinite(signal?.atr20) ? "signal" : Number.isFinite(recent?.atr20) ? "recent" : "base";
  const atrSourceTf = atrSource === "signal" ? signalTf : atrSource === "recent" ? recentTf : tf;
  const supportsWithinAtr =
    Number.isFinite(atrForTrading) && atrForTrading > 0
      ? supports.filter((z) => Number.isFinite(z.midPrice) && (priceRef - z.midPrice) / atrForTrading <= maxLevelDistanceAtr)
      : [];
  const supportZone =
    supportsWithinAtr.length > 0
      ? pickClosestByDistance(supportsWithinAtr, (z) => (priceRef - z.midPrice) / (atrForTrading || 1))
      : pickCandidate(supports, (z) => -z.midPrice);
  const resistanceZone = pickCandidate(resistances, (z) => z.midPrice);
  const higherScoreSupportWithinAtr =
    supportsWithinAtr.length > 0 && supportZone &&
    supportsWithinAtr.some((z) => Number.isFinite(z.score) && z.score > (supportZone.score || 0));
  const entryLevels = computeEntryLevels(supportZone, resistanceZone, resistances, atrForTrading, {
    zoneFillK, breakoutK, structuralK, volatilityK, tpAtrK,
  });
  if (entryLevels?.breakout) {
    entryLevels.breakout.actionable = actionableBreakout;
    entryLevels.breakout.reason = actionableBreakout ? null : breakoutReason;
  }
  if (entryLevels?.retracement) {
    entryLevels.retracement.actionable = actionablePullback;
    entryLevels.retracement.reason = actionablePullback ? null : pullbackReason;
  }
  entryLevels.actionableBreakout = actionableBreakout;
  entryLevels.actionablePullback = actionablePullback;

  // --- Guardrails ---
  const applyGuardrails = (level) => {
    if (!level) return;
    const stopDistance = level.entryLimit - level.stopLoss;
    const tp2Distance = Number.isFinite(level.takeProfit2) ? level.takeProfit2 - level.entryLimit : null;
    const minStopDistance = minStopAtrK * atrForTrading;
    const minTp2Distance = minTp2AtrK * atrForTrading;
    level.rule = { ...level.rule, minStopAtrK, minTp2AtrK, minStopDistance, minTp2Distance, stopDistance, tp2Distance };
    if (Number.isFinite(stopDistance) && stopDistance < minStopDistance) {
      level.actionable = false;
      level.reason = level.reason || "stop too tight vs ATR";
    }
    if (Number.isFinite(tp2Distance) && tp2Distance < minTp2Distance) {
      level.actionable = false;
      level.reason = level.reason || "tp2 too tight vs ATR";
    }
  };
  applyGuardrails(entryLevels.retracement);
  applyGuardrails(entryLevels.breakout);

  // --- Debug helpers ---
  const formatZoneDebug = (zone) => {
    if (!zone) return null;
    const timeframe = zone.source === "recent" ? recentTf : zone.source === "intraday" ? intradayTf : tf;
    return {
      midPrice: zone.midPrice, low: zone.low, high: zone.high, width: zone.width,
      score: zone.score, touches: zone.touches, recencyBars: zone.recencyBars,
      source: zone.source, timeframe,
    };
  };
  const supportsTop5 = supports.slice(0, 5).map(formatZoneDebug).filter(Boolean);
  const resistancesTop5 = resistances.slice(0, 5).map(formatZoneDebug).filter(Boolean);
  const selectedSupport = formatZoneDebug(supportZone);
  const selectedResistance = formatZoneDebug(resistanceZone);
  const distanceToSupport =
    Number.isFinite(priceRef) && Number.isFinite(supportZone?.midPrice) ? priceRef - supportZone.midPrice : null;
  const distancePct =
    Number.isFinite(priceRef) && Number.isFinite(distanceToSupport) && priceRef !== 0 ? distanceToSupport / priceRef : null;
  const distanceAtr =
    Number.isFinite(atrForTrading) && Number.isFinite(distanceToSupport) && atrForTrading !== 0 ? distanceToSupport / atrForTrading : null;
  const resistanceAbove = resistances.filter((z) => Number.isFinite(priceRef) && z.midPrice > priceRef);
  const resistanceDebugTop = resistanceAbove.slice(0, 5).map((z) => ({
    midPrice: z.midPrice, source: z.source, score: z.score,
  }));

  return {
    ok: true,
    ticker,
    timeframe: tf,
    lookbackDays,
    lookbackBars: baseResult.sliceSize,
    window: { startDate: fetchParams.startDate, endDate: fetchParams.endDate },
    atr20: baseResult.atrValue,
    zones: baseResult.zones,
    eps: baseResult.eps,
    mergedZones,
    levels: entryLevels,
    levelsDebug: { atrForTrading, minStopAtrK, minTp2AtrK },
    priceRef,
    priceDebug: {
      priceRef, dailyLastClose: lastClose, recentLastClose, signalLastClose,
      providerSymbol: fetchParams.symbol,
    },
    selectionDebug: {
      usedAtrForTrading: { value: atrForTrading, source: atrSource, timeframe: atrSourceTf },
      usedTimeframeForLevels: atrSource,
      maxLevelDistanceAtr,
      supportsWithinAtrCount: supportsWithinAtr.length,
      supportHigherScoreWithinAtr: higherScoreSupportWithinAtr,
      supportsTop5,
      resistancesTop5,
      selectedSupport,
      selectedResistance,
      distancePct,
      distanceAtr,
    },
    atrDebug: {
      avgHL: signalPattern?.debug?.avgHL ?? null,
      medianHL: signalPattern?.debug?.medianHL ?? null,
      minHL: signalPattern?.debug?.minHL ?? null,
      maxHL: signalPattern?.debug?.maxHL ?? null,
      avgTR: signalPattern?.debug?.avgTR ?? null,
      atrLast: signalPattern?.debug?.atrLast ?? null,
      atrTail: signalPattern?.debug?.atrTail ?? [],
    },
    resistanceDebug: {
      countResistancesAbovePrice: resistanceAbove.length,
      top5: resistanceDebugTop,
    },
    confirm,
    recent,
    intraday,
    signal: signal ? { ...signal, pattern: signalPattern } : null,
    actionableBreakout,
    actionablePullback,
    params: {
      swingWindow, atrPeriod, clusterMultiplier, reactionLookahead,
      minTouches, minScore, minRecentBars, recencyRecent, recencyMid,
      weightRecent, weightMid, weightOld, zoneFillK, breakoutK,
      structuralK, volatilityK, tpAtrK, flagAtrK, flagPctK, volMult,
      minStopAtrK, minTp2AtrK, recentLookbackDays, recentLookbackBars,
      recentTf, intradayLookbackDays, intradayLookbackBars, intradayTf,
      signalLookbackDays, signalLookbackBars, signalTf, exchange,
    },
  };
}

module.exports = { runSpotFinderAnalysis };
