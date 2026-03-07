"use strict";

// Pesi di default (percentuali 0-100) allineati alla tabella user_score_weights
const DEFAULT_WEIGHTS = {
  wt_growth_momentum: 45,
  wt_growth_volume: 25,
  wt_growth_risk: 15,
  wt_growth_market: 15,
  wt_short_struct: 60,
  wt_short_market: 40,
  wt_ms_trend: 55,
  wt_ms_regime: 35,
  wt_ms_corr_penalty_max: 20,
  wt_mr_vol_safe: 40,
  wt_mr_dd_safe: 30,
  wt_mr_gap_safe: 20,
  wt_mr_trend_safe: 10,
  wt_vol_spike: 40,
  wt_vol_directional: 30,
  wt_vol_efficiency: 20,
  wt_vol_range: 10,
  wt_mom_short_ret: 35,
  wt_mom_short_trend: 30,
  wt_mom_short_structure: 20,
  wt_mom_short_rsi: 15,
  wt_mom_12m: 40,
  wt_mom_6m: 25,
  wt_mom_3m: 20,
  wt_mom_1m: 5,
  wt_mom_trend: 10,
  wt_doubletop_distance: 45,
  wt_doubletop_ma_structure: 35,
  wt_doubletop_long_pressure: 20,
};

const WEIGHT_GROUPS = {
  growth: ["wt_growth_momentum", "wt_growth_volume", "wt_growth_risk", "wt_growth_market"],
  short: ["wt_short_struct", "wt_short_market"],
  marketRisk: ["wt_mr_vol_safe", "wt_mr_dd_safe", "wt_mr_gap_safe", "wt_mr_trend_safe"],
  volume: ["wt_vol_spike", "wt_vol_directional", "wt_vol_efficiency", "wt_vol_range"],
  momentumShort: ["wt_mom_short_ret", "wt_mom_short_trend", "wt_mom_short_structure", "wt_mom_short_rsi"],
  momentumLong: ["wt_mom_12m", "wt_mom_6m", "wt_mom_3m", "wt_mom_1m", "wt_mom_trend"],
};

