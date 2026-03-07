"use strict";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeCreditSpread(raw) {
  const spread = Number(raw);
  if (!Number.isFinite(spread)) {
    return { normalized: null, note: "Credit spread raw value invalid" };
  }

  // Typical HY OAS interpretation (percent points):
  // <=3 very benign, 4-5 moderate, 6-8 stressed, >=10 severe.
  if (spread <= 3) return { normalized: 90 };
  if (spread <= 4) return { normalized: 75 };
  if (spread <= 5) return { normalized: 60 };
  if (spread <= 6.5) return { normalized: 45 };
  if (spread <= 8) return { normalized: 30 };
  if (spread <= 10) return { normalized: 18 };
  return { normalized: clamp(10 - (spread - 10) * 2, 0, 10) };
}

module.exports = {
  normalizeCreditSpread,
};

