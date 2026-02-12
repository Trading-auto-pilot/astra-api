"use strict";

// ---------------------------------------------------------------------------
// indicators – funzioni matematiche pure per analisi tecnica
// Zero dipendenze esterne.
// ---------------------------------------------------------------------------

const atr = (candles, n) => {
  const tr = Array(candles.length).fill(null);
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(pc)) {
      tr[i] = null;
      continue;
    }
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

const sma = (values, period) => {
  const out = Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - period + 1);
    const slice = values.slice(start, i + 1).filter((v) => Number.isFinite(v));
    out[i] = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  }
  return out;
};

const ema = (values, period) => {
  const out = Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      out[i] = prev;
      continue;
    }
    if (prev == null) {
      prev = v;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
};

const linearRegressionSlope = (values) => {
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = values[i];
    if (!Number.isFinite(y)) return 0;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
};

const findSwings = (candles, window) => {
  const swings = [];
  const L = window;
  const R = window;
  for (let i = L; i < candles.length - R; i++) {
    const hi = candles[i].high;
    const lo = candles[i].low;
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) continue;

    let isHigh = true;
    for (let k = i - L; k <= i + R; k++) {
      if (k === i) continue;
      const chk = candles[k].high;
      if (Number.isFinite(chk) && chk >= hi) {
        isHigh = false;
        break;
      }
    }

    let isLow = true;
    for (let k = i - L; k <= i + R; k++) {
      if (k === i) continue;
      const chk = candles[k].low;
      if (Number.isFinite(chk) && chk <= lo) {
        isLow = false;
        break;
      }
    }

    const ts = candles[i].t || null;
    if (isHigh) swings.push({ index: i, price: hi, type: "HIGH", timestamp: ts });
    if (isLow) swings.push({ index: i, price: lo, type: "LOW", timestamp: ts });
  }
  return swings;
};

const clusterByPrice = (points, eps) => {
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const p of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(p.price - last.mean) > eps) {
      clusters.push({ points: [p], mean: p.price });
    } else {
      last.points.push(p);
      last.mean = last.points.reduce((s, x) => s + x.price, 0) / last.points.length;
    }
  }
  return clusters;
};

const recencyWeight = (barsAgo, recentBars, midBars, wRecent, wMid, wOld) => {
  if (barsAgo < recentBars) return wRecent;
  if (barsAgo <= midBars) return wMid;
  return wOld;
};

const calcReaction = (candles, index, price, lookahead, atrSeries) => {
  const end = Math.min(candles.length - 1, index + lookahead);
  let maxMove = 0;
  for (let j = index + 1; j <= end; j++) {
    const close = candles[j].close;
    if (!Number.isFinite(close)) continue;
    const move = Math.abs(close - price);
    if (move > maxMove) maxMove = move;
  }
  const atrValue = atrSeries[index] ?? atrSeries[atrSeries.length - 1] ?? 0;
  return atrValue ? maxMove / atrValue : 0;
};

const pickCandidate = (items, selector) => {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    if (a.touches !== b.touches) {
      return b.touches - a.touches;
    }
    if (a.recencyBars !== b.recencyBars) {
      return a.recencyBars - b.recencyBars;
    }
    return selector(a) - selector(b);
  });
  return sorted[0] || null;
};

const pickClosestByDistance = (items, distanceFn) => {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => {
    const distA = distanceFn(a);
    const distB = distanceFn(b);
    if (distA !== distB) return distA - distB;
    if (a.recencyBars !== b.recencyBars) return a.recencyBars - b.recencyBars;
    if (a.score !== b.score) return b.score - a.score;
    return b.touches - a.touches;
  });
  return sorted[0] || null;
};

module.exports = {
  atr,
  sma,
  ema,
  linearRegressionSlope,
  findSwings,
  clusterByPrice,
  recencyWeight,
  calcReaction,
  pickCandidate,
  pickClosestByDistance,
};
