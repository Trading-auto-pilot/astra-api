"use strict";

// ---------------------------------------------------------------------------
// zones – buildZones, detectTrendFlagBreakout, computeEntryLevels
// ---------------------------------------------------------------------------

const {
  DEFAULT_TRAILING_ATR_K,
  PRICE_EPS_FACTOR,
  MIN_EPS,
  MIN_CANDLES_FOR_PATTERN,
} = require("./constants");

const {
  atr,
  sma,
  ema,
  linearRegressionSlope,
  findSwings,
  clusterByPrice,
  recencyWeight,
  calcReaction,
  pickCandidate,
} = require("./indicators");

// ---------------------------------------------------------------------------
// detectTrendFlagBreakout
// ---------------------------------------------------------------------------
const detectTrendFlagBreakout = (candles, options = {}) => {
  const {
    atrPeriod,
    swingWindow = 3,
    trendBars = 12,
    trendMinAbove = 8,
    pivotLookback = 60,
    impulseBars = 80,
    flagBars = 20,
    breakoutLookback = 20,
    mergedResistances = [],
    flagAtrK = 1.3,
    flagPctK = 0.0025,
    volMult = 1.2,
  } = options;

  if (!Array.isArray(candles) || candles.length < Math.max(MIN_CANDLES_FOR_PATTERN, flagBars + 5)) {
    return {
      trendOk: false,
      flagOk: false,
      breakoutOk: false,
      pullbackOk: false,
      breakLevel: null,
      flagHigh: null,
      flagLow: null,
      entryBreakout: null,
      entryPullback: null,
      stopLoss: null,
      targets: { tp1: null, tp2: null, trailingAtrK: DEFAULT_TRAILING_ATR_K },
      confidence: 0,
      debug: { reason: "not enough candles" },
    };
  }

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const atrSeries = atr(candles, atrPeriod);
  const lastIdx = candles.length - 1;
  const atrLast =
    atrSeries[lastIdx] ?? atrSeries.slice().reverse().find((v) => Number.isFinite(v)) ?? 0;
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const lastClose = closes[lastIdx];
  const lastVol = volumes[lastIdx];
  const prevVol1 = lastIdx > 0 ? volumes[lastIdx - 1] : null;
  const prevVol2 = lastIdx > 1 ? volumes[lastIdx - 2] : null;
  const volMa20 = sma(volumes, 20)[lastIdx];
  const priceLast = Number.isFinite(lastClose) ? lastClose : 0;
  const eps = Math.max(MIN_EPS, priceLast * PRICE_EPS_FACTOR);

  const lastN = Math.min(trendBars, candles.length);
  let aboveEma20Count = 0;
  let consideredBars = 0;
  for (let i = candles.length - lastN; i <= lastIdx; i++) {
    const emaVal = ema20[i];
    const closeVal = closes[i];
    if (!Number.isFinite(emaVal) || !Number.isFinite(closeVal)) continue;
    consideredBars += 1;
    if (closeVal >= emaVal - eps) aboveEma20Count += 1;
  }

  let trendOk = false;
  let trendReason = null;
  if (!Number.isFinite(ema20[lastIdx]) || !Number.isFinite(ema50[lastIdx])) {
    trendReason = "ema not available";
  } else if (ema20[lastIdx] <= ema50[lastIdx]) {
    trendReason = "ema20 below ema50";
  } else if (consideredBars < trendMinAbove) {
    trendReason = "insufficient ema bars";
  } else if (aboveEma20Count < trendMinAbove) {
    trendReason = "close not above ema20";
  } else {
    trendOk = true;
  }

  let hhhlOk = true;
  const swings = findSwings(candles, swingWindow);
  const recentSwings = swings.filter((s) => s.index >= candles.length - pivotLookback);
  const highs = recentSwings.filter((s) => s.type === "HIGH");
  const lows = recentSwings.filter((s) => s.type === "LOW");
  const countHigher = (arr) => {
    let count = 0;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].price > arr[i - 1].price) count += 1;
    }
    return count;
  };
  if (highs.length >= 2 && lows.length >= 2) {
    hhhlOk = countHigher(highs) >= 2 && countHigher(lows) >= 2;
  }

  const impulseSlice = candles.slice(-impulseBars);
  const flagSlice = candles.slice(-flagBars);
  const impulseForVol = impulseSlice.slice(0, Math.max(1, impulseSlice.length - flagBars));
  const flagHigh = Math.max(...flagSlice.map((c) => c.high));
  const flagLow = Math.min(...flagSlice.map((c) => c.low));
  const flagRange = flagHigh - flagLow;
  const flagAtrAvg = (() => {
    const atrValues = atrSeries.slice(-flagBars).filter((v) => Number.isFinite(v));
    return atrValues.length ? atrValues.reduce((a, b) => a + b, 0) / atrValues.length : null;
  })();
  const flagSlope = linearRegressionSlope(flagSlice.map((c) => c.close));
  const avgFlagVol = flagSlice.map((c) => c.volume).filter((v) => Number.isFinite(v));
  const avgImpulseVol = impulseForVol.map((c) => c.volume).filter((v) => Number.isFinite(v));
  const avgFlag = avgFlagVol.length ? avgFlagVol.reduce((a, b) => a + b, 0) / avgFlagVol.length : null;
  const avgImpulse = avgImpulseVol.length
    ? avgImpulseVol.reduce((a, b) => a + b, 0) / avgImpulseVol.length
    : null;
  const flagThreshold = Math.max(flagAtrK * atrLast, flagPctK * priceLast);
  const slopeThreshold = Math.max(0.05 * atrLast, 0.0005 * priceLast);

  const flagOk =
    Number.isFinite(flagAtrAvg) &&
    flagRange < flagThreshold &&
    flagSlope >= -slopeThreshold &&
    (avgImpulse == null || avgFlag == null || avgFlag < 0.9 * avgImpulse);

  const breakLevel = flagHigh;
  const safeClose = Number.isFinite(lastClose) ? lastClose : 0;
  const buffer = Math.max(0.1 * atrLast, 0.0005 * safeClose);
  const priceBreakOk = Number.isFinite(lastClose) && lastClose > breakLevel + buffer;
  const volPass =
    Number.isFinite(lastVol) &&
    Number.isFinite(volMa20) &&
    (lastVol >= volMa20 * volMult || lastVol >= volMa20);
  const breakoutOk = priceBreakOk && volPass;

  let breakoutRecent = false;
  let breakoutVol = null;
  const recentWindow = candles.slice(-breakoutLookback);
  recentWindow.forEach((c) => {
    if (c.close > breakLevel + buffer) {
      breakoutRecent = true;
      breakoutVol = Math.max(breakoutVol ?? 0, c.volume ?? 0);
    }
  });

  const pullbackSlice = candles.slice(-3);
  const pullbackAvgVol = pullbackSlice.map((c) => c.volume).filter((v) => Number.isFinite(v));
  const pullbackAvg = pullbackAvgVol.length
    ? pullbackAvgVol.reduce((a, b) => a + b, 0) / pullbackAvgVol.length
    : null;
  const lastBar = candles[lastIdx];
  const pullbackTouch =
    breakoutRecent && lastBar.low <= breakLevel + buffer && lastBar.close > breakLevel;
  const pullbackOk =
    pullbackTouch && (breakoutVol == null || pullbackAvg == null || pullbackAvg <= breakoutVol);

  const lastPivotLow = lows.length ? lows[lows.length - 1].price : null;
  const stopBase = Math.min(
    Number.isFinite(flagLow) ? flagLow : Number.POSITIVE_INFINITY,
    Number.isFinite(lastPivotLow) ? lastPivotLow : Number.POSITIVE_INFINITY
  );
  const stopLoss = Number.isFinite(stopBase) ? stopBase - 0.2 * atrLast : null;

  const entryBreakout = Number.isFinite(breakLevel) ? breakLevel + buffer : null;
  const entryPullback = Number.isFinite(breakLevel) ? breakLevel + buffer : null;
  const entryForTarget = entryBreakout || entryPullback;
  const nextRes = mergedResistances.find((z) => z.midPrice > (entryForTarget ?? 0));
  const tp1 = nextRes ? nextRes.midPrice : entryForTarget ? entryForTarget + 2 * atrLast : null;
  const tp2 = entryForTarget ? entryForTarget + 5 * atrLast : null;

  const trendOkFinal = trendOk && hhhlOk;
  if (trendOk && !hhhlOk && !trendReason) {
    trendReason = "hhhl not confirmed";
  }

  const confidence = Math.min(
    100,
    Math.round(
      (trendOk ? 30 : 0) +
        (flagOk ? 25 : 0) +
        (breakoutOk ? 25 : 0) +
        (pullbackOk ? 20 : 0)
    )
  );

  const hlWindow = candles.slice(-200);
  const hlValues = hlWindow
    .map((c) => c.high - c.low)
    .filter((v) => Number.isFinite(v));
  const sortedHL = [...hlValues].sort((a, b) => a - b);
  const avgHL = hlValues.length
    ? hlValues.reduce((sum, v) => sum + v, 0) / hlValues.length
    : null;
  const medianHL = sortedHL.length
    ? sortedHL[Math.floor(sortedHL.length / 2)]
    : null;
  const minHL = sortedHL.length ? sortedHL[0] : null;
  const maxHL = sortedHL.length ? sortedHL[sortedHL.length - 1] : null;
  const trWindow = atrSeries.slice(-200).filter((v) => Number.isFinite(v));
  const avgTR = trWindow.length ? trWindow.reduce((a, b) => a + b, 0) / trWindow.length : null;
  const atrTail = atrSeries
    .slice(-5)
    .filter((v) => Number.isFinite(v));
  const emaSpreadPct = Number.isFinite(ema50[lastIdx]) && ema50[lastIdx] !== 0
    ? (ema20[lastIdx] - ema50[lastIdx]) / ema50[lastIdx]
    : null;
  const last12Start = Math.max(0, lastIdx - 11);
  const last12 = [];
  for (let i = last12Start; i <= lastIdx; i++) {
    const closeVal = closes[i];
    const emaVal = ema20[i];
    last12.push({
      t: candles[i]?.t ?? null,
      close: Number.isFinite(closeVal) ? closeVal : null,
      ema20: Number.isFinite(emaVal) ? emaVal : null,
      above: Number.isFinite(closeVal) && Number.isFinite(emaVal)
        ? closeVal >= emaVal - eps
        : null,
    });
  }

  const volRef = [lastVol, prevVol1, prevVol2]
    .filter((v) => Number.isFinite(v))
    .reduce((acc, v) => (acc == null ? v : Math.max(acc, v)), null);
  const volumeThreshold = Number.isFinite(volMa20) ? volMa20 * volMult : null;
  const volumeOk =
    Number.isFinite(volumeThreshold) && Number.isFinite(volRef)
      ? volRef >= volumeThreshold
      : false;
  const breakoutEntry = {
    breakLevel,
    buffer,
    entryTriggerPrice: entryBreakout,
    volumeThreshold,
    volumeObserved: volRef,
    volumeOk,
    entrySuggestion: volumeOk ? entryBreakout : null,
    note: volumeOk ? "volume ok for breakout" : "attendi conferma volumi",
  };

  return {
    trendOk: trendOkFinal,
    flagOk,
    breakoutOk,
    pullbackOk,
    isValidBreakoutSetup: trendOkFinal && flagOk && breakoutOk,
    isValidPullbackSetup: trendOkFinal && flagOk && pullbackOk,
    breakLevel,
    flagHigh,
    flagLow,
    entryBreakout,
    entryBreakoutSuggested: breakoutEntry.entrySuggestion,
    entryPullback,
    stopLoss,
    breakoutEntry,
    targets: { tp1, tp2, trailingAtrK: DEFAULT_TRAILING_ATR_K },
    confidence,
    debug: {
      trend: {
        ema20Last: ema20[lastIdx],
        ema50Last: ema50[lastIdx],
        lastClose,
        aboveEma20Count,
        consideredBars,
        emaSpreadPct,
      },
      ema20Last: ema20[lastIdx],
      ema50Last: ema50[lastIdx],
      lastClose,
      aboveEma20Count,
      consideredBars,
      trendReason,
      hhhlOk,
      priceLast,
      flagRange,
      atrLast,
      last12,
      flagThresholdUsed: flagThreshold,
      slope: flagSlope,
      avgVolFlag: avgFlag,
      avgVolImpulse: avgImpulse,
      volLast: lastVol,
      volPrev1: prevVol1,
      volPrev2: prevVol2,
      volRef,
      volMA20: volMa20,
      volMult,
      volumeThreshold,
      volPass,
      buffer,
      avgHL,
      medianHL,
      minHL,
      maxHL,
      avgTR,
      atrTail,
    },
  };
};

