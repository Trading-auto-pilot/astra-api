"use strict";

const express = require("express");
const axios = require("axios");

module.exports = function buildFundamentalsRouter({ service, logger, moduleName }) {
  const router = express.Router();
  const fnPrefix = "fundamentals";
  const authServiceUrl = (process.env.AUTHSERVICE_URL || "http://authservice:3015").replace(/\/+$/, "");
  const dbmanagerUrl = (process.env.DBMANAGER_URL || "http://dbmanager:3002").replace(/\/+$/, "");

  // Pesi di default (percentuali 0–100) allineati alla tabella user_score_weights
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

  const clamp01 = (x) => {
    if (x == null || Number.isNaN(x)) return 0;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  };

  const safeStringify = (val) => {
    if (val === undefined) return "";
    if (typeof val === "string") return val;
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  };

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

  const fetchUserWeights = async (authHeader) => {
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer")) return DEFAULT_WEIGHTS;
    const url = `${authServiceUrl}/auth/admin/me`;
    try {
      const resp = await axios.get(url, {
        headers: { Authorization: authHeader },
        timeout: 6000,
      });
      const me = resp.data || {};
      const w =
        me?.scoreWeights ||
        me?.score_weights ||
        me?.user?.scoreWeights ||
        me?.user?.score_weights ||
        me?.weights;
      return normalizeWeights(w);
    } catch (err) {
      logger.warning(`${fnPrefix} fetchUserWeights fallback default ${safeStringify(err?.response?.data || err?.message || err)}`);
      return DEFAULT_WEIGHTS;
    }
  };

  const fetchApiKeyId = async (apiKey) => {
    if (!apiKey) return null;
    const url = `${dbmanagerUrl}/auth/api-keys/lookup?api_key=${encodeURIComponent(apiKey)}`;
    try {
      const resp = await axios.get(url, { timeout: 6000 });
      const row = resp.data;
      const id = row?.id ?? row?.api_key_id ?? row?.apiKeyId;
      return Number.isFinite(Number(id)) ? Number(id) : null;
    } catch (err) {
      logger.warning(`${fnPrefix} fetchApiKeyId failed ${safeStringify(err?.response?.data || err?.message || err)}`);
      return null;
    }
  };

  const fetchUserId = async (req) => {
    // 1) header già forwardato da auth-service
    const headerUser = req?.headers?.["x-user-id"] ?? req?.headers?.["x-userid"];
    if (headerUser && Number.isFinite(Number(headerUser))) return Number(headerUser);

    // 2) Bearer token
    const authHeader = req?.headers?.authorization;
    if (authHeader && authHeader.toLowerCase().startsWith("bearer")) {
      const url = `${authServiceUrl}/auth/admin/me`;
      try {
        const resp = await axios.get(url, {
          headers: { Authorization: authHeader },
          timeout: 6000,
        });
        const me = resp.data || {};
        const id = me?.user?.id ?? me?.id ?? me?.tokenPayload?.sub;
        if (Number.isFinite(Number(id))) return Number(id);
      } catch (err) {
        logger.warning(`${fnPrefix} fetchUserId bearer failed ${safeStringify(err?.response?.data || err?.message || err)}`);
      }
    }

    // 3) API key: usa eventualmente l'header forwardato con id chiave
    const apiKeyId = req?.headers?.["x-api-key"] ?? req?.headers?.["x-api-keyid"];
    if (apiKeyId && Number.isFinite(Number(apiKeyId))) return Number(apiKeyId);

    // 4) Se manca l'id ma il soggetto è api_key, prova a risolverlo leggendo l'header X-API-Key
    const subjectType = (req?.headers?.["x-auth-subject-type"] || "").toLowerCase();
    const apiKeyValue =
      req?.headers?.["x-api-key"] ||
      req?.headers?.["x-api-keyid"] ||
      req?.headers?.["x-api-key-id"];
    if ((subjectType === "api_key" || apiKeyValue) && apiKeyValue) {
      const resolved = await fetchApiKeyId(apiKeyValue);
      if (resolved) return resolved;
    }

    // Log diagnostico prima di restituire null
    logger.error(
      `${fnPrefix} fetchUserId missing ${safeStringify({
        headers: {
          "x-user-id": req?.headers?.["x-user-id"],
          "x-api-key-id": req?.headers?.["x-api-key-id"],
          "x-auth-subject-type": req?.headers?.["x-auth-subject-type"],
          "x-api-key": req?.headers?.["x-api-key"] ? "present" : "absent",
          auth: req?.headers?.authorization ? "present" : "absent",
        },
        path: req?.path,
        method: req?.method,
      })}`
    );

    return null;
  };

  const safeNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const computeVolumeScore = (momentumObj, weights) => {
    const vol = momentumObj?.components?.volume;
    const comps = vol?.components;
    if (!comps) return vol?.score ?? null;
    const vals = [
      comps.volSpikeScore,
      comps.directionalVolume,
      comps.efficiencyScore,
      comps.rangeScore,
    ];
    const ws = weightSlice(weights, WEIGHT_GROUPS.volume);
    let num = 0;
    let den = 0;
    vals.forEach((v, idx) => {
      if (v != null) {
        num += clamp01(v) * ws[idx];
        den += ws[idx];
      }
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
      if (v != null) {
        num += clamp01(v) * ws[idx];
        den += ws[idx];
      }
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
      if (v != null) {
        num += clamp01(v) * ws[idx];
        den += ws[idx];
      }
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
      if (v != null) {
        num += (v / 100) * ws[idx];
        den += ws[idx];
      }
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

    const weighted = parts.reduce((s, p) => s + p.v * p.w, 0) / totalW;
    return Math.round(weighted);
  };

  const decorate = (row, weights) => {
    if (!row) return row;
    let momentumObj = null;
    try {
      if (row.momentum_json) {
        momentumObj = typeof row.momentum_json === "string" ? JSON.parse(row.momentum_json) : row.momentum_json;
      }
    } catch {
      momentumObj = null;
    }
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

  // GET /fundamentals/history?symbol=XYZ&days=70
  router.get("/history", async (req, res) => {
    const fn = `${fnPrefix}.GET:/history`;
    const { symbol, days } = req.query;
    try {
      const data = await service.fundamentalService.getHistory({
        symbol,
        days: days ? Number(days) : undefined,
      });
      return res.json(data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.message || err) });
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // CRUD user-order (proxy verso DBManager)
  const getUserOrder = async (req, res) => {
    const fn = `${fnPrefix}.GET:/user-order`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) {
        logger.error(
          `${fn} userId missing ${safeStringify({
            headers: {
              "x-user-id": req.headers["x-user-id"],
              "x-api-key-id": req.headers["x-api-key-id"],
              "x-auth-subject-type": req.headers["x-auth-subject-type"],
              auth: req.headers.authorization ? "present" : "absent",
            },
          })}`
        );
        return res.status(401).json({ ok: false, error: "User non identificato" });
      }
      const pipeId = req.params.pipeId ?? req.query.pipe_id ?? req.query.pipeId;
      const url = `${dbmanagerUrl}/fundamentals/user-order/${userId}${
        pipeId ? `?pipeId=${encodeURIComponent(pipeId)}` : ""
      }`;
      const resp = await axios.get(url, { timeout: 6000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(err?.response?.status || 500).json({
        ok: false,
        error: err?.response?.data || "Errore lettura user_order_by",
      });
    }
  };

  router.get("/user-order", getUserOrder);
  router.get("/user-order/:pipeId", getUserOrder);

  const postUserOrder = async (req, res) => {
    const fn = `${fnPrefix}.POST:/user-order`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) {
        logger.error(
          `${fn} userId missing ${safeStringify({
            headers: {
              "x-user-id": req.headers["x-user-id"],
              "x-api-key-id": req.headers["x-api-key-id"],
              "x-auth-subject-type": req.headers["x-auth-subject-type"],
              auth: req.headers.authorization ? "present" : "absent",
            },
          })}`
        );
        return res.status(401).json({ ok: false, error: "User non identificato" });
      }
      const pipeId =
        req.params.pipeId ??
        req.body?.pipe_id ??
        req.body?.pipeId ??
        req.query?.pipe_id ??
        req.query?.pipeId;
      const body = { ...req.body, user_id: userId, ...(pipeId !== undefined ? { pipe_id: pipeId } : {}) };
      const url = `${dbmanagerUrl}/fundamentals/user-order`;
      const resp = await axios.post(url, body, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(500).json({ ok: false, error: "Errore salvataggio user_order_by" });
    }
  };

  router.post("/user-order", postUserOrder);
  router.post("/user-order/:pipeId", postUserOrder);

  const putUserOrder = async (req, res) => {
    const fn = `${fnPrefix}.PUT:/user-order/:id`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) {
        logger.error(
          `${fn} userId missing ${safeStringify({
            headers: {
              "x-user-id": req.headers["x-user-id"],
              "x-api-key-id": req.headers["x-api-key-id"],
              "x-auth-subject-type": req.headers["x-auth-subject-type"],
              auth: req.headers.authorization ? "present" : "absent",
            },
          })}`
        );
        return res.status(401).json({ ok: false, error: "User non identificato" });
      }
      const id = req.params.id;
      const pipeIdVal =
        req.params.pipeId ??
        req.body?.pipe_id ??
        req.body?.pipeId ??
        req.query?.pipe_id ??
        req.query?.pipeId;
      const body = { ...req.body, user_id: userId, ...(pipeIdVal !== undefined ? { pipe_id: pipeIdVal } : {}) };
      const pipeQuery = pipeIdVal ? `?pipeId=${encodeURIComponent(pipeIdVal)}` : "";
      const url = `${dbmanagerUrl}/fundamentals/user-order/${id}${pipeQuery}`;
      const resp = await axios.put(url, body, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(500).json({ ok: false, error: "Errore aggiornamento user_order_by" });
    }
  };

  router.put("/user-order/:id", putUserOrder);
  router.put("/user-order/:id/:pipeId", putUserOrder);

  const deleteUserOrder = async (req, res) => {
    const fn = `${fnPrefix}.DELETE:/user-order/:id`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) {
        logger.error(
          `${fn} userId missing ${safeStringify({
            headers: {
              "x-user-id": req.headers["x-user-id"],
              "x-api-key-id": req.headers["x-api-key-id"],
              "x-auth-subject-type": req.headers["x-auth-subject-type"],
              auth: req.headers.authorization ? "present" : "absent",
            },
          })}`
        );
        return res.status(401).json({ ok: false, error: "User non identificato" });
      }
      const id = req.params.id;
      const rawPipe =
        req.params.pipeId ??
        req.query.pipe_id ??
        req.query.pipeId ??
        req.body?.pipe_id ??
        req.body?.pipeId;
      const pipeId = rawPipe ? `?pipeId=${encodeURIComponent(rawPipe)}` : "";
      const url = `${dbmanagerUrl}/fundamentals/user-order/${id}/${userId}${pipeId}`;
      const resp = await axios.delete(url, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(500).json({ ok: false, error: "Errore cancellazione user_order_by" });
    }
  };

  router.delete("/user-order/:id", deleteUserOrder);
  router.delete("/user-order/:id/:pipeId", deleteUserOrder);

  // CRUD user_filters (proxy verso DBManager)
  router.get("/user-filters/:pipeId", async (req, res) => {
    const fn = `${fnPrefix}.GET:/user-filters/:pipeId`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) {
        logger.error(
          `${fn} userId missing ${safeStringify({
            headers: {
              "x-user-id": req.headers["x-user-id"],
              "x-api-key-id": req.headers["x-api-key-id"],
              "x-auth-subject-type": req.headers["x-auth-subject-type"],
              auth: req.headers.authorization ? "present" : "absent",
            },
          })}`
        );
        return res.status(401).json({ ok: false, error: "User non identificato" });
      }
      const pipeId = req.params.pipeId ?? req.query.pipe_id ?? req.query.pipeId;
      const url = `${dbmanagerUrl}/fundamentals/user-filters/${userId}${
        pipeId ? `?pipeId=${encodeURIComponent(pipeId)}` : ""
      }`;
      const resp = await axios.get(url, { timeout: 6000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(500).json({ ok: false, error: "Errore lettura user_filters" });
    }
  });

  router.post("/user-filters", async (req, res) => {
    const fn = `${fnPrefix}.POST:/user-filters`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) {
        logger.error(
          `${fn} userId missing ${safeStringify({
            headers: {
              "x-user-id": req.headers["x-user-id"],
              "x-api-key-id": req.headers["x-api-key-id"],
              "x-auth-subject-type": req.headers["x-auth-subject-type"],
              auth: req.headers.authorization ? "present" : "absent",
            },
          })}`
        );
        return res.status(401).json({ ok: false, error: "User non identificato" });
      }
      const pipeId =
        req.body?.pipe_id ?? req.body?.pipeId ?? req.query?.pipe_id ?? req.query?.pipeId;
      const body = { ...req.body, user_id: userId, ...(pipeId !== undefined ? { pipe_id: pipeId } : {}) };
      const url = `${dbmanagerUrl}/fundamentals/user-filters`;
      const resp = await axios.post(url, body, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(500).json({ ok: false, error: "Errore salvataggio user_filters" });
    }
  });

  router.put("/user-filters/:filterName/:pipeId", async (req, res) => {
    const fn = `${fnPrefix}.PUT:/user-filters/:filterName/:pipeId`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) {
        logger.error(
          `${fn} userId missing ${safeStringify({
            headers: {
              "x-user-id": req.headers["x-user-id"],
              "x-api-key-id": req.headers["x-api-key-id"],
              "x-auth-subject-type": req.headers["x-auth-subject-type"],
              auth: req.headers.authorization ? "present" : "absent",
            },
          })}`
        );
        return res.status(401).json({ ok: false, error: "User non identificato" });
      }
      const filterName = req.params.filterName;
      const pipeIdVal =
        req.params.pipeId ??
        req.body?.pipe_id ??
        req.body?.pipeId ??
        req.query?.pipe_id ??
        req.query?.pipeId;
      const pipeId = pipeIdVal ? `?pipeId=${encodeURIComponent(pipeIdVal)}` : "";
      const url = `${dbmanagerUrl}/fundamentals/user-filters/${userId}/${encodeURIComponent(filterName)}${pipeId}`;
      const body = { ...req.body, user_id: userId, ...(pipeIdVal !== undefined ? { pipe_id: pipeIdVal } : {}) };
      const resp = await axios.put(url, body || {}, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(500).json({ ok: false, error: "Errore aggiornamento user_filters" });
    }
  });

  router.delete("/user-filters/:filterName/:pipeId", async (req, res) => {
    const fn = `${fnPrefix}.DELETE:/user-filters/:filterName/:pipeId`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const filterName = req.params.filterName;
      const rawPipe =
        req.params.pipeId ??
        req.query.pipe_id ??
        req.query.pipeId ??
        req.body?.pipe_id ??
        req.body?.pipeId;
      const pipeId = rawPipe ? `?pipeId=${encodeURIComponent(rawPipe)}` : "";
      const url = `${dbmanagerUrl}/fundamentals/user-filters/${userId}/${encodeURIComponent(filterName)}${pipeId}`;
      const resp = await axios.delete(url, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(500).json({ ok: false, error: "Errore cancellazione user_filters" });
    }
  });

  // CRUD user_pipes (proxy verso DBManager, userId dal token). Espone endpoint senza userId nel path
  async function handleGetPipes(req, res) {
    const fn = `${fnPrefix}.GET:/users/pipes`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const url = `${dbmanagerUrl}/users/${userId}/pipes`;
      const resp = await axios.get(url, { timeout: 6000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(err?.response?.status || 500).json({ ok: false, error: "Errore lettura pipes" });
    }
  }

  async function handleGetPipeById(req, res) {
    const fn = `${fnPrefix}.GET:/users/pipes/:id`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const url = `${dbmanagerUrl}/users/${userId}/pipes/${req.params.id}`;
      const resp = await axios.get(url, { timeout: 6000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(err?.response?.status || 500).json({ ok: false, error: "Errore lettura pipe" });
    }
  }

  async function handleCreatePipe(req, res) {
    const fn = `${fnPrefix}.POST:/users/pipes`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const body = { ...req.body, user_id: userId };
      const url = `${dbmanagerUrl}/users/${userId}/pipes`;
      const resp = await axios.post(url, body, { timeout: 8000 });
      const payload = resp.data || {};

      // Prova a ricavare il pipeId appena creato
      const pipeId = Number(
        payload?.insertId ??
          payload?.data?.insertId ??
          payload?.id ??
          payload?.data?.id
      );

      logger.info(`${fn} pipe creata ${safeStringify({ userId, pipeId, payload })}`);

      // Step 1: crea riga user_score_weights per la nuova pipe (best-effort)
      if (pipeId !== undefined && pipeId !== null) {
        try {
          await axios.post(
            `${dbmanagerUrl}/auth/users/${userId}/score-weights/${encodeURIComponent(pipeId)}`,
            {},
            { timeout: 5000 }
          );
          logger.info(`${fn} score_weights creato ${safeStringify({ userId, pipeId })}`);
        } catch (err) {
          logger.warning(`${fn} add score_weights fallback ${safeStringify(err?.response?.data || err?.message || err)}`);
        }

        // Step 2: duplica i filtri di default (user_id=0, pipe_id=0) per il nuovo utente/pipe
        try {
          await axios.post(
            `${dbmanagerUrl}/auth/users/${userId}/filters/${encodeURIComponent(pipeId)}`,
            {},
            { timeout: 8000 }
          );
          logger.info(`${fn} filtri default copiati ${safeStringify({ userId, pipeId })}`);
        } catch (err) {
          logger.warning(`${fn} default filters copy failed ${safeStringify(err?.response?.data || err?.message || err)}`);
        }
      } else {
        logger.warning(`${fn} pipeId non determinato, salto setup pesi/filtri ${safeStringify({ response: payload })}`);
      }

      return res.json(payload);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(err?.response?.status || 500).json({ ok: false, error: "Errore creazione pipe" });
    }
  }

  async function handleUpdatePipe(req, res) {
    const fn = `${fnPrefix}.PUT:/users/pipes/:id`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const body = { ...req.body, user_id: userId };
      const url = `${dbmanagerUrl}/users/${userId}/pipes/${req.params.id}`;
      const resp = await axios.put(url, body, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(err?.response?.status || 500).json({ ok: false, error: "Errore aggiornamento pipe" });
    }
  }

  async function handleDeletePipe(req, res) {
    const fn = `${fnPrefix}.DELETE:/users/pipes/:id`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const url = `${dbmanagerUrl}/users/${userId}/pipes/${req.params.id}`;
      const resp = await axios.delete(url, { timeout: 8000 });
      const payload = resp.data || {};
      const pipeIdNum = Number(req.params.id);

      // Best-effort: pulizia risorse collegate (pesi, filtri, order_by)
      if (Number.isFinite(pipeIdNum)) {
        // 1) score_weights
        try {
          await axios.delete(`${dbmanagerUrl}/auth/users/${userId}/score-weights/${pipeIdNum}`, { timeout: 5000 });
        } catch (err) {
          logger.warning(`${fn} cleanup score_weights failed`, {
            error: safeStringify(err?.response?.data || err?.message || err),
          });
        }

        // 2) user_filters per quella pipe
        try {
          await axios.delete(
            `${dbmanagerUrl}/auth/users/${userId}/filters/${encodeURIComponent(pipeIdNum)}`,
            { timeout: 6000 }
          );
        } catch (err) {
          logger.warning(`${fn} cleanup filters failed`, { error: safeStringify(err?.response?.data || err?.message || err) });
        }

        // 3) user_order_by per quella pipe
        try {
          const orderResp = await axios.get(
            `${dbmanagerUrl}/fundamentals/user-order/${encodeURIComponent(pipeIdNum)}`,
            { timeout: 6000 }
          );
          const orders = Array.isArray(orderResp?.data?.data)
            ? orderResp.data.data
            : Array.isArray(orderResp?.data)
              ? orderResp.data
              : [];
          for (const o of orders) {
            const id = o?.id;
            if (!id) continue;
            try {
              await axios.delete(
                `${dbmanagerUrl}/fundamentals/user-order/${id}?pipeId=${encodeURIComponent(pipeIdNum)}`,
                { timeout: 5000 }
              );
            } catch (e) {
              logger.warning(`${fn} cleanup order failed`, {
                id,
                error: safeStringify(e?.response?.data || e?.message || e),
              });
            }
          }
        } catch (err) {
          logger.warning(`${fn} cleanup order fetch failed`, {
            error: safeStringify(err?.response?.data || err?.message || err),
          });
        }
      }

      return res.json(payload);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(err?.response?.status || 500).json({ ok: false, error: "Errore cancellazione pipe" });
    }
  }

  router.get("/users/pipes", handleGetPipes);
  router.get("/users/pipes/:id", handleGetPipeById);
  router.post("/users/pipes", handleCreatePipe);
  router.put("/users/pipes/:id", handleUpdatePipe);
  router.delete("/users/pipes/:id", handleDeletePipe);
  // Compat: vecchio path con userId nel path, ma ignoriamo il parametro
  router.get("/users/:userId/pipes", handleGetPipes);
  router.get("/users/:userId/pipes/:id", handleGetPipeById);
  router.post("/users/:userId/pipes", handleCreatePipe);
  router.put("/users/:userId/pipes/:id", handleUpdatePipe);
  router.delete("/users/:userId/pipes/:id", handleDeletePipe);

  // GET /fundamentals/user-fundamentals-view -> proxy verso DBManager usando l'utente autenticato
  router.get("/user-fundamentals-view", async (req, res) => {
    const fn = `${fnPrefix}.GET:/user-fundamentals-view`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const url = `${dbmanagerUrl}/fundamentals/user-fundamentals-view/${userId}`;
      const resp = await axios.get(url, { timeout: 8000, transformResponse: (r) => r });
      // Inoltra esattamente il payload del DBManager, per essere future-proof (es. momentum_json)
      const parsed = (() => {
        try {
          return typeof resp.data === "string" ? JSON.parse(resp.data) : resp.data;
        } catch {
          return resp.data;
        }
      })();
      return res.status(resp.status || 200).json(parsed);
    } catch (err) {
      const payload = err?.response?.data;
      const errorStr = payload ? safeStringify(payload) : safeStringify(err?.message || String(err));
      logger.error(`${fn} error ${errorStr}`);
      return res.status(500).json({ ok: false, error: errorStr || "Errore lettura user_fundamentals" });
    }
  });

  // user_score_weights (proxy verso DBManager, pipe opzionale)
  router.get("/user/score-weights/:pipeId", async (req, res) => {
    const fn = `${fnPrefix}.GET:/user/score-weights/:pipeId`;
    try {
      const userId = await fetchUserId(req);
      const pipeId = Number(req.params.pipeId);
      if (!userId || !Number.isFinite(pipeId)) {
        logger.error(
          `${fn} userId or pipeId missing/invalid ${safeStringify({
            headers: {
              "x-user-id": req.headers["x-user-id"],
              "x-api-key-id": req.headers["x-api-key-id"],
              "x-auth-subject-type": req.headers["x-auth-subject-type"],
              auth: req.headers.authorization ? "present" : "absent",
            },
            pipeId,
          })}`
        );
        return res.status(401).json({ ok: false, error: "User o pipe non identificato" });
      }
      const url = `${dbmanagerUrl}/auth/users/${userId}/score-weights/${encodeURIComponent(pipeId)}`;
      const resp = await axios.get(url, { timeout: 6000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res
        .status(err?.response?.status || 500)
        .json({ ok: false, error: err?.response?.data || "Errore lettura score_weights" });
    }
  });

  router.put("/user/score-weights/:pipeId", async (req, res) => {
    const fn = `${fnPrefix}.PUT:/user/score-weights/:pipeId`;
    console.log(fn);
    try {
      const userId = await fetchUserId(req);
      const pipeId = Number(req.params.pipeId);
      if (!userId || !Number.isFinite(pipeId)) {
        logger.error(
          `${fn} userId or pipeId missing/invalid ${safeStringify({
            headers: {
              "x-user-id": req.headers["x-user-id"],
              "x-api-key-id": req.headers["x-api-key-id"],
              "x-auth-subject-type": req.headers["x-auth-subject-type"],
              auth: req.headers.authorization ? "present" : "absent",
            },
            pipeId,
          })}`
        );
        return res.status(401).json({ ok: false, error: "User o pipe non identificato" });
      }
      const body = { ...req.body, pipe_id: pipeId, pipeId: pipeId };
      const url = `${dbmanagerUrl}/auth/users/${userId}/score-weights/${encodeURIComponent(pipeId)}`;
      const resp = await axios.put(url, body, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res
        .status(err?.response?.status || 500)
        .json({ ok: false, error: err?.response?.data || "Errore aggiornamento score_weights" });
    }
  });

  // POST /fundamentals/recalculate-user -> ricalcola gli score utente e salva su user_fundamentals
  router.post("/recalculate-user", async (req, res) => {
    const fn = `${fnPrefix}.POST:/recalculate-user`;
    try {
      const userId = await fetchUserId(req.headers.authorization);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });

      const weights = await fetchUserWeights(req.headers.authorization);
      const data = await service.fundamentalService.getAll();
      if (!Array.isArray(data)) return res.status(500).json({ ok: false, error: "Dati fundamentals non validi" });

      let saved = 0;
      for (const row of data) {
        const decorated = decorate(row, weights);
        let momentumObj = null;
        try {
          if (row?.momentum_json) {
            momentumObj = typeof row.momentum_json === "string" ? JSON.parse(row.momentum_json) : row.momentum_json;
          }
        } catch {
          momentumObj = null;
        }
        const momentumShortScore =
          decorated?.momentum_short_score ??
          row?.momentum_short_score ??
          momentumObj?.components?.momentumShort?.score ??
          null;
        const doubleTopScore =
          momentumObj?.components?.doubleTop?.score ??
          momentumObj?.doubleTopScore ??
          momentumObj?.doubleTop?.score ??
          null;

        const payload = {
          user_id: userId,
          symbol: row.symbol,
          valuation_score: decorated?.valuation_score ?? row?.valuation_score ?? null,
          quality_score: decorated?.quality_score ?? row?.quality_score ?? null,
          risk_score: decorated?.risk_score ?? row?.risk_score ?? null,
          momentum_score: decorated?.momentum_score ?? row?.momentum_score ?? null,
          momentum_short_score: momentumShortScore,
          grow_score: decorated?.growth_probability ?? row?.growth_probability ?? null,
          double_top_score: doubleTopScore ?? null,
        };

        await axios.post(`${dbmanagerUrl}/fundamentals/user-fundamentals`, payload, { timeout: 8000 });
        saved += 1;
      }

      return res.json({ ok: true, saved });
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(500).json({ ok: false, error: "Errore ricalcolo user fundamentals" });
    }
  });

  // GET /fundamentals  -> tutti i simboli
  router.get("/", async (req, res) => {
    const fn = `${fnPrefix}.GET:/`;

    try {
      logger.trace(`${fn} start`);
      const weights = await fetchUserWeights(req.headers.authorization);

      const data = await service.fundamentalService.getAll();
      const decorated = Array.isArray(data) ? data.map((row) => decorate(row, weights)) : data;

      logger.trace(`${fn} success`, { count: Array.isArray(decorated) ? decorated.length : undefined });
      res.json(decorated);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.message || err) });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /fundamentals/:symbol  -> singolo simbolo
  router.get("/:symbol", async (req, res) => {
    const fn = `${fnPrefix}.GET:/:symbol`;
    const { symbol } = req.params;

    try {
      logger.trace(`${fn} start`, { symbol });
      const weights = await fetchUserWeights(req.headers.authorization);

      if (!symbol) {
        logger.warning(`${fn} missing symbol`);
        return res.status(400).json({ error: "symbol is required" });
      }

      const data = await service.fundamentalService.getOne(symbol);

      if (!data || (Array.isArray(data) && data.length === 0)) {
        logger.info(`${fn} not found`, { symbol });
        return res.status(404).json({ error: "Not found" });
      }

      const decorated = Array.isArray(data) ? data.map((row) => decorate(row, weights)) : decorate(data, weights);

      logger.trace(`${fn} success`, { symbol });
      res.json(decorated);
    } catch (err) {
      logger.error(`${fn} error`, { symbol, error: safeStringify(err?.message || err) });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /fundamentals/lastCandel -> ricalcola momentum (incl. short) per i simboli passati
  router.post("/lastCandel", async (req, res) => {
    const fn = `${fnPrefix}.POST:/lastCandel`;
    const items = Array.isArray(req.body) ? req.body : req.body?.items;

    if (!Array.isArray(items)) {
      return res.status(400).json({ ok: false, error: "Body must be an array or have items array" });
    }

    try {
      const weights = await fetchUserWeights(req.headers.authorization);
      const results = await service.recalcMomentumForLastCandles(items);
      const decorated = Array.isArray(results)
        ? results.map((r) => {
            const { marketScore, marketRiskScore, shortRiskScore } = normalizeShortRisk(
              { risk_score: r?.risk_score ?? null },
              r?.momentum,
              weights
            );
            const momentumScore =
              computeMomentumLongScore(r?.momentum, weights) ?? safeNum(r?.momentum?.score ?? r?.momentum_score);
            const growthProbability = computeGrowthProbability(
              { risk_score: r?.risk_score ?? null, momentum_score: momentumScore },
              r?.momentum,
              weights
            );
            const volumeScore = computeVolumeScore(r?.momentum, weights);
            const momentumShortScore = computeMomentumShortScore(r?.momentum, weights);
            return {
              ...r,
              market_score: marketScore,
              market_risk_score: marketRiskScore,
              short_risk_score: shortRiskScore,
              growth_probability: growthProbability,
              volume_score: volumeScore,
              momentum_score: momentumScore ?? r?.momentum_score ?? null,
              momentum_short_score: momentumShortScore ?? r?.momentum_short_score ?? null,
            };
          })
        : results;
      return res.json({ ok: true, count: Array.isArray(decorated) ? decorated.length : 0, results: decorated });
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.message || err) });
      return res.status(500).json({ ok: false, error: err?.message || "Internal server error" });
    }
  });

  return router;
};
