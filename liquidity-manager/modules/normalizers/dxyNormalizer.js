"use strict";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((acc, n) => acc + n, 0) / arr.length;
}

function stdev(arr, mean) {
  if (arr.length < 2) return null;
  const variance = arr.reduce((acc, n) => acc + (n - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function normalizeDxy(series) {
  const data = Array.isArray(series) ? series : [];
  const values = data
    .map((it) => Number(it?.value))
    .filter((v) => Number.isFinite(v));

  if (values.length < 60) {
    return { normalized: null, note: "Insufficient DXY history (<60)" };
  }

  const latest = values[values.length - 1];
  const window = values.slice(-60);
  const mean = avg(window);
  const sd = stdev(window, mean);
  if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd === 0) {
    return { normalized: null, note: "Unable to compute DXY z-score" };
  }

  const z = (latest - mean) / sd;
  const score = clamp(60 - z * 20, 0, 100);
  return {
    normalized: score,
    details: {
      latest: Number(latest.toFixed(4)),
      mean60: Number(mean.toFixed(4)),
      zScore60: Number(z.toFixed(4)),
    },
  };
}

module.exports = {
  normalizeDxy,
};

