"use strict";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(x, x1, y1, x2, y2) {
  if (x2 === x1) return y2;
  const t = (x - x1) / (x2 - x1);
  return y1 + t * (y2 - y1);
}

function normalizeVix(raw) {
  const vix = Number(raw);
  if (!Number.isFinite(vix)) {
    return { normalized: null, note: "VIX raw value is invalid" };
  }

  const points = [
    { x: 10, y: 100 },
    { x: 12, y: 98 },
    { x: 15, y: 82 },
    { x: 20, y: 60 },
    { x: 25, y: 40 },
    { x: 35, y: 20 },
    { x: 45, y: 8 },
    { x: 55, y: 0 },
  ];

  if (vix <= points[0].x) return { normalized: 100 };
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    if (vix <= curr.x) {
      return {
        normalized: clamp(lerp(vix, prev.x, prev.y, curr.x, curr.y), 0, 100),
      };
    }
  }

  return { normalized: 0 };
}

module.exports = {
  normalizeVix,
};