const FILTER_FIELD_MAP = {
  growth_probability: ["user_grow_score", "grow_score", "growth_probability", "growthProbability", "user_growth_probability"],
  growthProbability: ["user_grow_score", "grow_score", "growth_probability", "growthProbability", "user_growth_probability"],
  growth_momentum: ["growth_momentum", "growthMomentum"],
  growthMomentum: ["growth_momentum", "growthMomentum"],
  growth_risk: ["growth_risk", "growthRisk"],
  growthRisk: ["growth_risk", "growthRisk"],
  growth_market: ["growth_market", "growthMarket"],
  growthMarket: ["growth_market", "growthMarket"],
  mom1m: ["mom_1m", "mom1m", "momentum.components.mom1mScore", "momentum_json.components.mom1mScore"],
  mom_1m: ["mom_1m", "mom1m", "momentum.components.mom1mScore", "momentum_json.components.mom1mScore"],
  mom3m: ["mom_3m", "mom3m", "momentum.components.mom3mScore", "momentum_json.components.mom3mScore"],
  mom_3m: ["mom_3m", "mom3m", "momentum.components.mom3mScore", "momentum_json.components.mom3mScore"],
  mom6m: ["mom_6m", "mom6m", "momentum.components.mom6mScore", "momentum_json.components.mom6mScore"],
  mom_6m: ["mom_6m", "mom6m", "momentum.components.mom6mScore", "momentum_json.components.mom6mScore"],
  mom12m: ["mom_12m", "mom12m", "momentum.components.mom12mScore", "momentum_json.components.mom12mScore"],
  mom_12m: ["mom_12m", "mom12m", "momentum.components.mom12mScore", "momentum_json.components.mom12mScore"],
  double_top_score: ["user_double_top_score", "double_top_score", "momentum.components.doubleTop.score", "momentum_json.components.doubleTop.score"],
  doubletopScore: ["user_double_top_score", "double_top_score", "momentum.components.doubleTop.score", "momentum_json.components.doubleTop.score"],
  momentum_score: ["user_momentum_score", "momentum_score", "momentumScore"],
  momentumScore: ["user_momentum_score", "momentum_score", "momentumScore"],
  momentum_score_short: ["momentum_score_short", "momentum_short_score", "momentumScoreShort"],
  momentumScoreShort: ["momentum_score_short", "momentum_short_score", "momentumScoreShort"],
  risk_score: ["user_risk_score", "risk_score", "riskScore", "short_risk_score"],
  riskScore: ["user_risk_score", "risk_score", "riskScore", "short_risk_score"],
  quality_score: ["user_quality_score", "quality_score", "qualityScore"],
  qualityScore: ["user_quality_score", "quality_score", "qualityScore"],
  valuation_score: ["user_valuation_score", "valuation_score", "valuation_scores", "valuationScore"],
  valuationScore: ["user_valuation_score", "valuation_score", "valuation_scores", "valuationScore"],
  total_score: ["total_score", "score", "totalScore"],
  totalScore: ["total_score", "score", "totalScore"],
  market_risk_score: ["market_risk_score", "marketRiskScore", "user_market_score", "market_score", "momentum_json.components.marketRisk.score", "momentum.components.marketRisk.score"],
  marketRiskScore: ["market_risk_score", "marketRiskScore", "user_market_score", "market_score", "momentum_json.components.marketRisk.score", "momentum.components.marketRisk.score"],
  market_score: ["market_score", "marketScore", "user_market_score", "momentum_json.components.marketRisk.score", "momentum.components.marketRisk.score"],
  marketScore: ["market_score", "marketScore", "user_market_score", "momentum_json.components.marketRisk.score", "momentum.components.marketRisk.score"],
  "Momentum score": ["user_momentum_score", "momentum_score", "momentumScore"],
  "Momentum short score": ["momentum_score_short", "momentum_short_score", "momentumScoreShort"],
  "Quality score": ["user_quality_score", "quality_score", "qualityScore"],
  "Valuation score": ["user_valuation_score", "valuation_score", "valuation_scores", "valuationScore"],
  "Risk score": ["user_risk_score", "risk_score", "riskScore", "short_risk_score"],
  "Total score": ["total_score", "score", "totalScore"],
  "Market risk score": ["market_risk_score", "marketRiskScore", "user_market_score", "market_score", "momentum_json.components.marketRisk.score", "momentum.components.marketRisk.score"],
  "Growth probability": ["user_grow_score", "grow_score", "growth_probability", "growthProbability", "user_growth_probability"],
};

const ORDER_FIELD_MAP = {
  growth_probability: ["user_grow_score", "grow_score", "growth_probability"],
  growthProbability: ["user_grow_score", "grow_score", "growth_probability"],
  momentum_score: ["user_momentum_score", "momentum_score"],
  momentum_score_short: ["momentum_score_short", "momentum_short_score", "momentum_score_short"],
  momentumScoreShort: ["momentum_score_short", "momentum_short_score", "momentum_score_short"],
  risk_score: ["user_risk_score", "risk_score"],
  quality_score: ["user_quality_score", "quality_score"],
  total_score: ["total_score", "score", "totalScore"],
  market_score: ["user_market_score", "market_score", "momentum_json.components.marketRisk.score", "momentum.components.marketRisk.score"],
  mom1mScore: ["user_mom1m_score", "mom_1m", "mom1m", "momentum.components.mom1mScore", "momentum_json.components.mom1mScore"],
  mom3mScore: ["user_mom3m_score", "mom_3m", "mom3m", "momentum.components.mom3mScore", "momentum_json.components.mom3mScore"],
  mom6mScore: ["user_mom6m_score", "mom_6m", "mom6m", "momentum.components.mom6mScore", "momentum_json.components.mom6mScore"],
  mom12mScore: ["user_mom12m_score", "mom_12m", "mom12m", "momentum.components.mom12mScore", "momentum_json.components.mom12mScore"],
  double_top_score: ["user_double_top_score", "double_top_score", "momentum.components.doubleTop.score", "momentum_json.components.doubleTop.score"],
};