// ---------------------------------------------------------------------------
// computeEntryLevels
// ---------------------------------------------------------------------------
const computeEntryLevels = (
  supportZone,
  resistanceZone,
  resistanceZones,
  atrValue,
  {
    zoneFillK = 0.55,
    breakoutK = 0.25,
    structuralK = 0.2,
    volatilityK = 1.2,
    tpAtrK = 5,
  } = {}
) => {
  let retracement = null;
  if (supportZone) {
    const entryLimit = supportZone.low + zoneFillK * supportZone.width;
    const structuralSL = supportZone.low - structuralK * atrValue;
    const volatilitySL = entryLimit - volatilityK * atrValue;
    const stopLoss = Math.min(structuralSL, volatilitySL);
    const takeProfit2 = entryLimit + tpAtrK * atrValue;
    const nextRes = pickCandidate(
      resistanceZones.filter((z) => z.midPrice > entryLimit),
      (z) => z.midPrice
    );
    const takeProfit1 = nextRes ? nextRes.midPrice : null;
    const risk = entryLimit - stopLoss;
    retracement = {
      entryLimit,
      stopLoss,
      takeProfit1,
      takeProfit2,
      risk,
      rule: { zoneFillK, structuralK, volatilityK, tpAtrK },
      supportZone,
      resistanceZone: nextRes,
    };
  }

  let breakout = null;
  if (resistanceZone) {
    const entryLimit = resistanceZone.high + breakoutK * atrValue;
    const structuralSL = resistanceZone.low - structuralK * atrValue;
    const volatilitySL = entryLimit - volatilityK * atrValue;
    const stopLoss = Math.min(structuralSL, volatilitySL);
    const takeProfit2 = entryLimit + tpAtrK * atrValue;
    const nextRes = pickCandidate(
      resistanceZones.filter((z) => z.midPrice > entryLimit),
      (z) => z.midPrice
    );
    const takeProfit1 = nextRes ? nextRes.midPrice : null;
    const risk = entryLimit - stopLoss;
    breakout = {
      entryLimit,
      stopLoss,
      takeProfit1,
      takeProfit2,
      risk,
      rule: { breakoutK, structuralK, volatilityK, tpAtrK },
      resistanceZone,
      nextResistanceZone: nextRes,
    };
  }

  return {
    entryLimit: retracement?.entryLimit ?? null,
    stopLoss: retracement?.stopLoss ?? null,
    takeProfit1: retracement?.takeProfit1 ?? null,
    takeProfit2: retracement?.takeProfit2 ?? null,
    risk: retracement?.risk ?? null,
    rule: retracement?.rule ?? null,
    supportZone: retracement?.supportZone ?? null,
    resistanceZone: retracement?.resistanceZone ?? null,
    retracement,
    breakout,
  };
};

