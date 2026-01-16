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

  const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));

  // ====== Market Daily async jobs ======
  const marketDailyJobs = new Map();
  const newMarketJobId = () => `market_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const createMarketJob = () => {
    const now = new Date().toISOString();
    const job = {
      id: newMarketJobId(),
      status: "queued", // queued|running|completed|error|cancelled
      createdAt: now,
      updatedAt: now,
      totalSymbols: 0,
      processed: 0,
      inserted: 0,
      updated: 0,
      persisted: false,
      errors: [],
      cancel: false,
      startedAt: null,
      finishedAt: null,
    };
    marketDailyJobs.set(job.id, job);
    return job;
  };
  const updateMarketJob = (id, patch) => {
    const job = marketDailyJobs.get(id);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    return job;
  };
  const getActiveMarketJobs = () =>
    Array.from(marketDailyJobs.values()).filter((j) => j.status === "queued" || j.status === "running");

  const persistMarketDailyJobRecord = async (jobId, payload) => {
    const job = marketDailyJobs.get(jobId);
    if (job?.persisted) return;
    try {
      await axios.post(`${dbmanagerUrl}/fundamentals/market-daily-jobs`, payload, { timeout: 8000 });
      if (job) job.persisted = true;
    } catch (err) {
      logger.warning(`${fnPrefix}.market-daily job=${jobId} persist failed ${safeStringify({ error: fmtErr(err) })}`);
    }
  };

  const getFmpApiKey = () => process.env.FMP_API_KEY || process.env.FMP_KEY || null;
  const fmtErr = (err) => {
    if (!err) return "unknown error";
    const status = err?.response?.status;
    const data = err?.response?.data;
    if (data !== undefined) {
      try {
        const str = typeof data === "string" ? data : JSON.stringify(data);
        return status ? `${status} ${str}` : str;
      } catch {
        return status ? `${status} ${err.message || String(err)}` : err.message || String(err);
      }
    }
    return status ? `${status} ${err.message || String(err)}` : err.message || String(err);
  };

  const toSqlDateTime = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().replace("T", " ").slice(0, 19);
  };

  // ====== User daily scores async jobs ======
  const userDailyJobs = new Map();
  const newUserDailyJobId = () => `udaily_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const createUserDailyJob = () => {
    const now = new Date().toISOString();
    const job = {
      id: newUserDailyJobId(),
      status: "queued",
      createdAt: now,
      updatedAt: now,
      processed: 0,
      saved: 0,
      total: 0,
      cancel: false,
      persisted: false,
      errors: [],
      date: null,
      pipeId: null,
      userId: null,
      modelName: null,
      modelVersion: null,
      startedAt: null,
      finishedAt: null,
    };
    userDailyJobs.set(job.id, job);
    return job;
  };
  const updateUserDailyJob = (id, patch) => {
    const job = userDailyJobs.get(id);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    return job;
  };
  const getActiveUserDailyJobs = () =>
    Array.from(userDailyJobs.values()).filter((j) => j.status === "queued" || j.status === "running");

  const persistUserDailyJobRecord = async (jobId, payload) => {
    const job = userDailyJobs.get(jobId);
    if (job?.persisted) return;
    try {
      await axios.post(`${dbmanagerUrl}/fundamentals/user-daily-score-jobs`, payload, { timeout: 8000 });
      if (job) job.persisted = true;
    } catch (err) {
      logger.warning(`${fnPrefix}.user-daily job=${jobId} persist failed ${safeStringify({ error: fmtErr(err) })}`);
    }
  };

  const runMarketDailyJob = async (jobId) => {
    logger.info(`${fnPrefix} update-market-daily start job=${jobId}`);
    const startedAt = new Date().toISOString();
    const job = updateMarketJob(jobId, { status: "running", startedAt });
    if (!job) return;
    const apiKey = getFmpApiKey();
    if (!apiKey) {
      updateMarketJob(jobId, { status: "error", error: "FMP_API_KEY non configurata", finishedAt: new Date().toISOString() });
      await persistMarketDailyJobRecord(jobId, {
        job_id: jobId,
        status: "error",
        total_symbols: 0,
        processed: 0,
        inserted: 0,
        updated: 0,
        error_count: 1,
        errors_json: [{ error: "FMP_API_KEY non configurata" }],
        params_json: {},
        started_at: toSqlDateTime(startedAt),
        finished_at: toSqlDateTime(new Date().toISOString()),
      });
      return;
    }

    try {
      const histUrl = `${dbmanagerUrl}/fundamentals/history/records`;
      const histResp = await axios.get(histUrl);
      const rows = Array.isArray(histResp.data?.data) ? histResp.data.data : Array.isArray(histResp.data) ? histResp.data : [];
      const symbols = [...new Set(rows.map((r) => String(r.symbol || "").toUpperCase()).filter(Boolean))];
      updateMarketJob(jobId, { totalSymbols: symbols.length });
      logger.info(`${fnPrefix} update-market-daily job=${jobId} symbols=${symbols.length}`);

      const concurrencyRaw = Number(process.env.MARKET_DAILY_CONCURRENCY);
      const concurrency = Number.isFinite(concurrencyRaw) && concurrencyRaw > 0 ? Math.floor(concurrencyRaw) : 5;
      logger.info(`${fnPrefix} update-market-daily job=${jobId} concurrency=${concurrency}`);
      const fmpSpacingMs = 200; // 5 req/sec max
      let nextFmpAt = 0;
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitForFmpSlot = async () => {
        const now = Date.now();
        const delay = Math.max(0, nextFmpAt - now);
        nextFmpAt = Math.max(now, nextFmpAt) + fmpSpacingMs;
        if (delay > 0) await wait(delay);
      };

      const upsertMarketDailyBulk = async (rows, symbol) => {
        const current = marketDailyJobs.get(jobId);
        if (!current || current.cancel) return null;
        const started = Date.now();
        try {
          const postResp = await axios.post(`${dbmanagerUrl}/fundamentals/market-daily/bulk`, rows);
          if (postResp.data?.ok === false) throw new Error(postResp.data.error || "POST bulk market-daily failed");
          const total = Number(postResp.data?.total ?? rows.length) || rows.length;
          const affected = Number(postResp.data?.affectedRows ?? 0) || 0;
          const updatedEst = affected > total ? affected - total : 0;
          const insertedEst = total - updatedEst;
          const cur = marketDailyJobs.get(jobId);
          if (cur) {
            updateMarketJob(jobId, {
              inserted: (cur.inserted || 0) + insertedEst,
              updated: (cur.updated || 0) + updatedEst,
            });
          }
          logger.trace?.(
            `${fnPrefix} update-market-daily job=${jobId} bulk upsert ok ${safeStringify({
              symbol,
              rows: total,
              affected,
              inserted: insertedEst,
              updated: updatedEst,
              ms: Date.now() - started,
            })}`
          );
          return { inserted: insertedEst, updated: updatedEst, ms: Date.now() - started };
        } catch (err) {
          const cur = marketDailyJobs.get(jobId);
          const list = cur?.errors || [];
          const errMsg = fmtErr(err);
          updateMarketJob(jobId, {
            errors: [...list, { symbol, error: errMsg }],
          });
          logger.error(
            `${fnPrefix} update-market-daily job=${jobId} bulk upsert error ${safeStringify({
              symbol,
              error: errMsg,
            })}`
          );
          logger.trace?.(
            `${fnPrefix} update-market-daily job=${jobId} bulk upsert error ${safeStringify({
              symbol,
              ms: Date.now() - started,
              error: errMsg,
            })}`
          );
          return { inserted: 0, updated: 0, ms: Date.now() - started, error: errMsg };
        }
      };

      let sampleLogged = 0;

      const pickNum = (obj, keys = []) => {
        for (const k of keys) {
          if (obj && obj[k] !== undefined && obj[k] !== null) {
            const n = safeNum(obj[k]);
            if (n !== null) return n;
          }
        }
        return null;
      };

      const processSymbol = async (sym) => {
        const cur = marketDailyJobs.get(jobId);
        if (!cur || cur.cancel) return;
        const fmpUrl = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(apiKey)}`;
        let data = [];
        const fmpStart = Date.now();
        try {
          await waitForFmpSlot();
          const resp = await axios.get(fmpUrl, { timeout: 15000 });
          data = Array.isArray(resp.data?.historical) ? resp.data.historical : Array.isArray(resp.data) ? resp.data : [];
          logger.trace?.(
            `${fnPrefix} update-market-daily job=${jobId} fmp fetch ${safeStringify({
              symbol: sym,
              rows: data.length,
              ms: Date.now() - fmpStart,
            })}`
          );
        } catch (err) {
          const cur2 = marketDailyJobs.get(jobId);
          const list = cur2?.errors || [];
          const errMsg = fmtErr(err);
          const errDetail = { symbol: sym, error: errMsg, url: fmpUrl };
          updateMarketJob(jobId, { errors: [...list, errDetail] });
          logger.error(
            `${fnPrefix} update-market-daily job=${jobId} fetch error ${safeStringify({
              symbol: sym,
              error: errMsg,
              url: fmpUrl,
            })}`
          );
          logger.trace?.(
            `${fnPrefix} update-market-daily job=${jobId} fmp fetch error ${safeStringify({
              symbol: sym,
              ms: Date.now() - fmpStart,
              error: errMsg,
            })}`
          );
          return;
        }

        let localInserted = 0;
        let localUpdated = 0;
        let localErrors = 0;
        let upsertMs = 0;
        const pending = [];

        for (const row of data) {
          const cur3 = marketDailyJobs.get(jobId);
          if (!cur3 || cur3.cancel) break;
          const tradeDate = normalizeMarketDate(row.date || row.tradeDate || row.dateTime || row.datetime);
          if (!tradeDate) continue;

          const payload = {
            symbol: sym,
            trade_date: tradeDate,
            open: pickNum(row, ["open", "o", "Open"]),
            high: pickNum(row, ["high", "h", "High"]),
            low: pickNum(row, ["low", "l", "Low"]),
            close: pickNum(row, ["close", "c", "Close"]),
            adj_close: pickNum(row, ["adjClose", "adj_close", "adjustedClose", "adj_close_price", "adjClosePrice"]),
            vwap: pickNum(row, ["vwap", "VWAP"]),
            change: pickNum(row, ["change"]),
            change_percent: pickNum(row, ["changePercent", "change_percent", "changePercent1D"]),
            source: "fmp_eod",
            volume: pickNum(row, ["volume", "vol"]),
          };
          if (sampleLogged < 5) {
            logger.info(
              `${fnPrefix} update-market-daily job=${jobId} sample payload ${safeStringify(payload)}`
            );
            sampleLogged += 1;
          }
          const allNull =
            payload.open == null &&
            payload.high == null &&
            payload.low == null &&
            payload.close == null &&
            payload.adj_close == null &&
            payload.vwap == null &&
            payload.change == null &&
            payload.change_percent == null;
          if (allNull) {
            logger.warning(
              `${fnPrefix} update-market-daily job=${jobId} payload senza prezzi ${safeStringify({
                symbol: payload.symbol,
                trade_date: payload.trade_date,
                volume: payload.volume,
              })}`
            );
          }
          pending.push(payload);
        }
        const chunkSize = 300;
        for (let i = 0; i < pending.length; i += chunkSize) {
          const cur3 = marketDailyJobs.get(jobId);
          if (!cur3 || cur3.cancel) break;
          const chunk = pending.slice(i, i + chunkSize);
          const res = await upsertMarketDailyBulk(chunk, sym);
          localInserted += res?.inserted || 0;
          localUpdated += res?.updated || 0;
          if (res?.error) localErrors += 1;
          if (res?.ms) upsertMs += res.ms;
        }
        logger.trace?.(
          `${fnPrefix} update-market-daily job=${jobId} symbol done ${safeStringify({
            symbol: sym,
            fetched: data.length,
            inserted: localInserted,
            updated: localUpdated,
            errors: localErrors,
            upsertMs,
          })}`
        );
        const cur4 = marketDailyJobs.get(jobId);
        if (cur4 && !cur4.cancel) updateMarketJob(jobId, { processed: (cur4.processed || 0) + 1 });
      };

      let nextIdx = 0;
      const workers = Array.from({ length: Math.min(concurrency, symbols.length) }, () => async () => {
        while (true) {
          const cur = marketDailyJobs.get(jobId);
          if (!cur || cur.cancel) return;
          const sym = symbols[nextIdx];
          nextIdx += 1;
          if (!sym) return;
          await processSymbol(sym);
        }
      });
      await Promise.all(workers.map((fn) => fn()));

      const end = marketDailyJobs.get(jobId);
      if (end?.cancel) {
        updateMarketJob(jobId, { status: "cancelled", finishedAt: new Date().toISOString() });
        await persistMarketDailyJobRecord(jobId, {
          job_id: jobId,
          status: "cancelled",
          total_symbols: end?.totalSymbols || 0,
          processed: end?.processed || 0,
          inserted: end?.inserted || 0,
          updated: end?.updated || 0,
          error_count: end?.errors?.length || 0,
          errors_json: end?.errors || [],
          params_json: {},
          started_at: toSqlDateTime(startedAt),
          finished_at: toSqlDateTime(end?.finishedAt || new Date().toISOString()),
        });
        logger.info(`${fnPrefix} update-market-daily job=${jobId} cancelled`);
      } else {
        updateMarketJob(jobId, { status: "completed", finishedAt: new Date().toISOString() });
        await persistMarketDailyJobRecord(jobId, {
          job_id: jobId,
          status: "completed",
          total_symbols: end?.totalSymbols || 0,
          processed: end?.processed || 0,
          inserted: end?.inserted || 0,
          updated: end?.updated || 0,
          error_count: end?.errors?.length || 0,
          errors_json: end?.errors || [],
          params_json: {},
          started_at: toSqlDateTime(startedAt),
          finished_at: toSqlDateTime(end?.finishedAt || new Date().toISOString()),
        });
        logger.info(
          `${fnPrefix} update-market-daily job=${jobId} completed ${safeStringify({
            totalSymbols: end?.totalSymbols,
            processed: end?.processed,
            inserted: end?.inserted,
            updated: end?.updated,
            errors: end?.errors?.length || 0,
          })}`
        );
        if (end?.errors?.length) {
          logger.error(
            `${fnPrefix} update-market-daily job=${jobId} completed with errors ${safeStringify(
              end.errors.slice(-5) // log ultimi errori
            )}`
          );
        }
      }
    } catch (err) {
      const errorStr = fmtErr(err);
      updateMarketJob(jobId, { status: "error", error: errorStr, finishedAt: new Date().toISOString() });
      await persistMarketDailyJobRecord(jobId, {
        job_id: jobId,
        status: "error",
        total_symbols: job?.totalSymbols || 0,
        processed: job?.processed || 0,
        inserted: job?.inserted || 0,
        updated: job?.updated || 0,
        error_count: (job?.errors?.length || 0) + 1,
        errors_json: [...(job?.errors || []), { error: errorStr }],
        params_json: {},
        started_at: toSqlDateTime(startedAt),
        finished_at: toSqlDateTime(job?.finishedAt || new Date().toISOString()),
      });
      logger.error(`${fnPrefix} update-market-daily job=${jobId} error ${safeStringify(err?.response?.data || err?.message || err)}`);
    }
  };

  // Avvia job asincrono
  router.post("/update-market-daily", async (_req, res) => {
    const job = createMarketJob();
    setImmediate(() => runMarketDailyJob(job.id));
    return res.json({ ok: true, jobId: job.id });
  });

  // -------------------------------------------------------
  // Calcolo user_daily_scores per una data
  // -------------------------------------------------------
  const fetchUserScoreWeights = async (userId, pipeId) => {
    const baseUrl = `${dbmanagerUrl}/auth/users/${userId}/score-weights`;
    const url =
      pipeId !== null && pipeId !== undefined
        ? `${baseUrl}/${encodeURIComponent(pipeId)}`
        : baseUrl;
    try {
      logger.debug?.(`${fnPrefix} fetch weights url=${url}`);
      const resp = await axios.get(url, { timeout: 8000 });
      logger.debug?.(`${fnPrefix} fetch weights resp=${safeStringify(resp.data)}`);
      return resp.data || {};
    } catch (err) {
      if (err?.response?.status === 404) {
        logger.warning(
          `${fnPrefix} user-daily weights not found, uso defaults ${safeStringify({
            userId,
            pipeId,
            url,
            resp: err?.response?.data,
          })}`
        );
        return {};
      }
      logger.error(
        `${fnPrefix} fetch weights error ${safeStringify({
          url,
          error: err?.response?.data || err?.message || err,
        })}`
      );
      throw err;
    }
  };

  const normalizeMarketDate = (value) => {
    if (!value) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const str = String(value);
    return str.length >= 10 ? str.slice(0, 10) : str;
  };

  const computeDelta = (latestVal, targetVal) => {
    const latestNum = safeNum(latestVal);
    const targetNum = safeNum(targetVal);
    if (latestNum === null || targetNum === null) {
      return { abs: null, pct: null };
    }
    const abs = latestNum - targetNum;
    const pct = targetNum !== 0 ? (abs / targetNum) * 100 : null;
    return { abs, pct };
  };

  const fetchMarketDailyBySymbol = async (symbol) => {
    const url = `${dbmanagerUrl}/fundamentals/market-daily?symbol=${encodeURIComponent(symbol)}`;
    const resp = await axios.get(url, { timeout: 12000 });
    const rows = Array.isArray(resp.data?.data) ? resp.data.data : Array.isArray(resp.data) ? resp.data : [];
    // normalizza e ordina per data crescente
    return rows
      .map((r) => ({
        date: normalizeMarketDate(r.trade_date || r.tradeDate || r.date),
        close: safeNum(r.close),
        open: safeNum(r.open),
        high: safeNum(r.high),
        low: safeNum(r.low),
        adj_close: safeNum(r.adj_close ?? r.adjClose),
        volume: safeNum(r.volume),
      }))
      .filter((r) => r.date)
      .sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
  };

  const fetchCloseForDate = async (symbol, targetDate) => {
    const url = `${dbmanagerUrl}/fundamentals/market-daily?symbol=${encodeURIComponent(
      symbol
    )}&trade_date=${encodeURIComponent(targetDate)}`;
    try {
      logger.debug?.(`${fnPrefix} market-daily fetch close url=${url}`);
      const resp = await axios.get(url, { timeout: 8000 });
      const rows = Array.isArray(resp.data?.data) ? resp.data.data : Array.isArray(resp.data) ? resp.data : [];
      if (!rows.length) return null;
      const r = rows[0];
      return {
        date: normalizeMarketDate(r.trade_date || r.tradeDate || r.date),
        close: safeNum(r.close),
        adj_close: safeNum(r.adj_close ?? r.adjClose),
      };
    } catch (err) {
      logger.warning(
        `${fnPrefix} market-daily fetch close failed ${safeStringify({
          symbol,
          date: targetDate,
          url,
          error: fmtErr(err),
        })}`
      );
      return null;
    }
  };

  const findClose = (rows, targetDate) => {
    const row = rows.find((r) => r.date === targetDate);
    return row?.close ?? row?.adj_close ?? null;
  };

  const percentileRank = (values, v) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = sorted.findIndex((x) => x > v);
    const rank = idx === -1 ? sorted.length : idx;
    return rank / sorted.length;
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

  // ---- async job per user_daily_scores ----
  const runUserDailyJob = async (jobId, { userId, targetDate, pipeId, modelName, modelVersion }) => {
    const fn = `${fnPrefix}.user-daily job=${jobId}`;
    const startedAt = new Date().toISOString();
    updateUserDailyJob(jobId, {
      status: "running",
      date: targetDate,
      pipeId,
      startedAt,
      userId,
      modelName,
      modelVersion,
    });
    const userIdSafe = Number.isFinite(Number(userId)) ? Number(userId) : null;
    const pipeIdSafe = pipeId !== null && pipeId !== undefined && pipeId !== "" ? Number(pipeId) : 0;
    if (userIdSafe === null) {
      updateUserDailyJob(jobId, { status: "error", error: "userId mancante" });
      return;
    }

    try {
      logger.info(
        `${fn} start user=${userIdSafe} pipe=${pipeIdSafe} date=${targetDate} model=${modelName || "Manual update"}:${modelVersion || "1.0"}`
      );
      const weights = await fetchUserScoreWeights(userIdSafe, pipeIdSafe);
      const fundamentalsUrl = `${dbmanagerUrl}/fundamentals`;
      const fundamentalsResp = await axios.get(fundamentalsUrl, { timeout: 15000 });
      const fundamentalsRows = Array.isArray(fundamentalsResp.data) ? fundamentalsResp.data : [];

      const marketCache = new Map();
      const rawMomValues = [];
      const rawShortValues = [];
      const computed = [];

      for (const row of fundamentalsRows) {
        const job = userDailyJobs.get(jobId);
        if (!job || job.cancel) break;

        const symbol = row.symbol;
        if (!symbol) continue;

        if (!marketCache.has(symbol)) {
          try {
            const md = await fetchMarketDailyBySymbol(symbol);
            marketCache.set(symbol, md);
          } catch (err) {
            const url = `${dbmanagerUrl}/fundamentals/market-daily?symbol=${encodeURIComponent(symbol)}`;
            logger.warning(`${fn} market fetch failed ${safeStringify({ symbol, url, error: fmtErr(err) })}`);
            continue;
          }
        }
        const mdRows = marketCache.get(symbol) || [];
        let p0 = findClose(mdRows, targetDate);
        if (p0 == null) {
          const fetched = await fetchCloseForDate(symbol, targetDate);
          if (fetched?.date) {
            mdRows.push({ date: fetched.date, close: fetched.close, adj_close: fetched.adj_close });
            p0 = fetched.close ?? fetched.adj_close ?? null;
          }
        }
        if (p0 == null) {
          const list = userDailyJobs.get(jobId)?.errors || [];
          const mdUrl = `${dbmanagerUrl}/fundamentals/market-daily?symbol=${encodeURIComponent(symbol)}`;
          updateUserDailyJob(jobId, {
            errors: [
              ...list,
              {
                symbol,
                error: "close mancante per data target",
                url: mdUrl,
                available: mdRows.length,
              },
            ],
          });
          continue;
        }

        const getPastClose = (days) => {
          const d = new Date(targetDate);
          d.setDate(d.getDate() - days);
          const pastStr = d.toISOString().slice(0, 10);
          return findClose(mdRows, pastStr);
        };

        const r = (a, b) => (a != null && b != null && b !== 0 ? a / b - 1 : null);
        const r5 = r(p0, getPastClose(5));
        const r10 = r(p0, getPastClose(10));
        const r20 = r(p0, getPastClose(20));
        const r60 = r(p0, getPastClose(60));
        const r120 = r(p0, getPastClose(120));

        const raw_mom = weightedSum([
          [r20, weights.wt_raw_mom_20d],
          [r60, weights.wt_raw_mom_60d],
          [r120, weights.wt_raw_mom_120d],
        ]);
        const raw_short = weightedSum([
          [r5, weights.wt_raw_short_5d],
          [r10, weights.wt_raw_short_10d],
        ]);

        const quality_score = weightedSum([
          [row.roe_score, weights.wt_quality_roe],
          [row.roa_score, weights.wt_quality_roa],
          [row.op_margin_score, weights.wt_quality_op_margin],
          [row.piot_score, weights.wt_quality_piotroski],
        ]);

        const beta_score = row.beta != null ? clamp(1 - Math.abs(Number(row.beta) - 1) / 1.5, 0, 1) * 100 : null;
        const debt_equity_score = row.debt_equity != null ? stepDebtEquityScore(row.debt_equity) * 100 : null;
        const altman_z_score = row.altman_z != null ? clamp(Number(row.altman_z) / 3, 0, 1) * 100 : null;
        const risk_score = weightedSum([
          [beta_score, weights.wt_risk_beta],
          [debt_equity_score, weights.wt_risk_debt_equity],
          [altman_z_score, weights.wt_risk_altman],
        ]);

        const valuation_score = weightedSum([
          [row.pe_score, weights.wt_val_pe],
          [row.pb_score, weights.wt_val_pb],
          [row.dcf_score, weights.wt_val_dcf],
        ]);

        let momentumObj = null;
        try {
          if (row.momentum_json) {
            momentumObj = typeof row.momentum_json === "string" ? JSON.parse(row.momentum_json) : row.momentum_json;
          }
        } catch {
          momentumObj = null;
        }

        computed.push({
          symbol,
          raw_mom,
          raw_short,
          quality_score,
          risk_score,
          valuation_score,
          momentumObj,
          row,
        });
        if (raw_mom != null) rawMomValues.push(raw_mom);
        if (raw_short != null) rawShortValues.push(raw_short);
      }

      const results = [];
      for (const c of computed) {
        const job = userDailyJobs.get(jobId);
        if (!job || job.cancel) break;

        const momentum_score = c.raw_mom != null ? Math.round((percentileRank(rawMomValues, c.raw_mom) || 0) * 100) : null;
        const momentum_score_short =
          c.raw_short != null ? Math.round((percentileRank(rawShortValues, c.raw_short) || 0) * 100) : null;

        const total_score = weightedSum([
          [momentum_score, weights.wt_daily_momentum],
          [c.quality_score, weights.wt_daily_quality],
          [c.valuation_score, weights.wt_daily_valuation],
          [c.risk_score, weights.wt_daily_risk],
        ]);

        const marketRiskScore = computeMarketRiskScore(c.momentumObj, weights);
        const volumeScore = computeVolumeScore(c.momentumObj, weights);
        const { marketScore, shortRiskScore } = normalizeShortRisk(
          { ...(c.row || {}), risk_score: c.risk_score },
          c.momentumObj,
          weights
        );
        const growthProbability = computeGrowthProbability(
          { ...(c.row || {}), risk_score: c.risk_score, momentum_score },
          c.momentumObj,
          weights
        );

        results.push({
          symbol: c.symbol,
          score_date: targetDate,
          user_id: userIdSafe,
          pipe_id: pipeIdSafe,
          momentum_score,
          momentum_score_short,
          quality_score: c.quality_score,
          risk_score: c.risk_score,
          valuation_score: c.valuation_score,
          total_score: total_score != null ? Math.round(total_score) : null,
          market_score: marketScore ?? null,
          market_risk_score: marketRiskScore ?? null,
          short_risk_score: shortRiskScore ?? null,
          volume_score: volumeScore ?? null,
          growth_probability: growthProbability ?? null,
        });
      }

      // scoring model SCD2: chiudi eventuale record attivo stesso name/version e inserisci nuovo
      let modelId = null;
      const modelNameSafe = modelName || "Manual update";
      const modelVersionSafe = modelVersion || "1.0";
      try {
        const modelsResp = await axios.get(
          `${dbmanagerUrl}/fundamentals/scoring-models?name=${encodeURIComponent(modelNameSafe)}`,
          { timeout: 8000 }
        );
        const models = Array.isArray(modelsResp.data?.data)
          ? modelsResp.data.data
          : Array.isArray(modelsResp.data)
          ? modelsResp.data
          : [];
        const existingSameVersion = models.find((m) => m.version === modelVersionSafe);
        if (existingSameVersion?.id) {
          modelId = existingSameVersion.id;
        } else {
          const active = models.find(
            (m) => m.version === modelVersionSafe && (m.valid_to === null || m.valid_to === undefined)
          );
          if (active?.id) {
            try {
              await axios.put(
                `${dbmanagerUrl}/fundamentals/scoring-models/${active.id}`,
                { valid_to: targetDate },
                { timeout: 8000 }
              );
            } catch (err) {
              logger.warning(
                `${fn} closing scoring_model failed ${safeStringify({ id: active.id, error: fmtErr(err) })}`
              );
            }
          }
          const insertResp = await axios.post(
            `${dbmanagerUrl}/fundamentals/scoring-models`,
            {
              name: modelNameSafe,
              version: modelVersionSafe,
              valid_from: targetDate,
              valid_to: null,
              params_json: weights,
            },
            { timeout: 8000 }
          );
          modelId =
            insertResp.data?.insertId ??
            insertResp.data?.id ??
            insertResp.data?.data?.insertId ??
            insertResp.data?.data?.id ??
            null;
        }
      } catch (err) {
        logger.warning(
          `${fn} scoring model insert failed ${safeStringify({ name: modelNameSafe, version: modelVersionSafe, error: fmtErr(err) })}`
        );
      }

      // helper per fundamentals_history id
      const getFundHistoryId = async (symbol) => {
        try {
          const resp = await axios.get(
            `${dbmanagerUrl}/fundamentals/history/records?symbol=${encodeURIComponent(symbol)}`,
            { timeout: 8000 }
          );
          const rows = Array.isArray(resp.data?.data)
            ? resp.data.data
            : Array.isArray(resp.data)
            ? resp.data
            : [];
          const match = rows.find((r) => {
            const from = (r.valid_from || "").slice(0, 10);
            const to = r.valid_to ? r.valid_to.slice(0, 10) : null;
            return from <= targetDate && (to === null || to > targetDate);
          });
          return match?.id ?? null;
        } catch (err) {
          logger.warning(
            `${fn} fundamentals_history lookup failed ${safeStringify({ symbol, error: fmtErr(err) })}`
          );
          return null;
        }
      };

      let saved = 0;
      for (const r of results) {
        const job = userDailyJobs.get(jobId);
        if (!job || job.cancel) break;
        const fhId = await getFundHistoryId(r.symbol);
        try {
          await axios.post(
            `${dbmanagerUrl}/fundamentals/scores-daily`,
            {
              ...r,
              model_id: modelId,
              model_version: modelVersionSafe,
              fundamentals_history_id: fhId,
            },
            { timeout: 8000 }
          );
          saved += 1;
        } catch {
          try {
            await axios.put(
              `${dbmanagerUrl}/fundamentals/scores-daily/${encodeURIComponent(r.symbol)}/${encodeURIComponent(
                r.score_date
              )}/${encodeURIComponent(userIdSafe)}/${encodeURIComponent(pipeIdSafe)}`,
              {
                ...r,
                model_id: modelId,
                model_version: modelVersionSafe,
                fundamentals_history_id: fhId,
              },
              { timeout: 8000 }
            );
            saved += 1;
          } catch (err2) {
            const list = job.errors || [];
            updateUserDailyJob(jobId, {
              errors: [...list, { symbol: r.symbol, date: r.score_date, error: fmtErr(err2) }],
            });
          }
        }
      }

      const finalStatus = userDailyJobs.get(jobId)?.cancel ? "cancelled" : "completed";
      updateUserDailyJob(jobId, {
        status: finalStatus,
        saved,
        total: results.length,
        finishedAt: new Date().toISOString(),
      });
      const job = userDailyJobs.get(jobId);
      await persistUserDailyJobRecord(jobId, {
        job_id: jobId,
        user_id: userIdSafe,
        pipe_id: pipeIdSafe,
        status: finalStatus,
        target_date: targetDate,
        model_name: modelNameSafe,
        model_version: modelVersionSafe,
        total_items: results.length,
        saved_items: saved,
        error_count: job?.errors?.length || 0,
        errors_json: job?.errors || [],
        params_json: weights,
        started_at: toSqlDateTime(startedAt),
        finished_at: toSqlDateTime(job?.finishedAt || new Date().toISOString()),
      });
      logger.info(
        `${fn} completed ${safeStringify({
          date: targetDate,
          pipeId: pipeIdSafe,
          total: results.length,
          saved,
          errors: userDailyJobs.get(jobId)?.errors?.length || 0,
        })}`
      );
      if (!results.length) {
        const errSample = (userDailyJobs.get(jobId)?.errors || []).slice(0, 5);
        logger.warning(
          `${fn} nessun risultato calcolato (market data mancanti o screener vuoto) ${safeStringify({
            errors_sample: errSample,
          })}`
        );
      }
    } catch (err) {
      const errorStr = fmtErr(err);
      updateUserDailyJob(jobId, { status: "error", error: errorStr, finishedAt: new Date().toISOString() });
      const job = userDailyJobs.get(jobId);
      await persistUserDailyJobRecord(jobId, {
        job_id: jobId,
        user_id: userIdSafe,
        pipe_id: pipeIdSafe,
        status: "error",
        target_date: targetDate,
        model_name: modelName || "Manual update",
        model_version: modelVersion || "1.0",
        total_items: job?.total || 0,
        saved_items: job?.saved || 0,
        error_count: (job?.errors?.length || 0) + 1,
        errors_json: [...(job?.errors || []), { error: errorStr }],
        started_at: toSqlDateTime(startedAt),
        finished_at: toSqlDateTime(job?.finishedAt || new Date().toISOString()),
      });
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
    }
  };

  // Avvia job asincrono per daily scores
  router.post("/user-daily-scores", async (req, res) => {
    const fn = `${fnPrefix}.POST:/user-daily-scores`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const tz =
        req.body?.timezone ||
        req.query?.timezone ||
        process.env.DEFAULT_JOB_TIMEZONE ||
        process.env.SCHEDULER_TIMEZONE ||
        "UTC";
      const getDateInTz = (zone) => {
        try {
          return new Intl.DateTimeFormat("en-CA", {
            timeZone: zone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date());
        } catch {
          return new Date().toISOString().slice(0, 10);
        }
      };
      const defaultDate = getDateInTz(tz);
      const targetDate = (req.body?.date || req.query?.date || defaultDate).toString().slice(0, 10);
      const pipeIdRaw = req.body?.pipeId ?? req.body?.pipe_id ?? req.query?.pipeId ?? req.query?.pipe_id ?? undefined;
      const pipeId = pipeIdRaw !== undefined && pipeIdRaw !== null && pipeIdRaw !== "" ? Number(pipeIdRaw) : undefined;
      const modelName = req.body?.name ?? req.body?.note ?? req.body?.description ?? "Non specificate";
      const modelVersion = req.body?.version ?? "1.0";

      if (pipeId === undefined) {
        // carica tutte le pipe e avvia un job per ciascuna
        const url = `${dbmanagerUrl}/auth/users/${userId}/score-weights`;
        const resp = await axios.get(url, { timeout: 8000 });
        const list = Array.isArray(resp.data) ? resp.data : [];
        if (!list.length) {
          return res.status(404).json({ ok: false, error: "Pesi/pipe non trovati per l'utente" });
        }
        const jobs = [];
        for (const row of list) {
          const pid = row.pipe_id ?? row.pipeId ?? 0;
          const job = createUserDailyJob();
          updateUserDailyJob(job.id, {
            date: targetDate,
            pipeId: pid,
            userId,
            modelName,
            modelVersion,
          });
          setImmediate(() => runUserDailyJob(job.id, { userId, targetDate, pipeId: pid, modelName, modelVersion }));
          jobs.push(job.id);
        }
        return res.json({ ok: true, jobIds: jobs });
      } else {
        const job = createUserDailyJob();
        updateUserDailyJob(job.id, {
          date: targetDate,
          pipeId,
          userId,
          modelName,
          modelVersion,
        });
        setImmediate(() => runUserDailyJob(job.id, { userId, targetDate, pipeId, modelName, modelVersion }));
        return res.json({ ok: true, jobId: job.id });
      }
    } catch (err) {
      const url = `${dbmanagerUrl}/fundamentals/market-daily?symbol=${encodeURIComponent("ALL")}`;
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)} url_hint=${url}`);
      return res.status(500).json({ ok: false, error: "Errore avvio calcolo user_daily_scores" });
    }
  });

  // Lista job attivi
  router.get("/user-daily-scores", (_req, res) => {
    return res.json({ ok: true, jobs: getActiveUserDailyJobs() });
  });

  // Cancella job
  router.delete("/user-daily-scores/:jobId", (req, res) => {
    const job = userDailyJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, error: "Job non trovato" });
    if (job.status === "completed" || job.status === "error") {
      return res.status(400).json({ ok: false, error: "Job già terminato" });
    }
    job.cancel = true;
    updateUserDailyJob(job.id, { status: "cancelled", finishedAt: new Date().toISOString() });
    if (!job.persisted) {
      persistUserDailyJobRecord(job.id, {
        job_id: job.id,
        user_id: Number.isFinite(Number(job.userId)) ? Number(job.userId) : null,
        pipe_id: job.pipeId ?? null,
        status: "cancelled",
        target_date: job.date,
        model_name: job.modelName || "Manual update",
        model_version: job.modelVersion || "1.0",
        total_items: job.total || 0,
        saved_items: job.saved || 0,
        error_count: job.errors?.length || 0,
        errors_json: job.errors || [],
        started_at: toSqlDateTime(job.startedAt || job.createdAt || new Date().toISOString()),
        finished_at: toSqlDateTime(job.finishedAt || new Date().toISOString()),
      });
    }
    return res.json({ ok: true, jobId: job.id });
  });

  // Lista job attivi (queued/running)
  router.get("/update-market-daily", (_req, res) => {
    return res.json({ ok: true, jobs: getActiveMarketJobs() });
  });

  // Confronto market_daily: data specifica vs ultima disponibile
  router.get("/market-daily/compare", async (req, res) => {
    const fn = `${fnPrefix}.GET:/market-daily/compare`;
    try {
      const tradeDate = req.query.trade_date ?? req.query.tradeDate ?? req.query.date ?? null;
      if (!tradeDate) {
        return res.status(400).json({ ok: false, error: "trade_date obbligatoria" });
      }

      const targetUrl = `${dbmanagerUrl}/fundamentals/market-daily?trade_date=${encodeURIComponent(tradeDate)}`;
      const targetResp = await axios.get(targetUrl, { timeout: 12000 });
      const targetRows = Array.isArray(targetResp.data?.data)
        ? targetResp.data.data
        : Array.isArray(targetResp.data)
          ? targetResp.data
          : [];
      const symbols = [
        ...new Set(
          targetRows
            .map((r) => (r?.symbol ? String(r.symbol).toUpperCase() : null))
            .filter(Boolean)
        ),
      ];
      if (!symbols.length) {
        return res.json({ ok: true, data: [] });
      }

      const latestUrl = `${dbmanagerUrl}/fundamentals/market-daily/latest?symbols=${encodeURIComponent(
        symbols.join(",")
      )}`;
      const latestResp = await axios.get(latestUrl, { timeout: 12000 });
      const latestRows = Array.isArray(latestResp.data?.data)
        ? latestResp.data.data
        : Array.isArray(latestResp.data)
          ? latestResp.data
          : [];
      const latestBySymbol = new Map(
        latestRows.map((row) => [String(row.symbol).toUpperCase(), row])
      );

      const data = targetRows.map((row) => {
        const symbol = String(row.symbol).toUpperCase();
        const latest = latestBySymbol.get(symbol) || null;
        const deltaOpen = computeDelta(latest?.open, row.open);
        const deltaClose = computeDelta(latest?.close, row.close);
        const deltaHigh = computeDelta(latest?.high, row.high);
        const deltaLow = computeDelta(latest?.low, row.low);

        return {
          symbol,
          target: {
            trade_date: normalizeMarketDate(row.trade_date || row.tradeDate || row.date),
            open: safeNum(row.open),
            close: safeNum(row.close),
            high: safeNum(row.high),
            low: safeNum(row.low),
            volume: safeNum(row.volume),
          },
          latest: latest
            ? {
                trade_date: normalizeMarketDate(latest.trade_date || latest.tradeDate || latest.date),
                open: safeNum(latest.open),
                close: safeNum(latest.close),
                high: safeNum(latest.high),
                low: safeNum(latest.low),
                volume: safeNum(latest.volume),
              }
            : null,
          delta: {
            open_abs: deltaOpen.abs,
            open_pct: deltaOpen.pct,
            close_abs: deltaClose.abs,
            close_pct: deltaClose.pct,
            high_abs: deltaHigh.abs,
            high_pct: deltaHigh.pct,
            low_abs: deltaLow.abs,
            low_pct: deltaLow.pct,
          },
        };
      });

      return res.json({ ok: true, data });
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore confronto market_daily" });
    }
  });

  // Cancella un job attivo
  router.delete("/update-market-daily/:jobId", (req, res) => {
    const job = marketDailyJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, error: "Job non trovato" });
    if (job.status === "completed" || job.status === "error" || job.status === "cancelled") {
      return res.status(400).json({ ok: false, error: "Job già terminato" });
    }
    job.cancel = true;
    updateMarketJob(job.id, { status: "cancelled", finishedAt: new Date().toISOString() });
    if (!job.persisted) {
      persistMarketDailyJobRecord(job.id, {
        job_id: job.id,
        status: "cancelled",
        total_symbols: job.totalSymbols || 0,
        processed: job.processed || 0,
        inserted: job.inserted || 0,
        updated: job.updated || 0,
        error_count: job.errors?.length || 0,
        errors_json: job.errors || [],
        params_json: {},
        started_at: toSqlDateTime(job.startedAt || job.createdAt || new Date().toISOString()),
        finished_at: toSqlDateTime(job.finishedAt || new Date().toISOString()),
      });
    }
    return res.json({ ok: true, jobId: job.id });
  });

  // CRUD user_daily_score_jobs (proxy verso DBManager)
  router.get("/user-daily-score-jobs/:id", async (req, res) => {
    const fn = `${fnPrefix}.GET:/user-daily-score-jobs/:id`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const url = `${dbmanagerUrl}/fundamentals/user-daily-score-jobs/${encodeURIComponent(id)}`;
      const resp = await axios.get(url, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(500).json({ ok: false, error: "Errore lettura user_daily_score_jobs" });
    }
  });

  router.get("/user-daily-score-jobs", async (req, res) => {
    const fn = `${fnPrefix}.GET:/user-daily-score-jobs`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const pipeId = req.query.pipe_id ?? req.query.pipeId;
      const jobId = req.query.job_id ?? req.query.jobId;
      const status = req.query.status;
      const limit = req.query.limit;
      const qs = new URLSearchParams({
        user_id: String(userId),
        ...(pipeId !== undefined ? { pipe_id: String(pipeId) } : {}),
        ...(jobId !== undefined ? { job_id: String(jobId) } : {}),
        ...(status !== undefined ? { status: String(status) } : {}),
        ...(limit !== undefined ? { limit: String(limit) } : {}),
      });
      const url = `${dbmanagerUrl}/fundamentals/user-daily-score-jobs?${qs.toString()}`;
      const resp = await axios.get(url, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura user_daily_score_jobs" });
    }
  });

  router.post("/user-daily-score-jobs", async (req, res) => {
    const fn = `${fnPrefix}.POST:/user-daily-score-jobs`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const body = { ...(req.body || {}), user_id: userId };
      const url = `${dbmanagerUrl}/fundamentals/user-daily-score-jobs`;
      const resp = await axios.post(url, body, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(500).json({ ok: false, error: "Errore inserimento user_daily_score_jobs" });
    }
  });

  router.put("/user-daily-score-jobs/:id", async (req, res) => {
    const fn = `${fnPrefix}.PUT:/user-daily-score-jobs/:id`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const url = `${dbmanagerUrl}/fundamentals/user-daily-score-jobs/${encodeURIComponent(id)}`;
      const resp = await axios.put(url, req.body || {}, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(500).json({ ok: false, error: "Errore aggiornamento user_daily_score_jobs" });
    }
  });

  router.delete("/user-daily-score-jobs/:id", async (req, res) => {
    const fn = `${fnPrefix}.DELETE:/user-daily-score-jobs/:id`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const url = `${dbmanagerUrl}/fundamentals/user-daily-score-jobs/${encodeURIComponent(id)}`;
      const resp = await axios.delete(url, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error`, { error: safeStringify(err?.response?.data || err?.message || err) });
      return res.status(500).json({ ok: false, error: "Errore cancellazione user_daily_score_jobs" });
    }
  });

  // CRUD market_daily_jobs (proxy verso DBManager)
  router.get("/market-daily-jobs/:id", async (req, res) => {
    const fn = `${fnPrefix}.GET:/market-daily-jobs/:id`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const url = `${dbmanagerUrl}/fundamentals/market-daily-jobs/${encodeURIComponent(id)}`;
      const resp = await axios.get(url, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura market_daily_jobs" });
    }
  });

  router.get("/market-daily-jobs", async (req, res) => {
    const fn = `${fnPrefix}.GET:/market-daily-jobs`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const jobId = req.query.job_id ?? req.query.jobId;
      const status = req.query.status;
      const limit = req.query.limit;
      const qs = new URLSearchParams({
        ...(jobId !== undefined ? { job_id: String(jobId) } : {}),
        ...(status !== undefined ? { status: String(status) } : {}),
        ...(limit !== undefined ? { limit: String(limit) } : {}),
      });
      const url = `${dbmanagerUrl}/fundamentals/market-daily-jobs${qs.toString() ? `?${qs.toString()}` : ""}`;
      const resp = await axios.get(url, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura market_daily_jobs" });
    }
  });

  router.post("/market-daily-jobs", async (req, res) => {
    const fn = `${fnPrefix}.POST:/market-daily-jobs`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const url = `${dbmanagerUrl}/fundamentals/market-daily-jobs`;
      const resp = await axios.post(url, req.body || {}, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore inserimento market_daily_jobs" });
    }
  });

  router.put("/market-daily-jobs/:id", async (req, res) => {
    const fn = `${fnPrefix}.PUT:/market-daily-jobs/:id`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const url = `${dbmanagerUrl}/fundamentals/market-daily-jobs/${encodeURIComponent(id)}`;
      const resp = await axios.put(url, req.body || {}, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento market_daily_jobs" });
    }
  });

  router.delete("/market-daily-jobs/:id", async (req, res) => {
    const fn = `${fnPrefix}.DELETE:/market-daily-jobs/:id`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const url = `${dbmanagerUrl}/fundamentals/market-daily-jobs/${encodeURIComponent(id)}`;
      const resp = await axios.delete(url, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore cancellazione market_daily_jobs" });
    }
  });

  // CRUD ticker_scan_jobs (storico scan/force)
  router.get("/ticker-scan-jobs/:id", async (req, res) => {
    const fn = `${fnPrefix}.GET:/ticker-scan-jobs/:id`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const url = `${dbmanagerUrl}/fundamentals/ticker-scan-jobs/${encodeURIComponent(id)}`;
      const resp = await axios.get(url, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura ticker_scan_jobs" });
    }
  });

  router.get("/ticker-scan-jobs", async (req, res) => {
    const fn = `${fnPrefix}.GET:/ticker-scan-jobs`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const jobId = req.query.job_id ?? req.query.jobId;
      const status = req.query.status;
      const limit = req.query.limit;
      const qs = new URLSearchParams({
        ...(jobId !== undefined ? { job_id: String(jobId) } : {}),
        ...(status !== undefined ? { status: String(status) } : {}),
        ...(limit !== undefined ? { limit: String(limit) } : {}),
      });
      const url = `${dbmanagerUrl}/fundamentals/ticker-scan-jobs${qs.toString() ? `?${qs.toString()}` : ""}`;
      const resp = await axios.get(url, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura ticker_scan_jobs" });
    }
  });

  router.post("/ticker-scan-jobs", async (req, res) => {
    const fn = `${fnPrefix}.POST:/ticker-scan-jobs`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const url = `${dbmanagerUrl}/fundamentals/ticker-scan-jobs`;
      const resp = await axios.post(url, req.body || {}, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore inserimento ticker_scan_jobs" });
    }
  });

  router.put("/ticker-scan-jobs/:id", async (req, res) => {
    const fn = `${fnPrefix}.PUT:/ticker-scan-jobs/:id`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const url = `${dbmanagerUrl}/fundamentals/ticker-scan-jobs/${encodeURIComponent(id)}`;
      const resp = await axios.put(url, req.body || {}, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento ticker_scan_jobs" });
    }
  });

  router.delete("/ticker-scan-jobs/:id", async (req, res) => {
    const fn = `${fnPrefix}.DELETE:/ticker-scan-jobs/:id`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
      const url = `${dbmanagerUrl}/fundamentals/ticker-scan-jobs/${encodeURIComponent(id)}`;
      const resp = await axios.delete(url, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore cancellazione ticker_scan_jobs" });
    }
  });

  router.get("/scores-daily/counts/:pipeId", async (req, res) => {
    const fn = `${fnPrefix}.GET:/scores-daily/counts/:pipeId`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const pipeId = Number(req.params.pipeId);
      if (!Number.isFinite(pipeId)) return res.status(400).json({ ok: false, error: "pipe_id non valido" });
      const url = `${dbmanagerUrl}/fundamentals/scores-daily/counts?user_id=${encodeURIComponent(
        userId
      )}&pipe_id=${encodeURIComponent(pipeId)}`;
      const resp = await axios.get(url, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura counts scores_daily" });
    }
  });

  router.get("/scores-daily/by-user/:pipeId/:scoreDate", async (req, res) => {
    const fn = `${fnPrefix}.GET:/scores-daily/by-user/:pipeId/:scoreDate`;
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const pipeId = Number(req.params.pipeId);
      const scoreDate = req.params.scoreDate;
      if (!Number.isFinite(pipeId) || !scoreDate) {
        return res.status(400).json({ ok: false, error: "pipe_id e score_date obbligatori" });
      }
      const url = `${dbmanagerUrl}/fundamentals/scores-daily/by-user?user_id=${encodeURIComponent(
        userId
      )}&pipe_id=${encodeURIComponent(pipeId)}&score_date=${encodeURIComponent(scoreDate)}`;
      const resp = await axios.get(url, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura scores_daily by-user" });
    }
  });


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

  // bulk order by pipe
  router.put("/user-order/pipe/:pipeId", async (req, res) => {
    const fn = `${fnPrefix}.PUT:/user-order/pipe/:pipeId`;
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
      const pipeIdVal =
        req.params.pipeId ??
        req.body?.pipe_id ??
        req.body?.pipeId ??
        req.query?.pipe_id ??
        req.query?.pipeId;
      const orders = Array.isArray(req.body?.orders) ? req.body.orders : [];
      const urlBase = `${dbmanagerUrl}/fundamentals/user-order`;
      const results = [];
      for (const o of orders) {
        const targetId = o?.id;
        const url = targetId
          ? `${urlBase}/${encodeURIComponent(targetId)}${pipeIdVal ? `?pipeId=${encodeURIComponent(pipeIdVal)}` : ""}`
          : urlBase;
        const body = {
          ...o,
          user_id: userId,
          ...(pipeIdVal !== undefined ? { pipe_id: pipeIdVal } : {}),
        };
        const method = targetId ? "put" : "post";
        const resp = await axios({ url, method, data: body, timeout: 8000 }).catch((err) => {
          logger.error(`${fn} single order error ${safeStringify(err?.response?.data || err?.message || err)}`);
          return { data: { ok: false, error: err?.message || "errore ordine" } };
        });
        results.push(resp?.data ?? { ok: false, order: o });
      }
      return res.json({ ok: true, results });
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento user_order_by" });
    }
  });

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
      // se arriva una lista orders, gestisci bulk (post/put); se la pipe non è specificata usiamo id come pipeId
      if (Array.isArray(req.body?.orders)) {
        const orders = req.body.orders;
        const pipeIdForOrders = pipeIdVal !== undefined ? pipeIdVal : id;
        const results = [];
        for (const o of orders) {
          const targetId = o?.id;
          const url = targetId
            ? `${dbmanagerUrl}/fundamentals/user-order/${targetId}${
                pipeIdForOrders ? `?pipeId=${encodeURIComponent(pipeIdForOrders)}` : ""
              }`
            : `${dbmanagerUrl}/fundamentals/user-order`;
          const orderField = o?.order_field || o?.field || o?.orderField || o?.name;
          if (!orderField) {
            results.push({ ok: false, error: "order_field mancante" });
            continue;
          }
          const body = {
            ...o,
            order_field: orderField,
            user_id: userId,
            ...(pipeIdForOrders !== undefined ? { pipe_id: pipeIdForOrders } : {}),
          };
          const method = targetId ? "put" : "post";
          const resp = await axios({ url, method, data: body, timeout: 8000 }).catch((err) => {
            logger.error(`${fn} single order error ${safeStringify(err?.response?.data || err?.message || err)}`);
            return { data: { ok: false, error: err?.message || "errore ordine" } };
          });
          results.push(resp?.data ?? { ok: false, order: o });
        }
        return res.json({ ok: true, results });
      }
      const body = { ...req.body, user_id: userId, ...(pipeIdVal !== undefined ? { pipe_id: pipeIdVal } : {}) };
      const pipeQuery = pipeIdVal ? `?pipeId=${encodeURIComponent(pipeIdVal)}` : "";
      const url = `${dbmanagerUrl}/fundamentals/user-order/${id}${pipeQuery}`;
      const resp = await axios.put(url, body, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
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

  // bulk update user_filters per pipe
  router.put("/user-filters/:pipeId", async (req, res) => {
    const fn = `${fnPrefix}.PUT:/user-filters/:pipeId`;
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
        req.params.pipeId ?? req.body?.pipe_id ?? req.body?.pipeId ?? req.query?.pipe_id ?? req.query?.pipeId;
      const filters = Array.isArray(req.body?.filters) ? req.body.filters : [];
      const incomingNames = new Set(
        filters
          .map((f) => f?.filter_name || f?.filterName || f?.name)
          .filter((name) => typeof name === "string" && name.length > 0)
      );
      // elimina filtri non piu presenti
      try {
        const pipeQuery = pipeId ? `?pipeId=${encodeURIComponent(pipeId)}` : "";
        const listUrl = `${dbmanagerUrl}/fundamentals/user-filters/${userId}${pipeQuery}`;
        const listResp = await axios.get(listUrl, { timeout: 8000 });
        const existingRows = Array.isArray(listResp.data?.data)
          ? listResp.data.data
          : Array.isArray(listResp.data)
            ? listResp.data
            : [];
        const toDelete = existingRows
          .map((r) => r?.filter_name || r?.filterName || r?.name)
          .filter((name) => name && !incomingNames.has(name));
        for (const name of toDelete) {
          const delUrl = `${dbmanagerUrl}/fundamentals/user-filters/${userId}/${encodeURIComponent(name)}${pipeQuery}`;
          await axios.delete(delUrl, { timeout: 8000 }).catch((err) => {
            logger.warning(`${fn} delete missing filter failed`, {
              filter: name,
              error: safeStringify(err?.response?.data || err?.message || err),
            });
          });
        }
      } catch (err) {
        logger.warning(`${fn} fetch existing filters failed`, {
          error: safeStringify(err?.response?.data || err?.message || err),
        });
      }
      const results = [];
      for (const f of filters) {
        const filterName = f?.filter_name || f?.filterName || f?.name;
        if (!filterName) continue;
        const pipeQuery = pipeId ? `?pipeId=${encodeURIComponent(pipeId)}` : "";
        const url = `${dbmanagerUrl}/fundamentals/user-filters/${userId}/${encodeURIComponent(filterName)}${pipeQuery}`;
        const body = { ...f, user_id: userId, pipe_id: pipeId };
        const resp = await axios.put(url, body || {}, { timeout: 8000 }).catch((err) => {
          logger.error(`${fn} single error ${safeStringify(err?.response?.data || err?.message || err)}`);
          return { data: { ok: false, error: err?.message || "errore singolo filtro" } };
        });
        results.push(resp?.data ?? { ok: false, filter: filterName });
      }
      return res.json({ ok: true, results });
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento user_filters" });
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
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
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
      logger.info(
        `${fn} proxying to DBManager ${safeStringify({ url, userId, pipeId })}`
      );
      const resp = await axios.get(url, { timeout: 6000 });
      logger.info(
        `${fn} DBManager response ${safeStringify({
          status: resp?.status,
          dataType: typeof resp?.data,
          dataKeys: resp?.data && typeof resp.data === "object" ? Object.keys(resp.data) : null,
          dataLength: typeof resp?.data === "string" ? resp.data.length : null,
        })}`
      );
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
      const body = { ...req.body, user_id: userId, pipe_id: pipeId, pipeId: pipeId };
      const url = `${dbmanagerUrl}/auth/users/${userId}/score-weights/${encodeURIComponent(pipeId)}`;
      logger.info(
        `${fn} proxying to DBManager ${safeStringify({
          url,
          userId,
          pipeId,
          bodyKeys: Object.keys(body || {}),
        })}`
      );
      const resp = await axios.put(url, body, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
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