const allowedFilterNames = new Set([
  "growthProbability", "growth_probability", "growthMomentum", "growth_momentum",
  "growthRisk", "growth_risk", "growthMarket", "growth_market",
  "mom1m", "mom_1m", "mom3m", "mom_3m", "mom6m", "mom_6m", "mom12m", "mom_12m",
  "doubletopScore", "double_top_score",
  "momentum_score", "momentumScore", "momentum_score_short", "momentumScoreShort",
  "risk_score", "riskScore", "quality_score", "qualityScore",
  "valuation_score", "valuationScore", "total_score", "totalScore",
  "market_risk_score", "marketRiskScore", "market_score", "marketScore",
  "Momentum score", "Momentum short score", "Quality score",
  "Risk score", "Valuation score", "Total score", "Market risk score", "Growth probability",
]);

const normalizeWeights = (raw) => {
  const out = { ...DEFAULT_WEIGHTS };
  if (raw && typeof raw === "object") {
    Object.keys(DEFAULT_WEIGHTS).forEach((k) => {
      const val = Number(raw[k]);
      if (Number.isFinite(val)) {
        out[k] = val <= 1 ? val * 100 : val;
      }
    });
  }
  return out;
};

const weightSlice = (weights, keys) => {
  const vals = keys.map((k) => Number(weights?.[k]) || Number(DEFAULT_WEIGHTS[k]) || 0);
  const sum = vals.reduce((a, b) => a + b, 0) || 1;
  return vals.map((v) => v / sum);
};

/**
 * createFetchUserWeights - returns an async function to fetch user score weights from auth service
 */
function createFetchUserWeights({ axios, authServiceUrl, logger }) {
  const safeStr = (v) => { try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); } };
  return async function fetchUserWeights(authHeader) {
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer")) return DEFAULT_WEIGHTS;
    const url = `${authServiceUrl}/auth/admin/me`;
    try {
      const resp = await axios.get(url, { headers: { Authorization: authHeader }, timeout: 6000 });
      const me = resp.data || {};
      const w = me?.scoreWeights || me?.score_weights || me?.user?.scoreWeights || me?.user?.score_weights || me?.weights;
      return normalizeWeights(w);
    } catch (err) {
      logger.warning(`weightsConfig fetchUserWeights fallback default ${safeStr(err?.response?.data || err?.message || err)}`);
      return DEFAULT_WEIGHTS;
    }
  };
}

/**
 * createFetchApiKeyId - returns an async function to resolve API key to numeric id
 */
function createFetchApiKeyId({ axios, dbmanagerUrl, logger }) {
  const safeStr = (v) => { try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); } };
  return async function fetchApiKeyId(apiKey) {
    if (!apiKey) return null;
    const url = `${dbmanagerUrl}/auth/api-keys/lookup?api_key=${encodeURIComponent(apiKey)}`;
    try {
      const resp = await axios.get(url, { timeout: 6000 });
      const row = resp.data;
      const id = row?.id ?? row?.api_key_id ?? row?.apiKeyId;
      return Number.isFinite(Number(id)) ? Number(id) : null;
    } catch (err) {
      logger.warning(`weightsConfig fetchApiKeyId failed ${safeStr(err?.response?.data || err?.message || err)}`);
      return null;
    }
  };
}

module.exports = {
  DEFAULT_WEIGHTS,
  WEIGHT_GROUPS,
  FILTER_FIELD_MAP,
  ORDER_FIELD_MAP,
  allowedFilterNames,
  normalizeWeights,
  weightSlice,
  createFetchUserWeights,
  createFetchApiKeyId,
};
