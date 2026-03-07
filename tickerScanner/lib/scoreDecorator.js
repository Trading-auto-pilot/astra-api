"use strict";

const { WEIGHT_GROUPS, weightSlice } = require("./weightsConfig");

const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));

const clamp01 = (x) => {
  if (x == null || Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
};

const weightedSum = (pairs = []) => {
  let num = 0;
  let den = 0;
  for (const [val, w] of pairs) {
    if (val == null || w == null) continue;
    num += Number(val) * Number(w);
    den += Number(w);
  }
  return den ? num / den : null;
};

const percentileRank = (values, v) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = sorted.findIndex((x) => x > v);
  const rank = idx === -1 ? sorted.length : idx;
  return rank / sorted.length;
};

const stepDebtEquityScore = (de) => {
  if (de == null) return null;
  const v = Number(de);
  if (!Number.isFinite(v)) return null;
  if (v <= 0.5) return 1;
  if (v <= 1) return 0.8;
  if (v <= 2) return 0.5;
  if (v <= 4) return 0.3;
  return 0.1;
};

const computeVolumeScore = (momentumObj, weights) => {
  const vol = momentumObj?.components?.volume;
  const comps = vol?.components;
  if (!comps) return vol?.score ?? null;
  const vals = [comps.volSpikeScore, comps.directionalVolume, comps.efficiencyScore, comps.rangeScore];
  const ws = weightSlice(weights, WEIGHT_GROUPS.volume);
  let num = 0;
  let den = 0;
  vals.forEach((v, idx) => {
    if (v != null) { num += clamp01(v) * ws[idx]; den += ws[idx]; }
  });
  if (!den) return vol?.score ?? null;
  return Math.round(clamp01(num / den) * 100);
};

const computeMarketRiskScore = (momentumObj, weights) => {
  const comps = momentumObj?.components?.marketRisk?.components;
  if (!comps) return momentumObj?.components?.marketRisk?.score ?? null;
  const vals = [comps.volSafe, comps.ddSafe, comps.gapSafe, comps.trendSafe];
  const ws = weightSlice(weights, WEIGHT_GROUPS.marketRisk);
  let num = 0;
  let den = 0;
  vals.forEach((v, idx) => {
    if (v != null) { num += clamp01(v) * ws[idx]; den += ws[idx]; }
  });
  if (!den) return momentumObj?.components?.marketRisk?.score ?? null;
  return Math.round(clamp01(num / den) * 100);
};

const computeMomentumShortScore = (momentumObj, weights) => {
  const comps = momentumObj?.components?.momentumShort?.components;
  if (!comps) return momentumObj?.components?.momentumShort?.score ?? null;
  const vals = [comps.retScore, comps.trendScoreNorm, comps.structureScoreNorm, comps.rsiScore];
  const ws = weightSlice(weights, WEIGHT_GROUPS.momentumShort);
  let num = 0;
  let den = 0;
  vals.forEach((v, idx) => {
    if (v != null) { num += clamp01(v) * ws[idx]; den += ws[idx]; }
  });
  if (!den) return momentumObj?.components?.momentumShort?.score ?? null;
  return Math.round(clamp01(num / den) * 100);
};

const computeMomentumLongScore = (momentumObj, weights) => {
  const comps = momentumObj?.components;
  if (!comps) return momentumObj?.score ?? null;
  const vals = [comps.mom12mScore, comps.mom6mScore, comps.mom3mScore, comps.mom1mScore, comps.trendScore];
  const ws = weightSlice(weights, WEIGHT_GROUPS.momentumLong);
  let num = 0;
  let den = 0;
  vals.forEach((v, idx) => {
    if (v != null) { num += (v / 100) * ws[idx]; den += ws[idx]; }
  });
  if (!den) return momentumObj?.score ?? null;
  return Math.round(clamp01(num / den) * 100);
};

const normalizeShortRisk = (row, momentumObj, weights) => {
  const marketScore = momentumObj?.components?.marketScore?.score ?? row?.market_score ?? null;
  const marketRiskScore =
    computeMarketRiskScore(momentumObj, weights) ??
    momentumObj?.components?.marketRisk?.score ??
    row?.market_risk_score ??
    null;
  const structuralRisk = row?.risk_score ?? null;
  const ws = weightSlice(weights, WEIGHT_GROUPS.short);
  const wStruct = ws[0] ?? 0.6;
  const wMarket = ws[1] ?? 0.4;
  const shortRisk =
    structuralRisk != null || marketRiskScore != null
      ? (structuralRisk ?? 0) * wStruct + (marketRiskScore ?? 0) * wMarket
      : null;
  return { marketScore, marketRiskScore, shortRiskScore: shortRisk };
};

const computeGrowthProbability = (row, momentumObj, weights) => {
  const momentumScore =
    computeMomentumLongScore(momentumObj, weights) ?? safeNum(momentumObj?.score ?? row?.momentum_score);
  const volumeScore = computeVolumeScore(momentumObj, weights);
  const riskScore = safeNum(row?.risk_score);
  const marketScore = safeNum(momentumObj?.components?.marketScore?.score ?? row?.market_score);
  const ws = weightSlice(weights, WEIGHT_GROUPS.growth);
  const parts = [
    { w: ws[0], v: momentumScore },
    { w: ws[1], v: volumeScore },
    { w: ws[2], v: riskScore },
    { w: ws[3], v: marketScore },
  ].filter((p) => p.v !== null && p.v !== undefined);
  if (!parts.length) return null;
  const totalW = parts.reduce((s, p) => s + p.w, 0);
  if (!totalW) return null;
  return Math.round(parts.reduce((s, p) => s + p.v * p.w, 0) / totalW);
};

const decorate = (row, weights) => {
  if (!row) return row;
  let momentumObj = null;
  try {
    if (row.momentum_json) {
      momentumObj = typeof row.momentum_json === "string" ? JSON.parse(row.momentum_json) : row.momentum_json;
    }
  } catch { momentumObj = null; }
  const marketRiskScore = computeMarketRiskScore(momentumObj, weights);
  const volumeScore = computeVolumeScore(momentumObj, weights);
  const momentumShortScore = computeMomentumShortScore(momentumObj, weights);
  const momentumLongScore =
    computeMomentumLongScore(momentumObj, weights) ?? safeNum(momentumObj?.score ?? row?.momentum_score);
  const { marketScore, shortRiskScore } = normalizeShortRisk(row, momentumObj, weights);
  const growthProbability = computeGrowthProbability(
    { ...row, momentum_score: momentumLongScore },
    momentumObj,
    weights
  );
  return {
    ...row,
    market_score: marketScore ?? row.market_score ?? null,
    market_risk_score: marketRiskScore ?? row.market_risk_score ?? null,
    short_risk_score: shortRiskScore ?? row.short_risk_score ?? null,
    growth_probability: growthProbability ?? row.growth_probability ?? null,
    volume_score: volumeScore ?? row.momentum_volume_score ?? null,
    momentum_score: momentumLongScore ?? row.momentum_score ?? null,
    momentum_short_score: momentumShortScore ?? row.momentum_short_score ?? null,
  };
};

module.exports = {
  safeNum,
  clamp,
  clamp01,
  weightedSum,
  percentileRank,
  stepDebtEquityScore,
  computeVolumeScore,
  computeMarketRiskScore,
  computeMomentumShortScore,
  computeMomentumLongScore,
  normalizeShortRisk,
  computeGrowthProbability,
  decorate,
};