// ---------------------------------------------------------------------------
// buildZones
// ---------------------------------------------------------------------------
const buildZones = (candles, options) => {
  const {
    lookbackBars,
    atrPeriod,
    swingWindow,
    clusterMultiplier,
    reactionLookahead,
    minTouches,
    minScore,
    minRecentBars,
    recencyRecent,
    recencyMid,
    weightRecent,
    weightMid,
    weightOld,
  } = options;

  const slice = candles.length > lookbackBars ? candles.slice(-lookbackBars) : candles;
  const atrSeries = atr(slice, atrPeriod);
  const atrValue = atrSeries[atrSeries.length - 1];
  if (!Number.isFinite(atrValue)) {
    return { ok: false, error: "atr not available", zones: [] };
  }

  const swings = findSwings(slice, swingWindow);
  const lastClose = slice[slice.length - 1]?.close ?? null;
  if (!Number.isFinite(lastClose)) {
    return { ok: false, error: "last close not available", zones: [] };
  }

  const eps = atrValue * clusterMultiplier;
  const clusters = clusterByPrice(swings, eps);
  const zones = clusters
    .map((cluster) => {
      const prices = cluster.points.map((p) => p.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const meanPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      const barsAgoValues = cluster.points.map(
        (p) => (slice.length - 1) - p.index
      );
      const recencyBars = Math.min(...barsAgoValues);
      const score = cluster.points.reduce((sum, p) => {
        const barsAgo = (slice.length - 1) - p.index;
        const timeWeight = recencyWeight(
          barsAgo,
          recencyRecent,
          recencyMid,
          weightRecent,
          weightMid,
          weightOld
        );
        const reactionNorm = calcReaction(
          slice,
          p.index,
          p.price,
          reactionLookahead,
          atrSeries
        );
        return sum + reactionNorm * timeWeight;
      }, 0);

      const structType = meanPrice < lastClose ? "SUPPORT" : "RESISTANCE";
      return {
        type: structType,
        structType,
        midPrice: meanPrice,
        low: minPrice,
        high: maxPrice,
        width: maxPrice - minPrice,
        score,
        touches: cluster.points.length,
        recencyBars,
      };
    })
    .filter((z) => z.touches >= minTouches)
    .filter((z) => z.recencyBars <= minRecentBars)
    .filter((z) => z.score >= minScore)
    .sort((a, b) => (b.score - a.score) || (a.recencyBars - b.recencyBars));

  return { ok: true, atrValue, zones, sliceSize: slice.length, eps };
};

module.exports = {
  buildZones,
  detectTrendFlagBreakout,
  computeEntryLevels,
};
