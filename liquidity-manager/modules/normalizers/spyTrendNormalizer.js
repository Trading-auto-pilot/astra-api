"use strict";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sma(values, period, endIdxInclusive) {
  const end = endIdxInclusive;
  const start = end - period + 1;
  if (start < 0) return null;
  let sum = 0;
  for (let i = start; i <= end; i += 1) {
    sum += values[i];
  }
  return sum / period;
}

function normalizeSpyTrend(series) {
  const data = Array.isArray(series) ? series : [];
  const closes = data
    .map((it) => Number(it?.value))
    .filter((v) => Number.isFinite(v));

  if (closes.length < 210) {
    return {
      normalized: null,
      note: "Insufficient SPY history for SMA(50)/SMA(200)",
    };
  }

  const idx = closes.length - 1;
  const close = closes[idx];
  const sma50 = sma(closes, 50, idx);
  const sma200 = sma(closes, 200, idx);
  const sma50Prev5 = sma(closes, 50, idx - 5);

  if (![close, sma50, sma200, sma50Prev5].every(Number.isFinite)) {
    return { normalized: null, note: "Unable to compute SPY trend metrics" };
  }

  const slope = sma50 - sma50Prev5;
  let score = 50;

  if (close > sma50) score += 12;
  else score -= 15;

  if (sma50 > sma200) score += 18;
  else score -= 20;

  if (close > sma200) score += 12;
  else score -= 20;

  if (slope > 0) score += 10;
  else score -= 8;

  const pctAbove200 = ((close - sma200) / sma200) * 100;
  if (pctAbove200 > 5) score += 6;
  if (pctAbove200 < -5) score -= 6;

  return {
    normalized: clamp(score, 0, 100),
    details: {
      close: Number(close.toFixed(4)),
      sma50: Number(sma50.toFixed(4)),
      sma200: Number(sma200.toFixed(4)),
      slope50_5d: Number(slope.toFixed(6)),
    },
  };
}

module.exports = {
  normalizeSpyTrend,
};

