"use strict";

const axios = require("axios");
const { reportJobDone } = require("../../shared/jobReporter");
const {
  safeNum, clamp, weightedSum, percentileRank, stepDebtEquityScore,
  computeMarketRiskScore, computeVolumeScore, normalizeShortRisk, computeGrowthProbability,
} = require("./scoreDecorator");
const MomentumCalculator = require("../modules/momentumCalculator");

const safeStringify = (val) => {
  if (val === undefined) return "";
  if (typeof val === "string") return val;
  try { return JSON.stringify(val); } catch { return String(val); }
};

const fetchAllPages = async (datahubAxios, basePath, pageSize = 1000) => {
  const all = [];
  let offset = 0;
  const sep = basePath.includes("?") ? "&" : "?";
  while (true) {
    const resp = await datahubAxios.get(`${basePath}${sep}limit=${pageSize}&offset=${offset}`);
    const items = resp.data?.items || [];
    all.push(...items);
    if (items.length < pageSize) break;
    offset += pageSize;
  }
  return all;
};

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

const normalizeMarketDate = (value) => {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const str = String(value);
  return str.length >= 10 ? str.slice(0, 10) : str;
};

const computeDelta = (latestVal, targetVal) => {
  const latestNum = safeNum(latestVal);
  const targetNum = safeNum(targetVal);
  if (latestNum === null || targetNum === null) return { abs: null, pct: null };
  const abs = latestNum - targetNum;
  const pct = targetNum !== 0 ? (abs / targetNum) * 100 : null;
  return { abs, pct };
};

const findClose = (rows, targetDate) => {
  const exact = rows.find((r) => r.date === targetDate);
  if (exact) return exact.close ?? exact.adj_close ?? null;
  // fallback: most recent close on or before targetDate (handles weekends/holidays)
  const candidates = rows.filter((r) => r.date <= targetDate);
  if (!candidates.length) return null;
  const latest = candidates[candidates.length - 1]; // rows sorted ASC
  return latest.close ?? latest.adj_close ?? null;
};

/**
 * createUserDailyService - factory for user daily score job management
 *
 * @param {object} deps
 * @param {object} deps.logger
 * @param {string} deps.dbmanagerUrl
 * @param {object} deps.datahubAxios  axios instance with datahub adapter
 */
function createUserDailyService({ logger, dbmanagerUrl, datahubAxios }) {
  const fn = "userDailyService";
  const momentumCalc = new MomentumCalculator({ logger, cachemanagerUrl: "" });

  // ---- In-memory job state ----
  const userDailyJobs = new Map();

  const newJobId = () => `udaily_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const createJob = () => {
    const now = new Date().toISOString();
    const job = {
      id: newJobId(),
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

  const updateJob = (id, patch) => {
    const job = userDailyJobs.get(id);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    return job;
  };

  const getJob = (id) => userDailyJobs.get(id);

  const getActiveJobs = () =>
    Array.from(userDailyJobs.values()).filter((j) => j.status === "queued" || j.status === "running");

  const persistJobRecord = async (jobId, payload) => {
    const job = userDailyJobs.get(jobId);
    if (job?.persisted) return;
    try {
      await datahubAxios.post(`/api/table/user_daily_score_jobs`, payload);
      if (job) job.persisted = true;
    } catch (err) {
      logger.error(`${fn} job=${jobId} persist failed ${safeStringify({ error: fmtErr(err) })}`);
    }
  };

  const fetchUserScoreWeights = async (userId, pipeId) => {
    const baseUrl = `${dbmanagerUrl}/auth/users/${userId}/score-weights`;
    const url =
      pipeId !== null && pipeId !== undefined
        ? `${baseUrl}/${encodeURIComponent(pipeId)}`
        : baseUrl;
    try {
      logger.debug?.(`${fn} fetch weights url=${url}`);
      const resp = await axios.get(url, { timeout: 8000 });
      logger.debug?.(`${fn} fetch weights resp=${safeStringify(resp.data)}`);
      return resp.data || {};
    } catch (err) {
      if (err?.response?.status === 404) {
        logger.warning(`${fn} weights not found, uso defaults ${safeStringify({ userId, pipeId, url, resp: err?.response?.data })}`);
        return {};
      }
      logger.error(`${fn} fetch weights error ${safeStringify({ url, error: err?.response?.data || err?.message || err })}`);
      throw err;
    }
  };

  const fetchMarketDailyBySymbol = async (symbol) => {
    const rows = await fetchAllPages(datahubAxios, `/api/table/market_daily?symbol=${encodeURIComponent(symbol)}`);
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
    try {
      const resp = await datahubAxios.get(`/api/table/market_daily?symbol=${encodeURIComponent(symbol)}&trade_date=${encodeURIComponent(targetDate)}&limit=1`);
      const rows = resp.data?.items || [];
      if (!rows.length) return null;
      const r = rows[0];
      return {
        date: normalizeMarketDate(r.trade_date || r.tradeDate || r.date),
        close: safeNum(r.close),
        adj_close: safeNum(r.adj_close ?? r.adjClose),
      };
    } catch (err) {
      logger.warning(`${fn} market-daily fetch close failed ${safeStringify({ symbol, date: targetDate, error: fmtErr(err) })}`);
      return null;
    }
  };

  /**
   * runJob - executes user daily scores for one user/pipe/date
   */
  const runJob = async (jobId, { userId, targetDate, pipeId, modelName, modelVersion, jobKey = "manual" }, { bus, redisStatusChannel, redisTelemetryChannel }) => {
    const jobFn = `${fn} job=${jobId}`;
    const startedAt = new Date().toISOString();
    updateJob(jobId, { status: "running", date: targetDate, pipeId, startedAt, userId, modelName, modelVersion });

    const userIdSafe = Number.isFinite(Number(userId)) ? Number(userId) : null;
    const pipeIdSafe = pipeId !== null && pipeId !== undefined && pipeId !== "" ? Number(pipeId) : 0;

    const publishTelemetry = async (payload) => {
      try { await bus?.publish?.(redisTelemetryChannel, payload); }
      catch (err) { logger.warning(`${fn} telemetry publish failed: ${fmtErr(err)}`); }
    };

    if (userIdSafe === null) {
      const finishedAt = new Date().toISOString();
      updateJob(jobId, { status: "error", error: "userId mancante", finishedAt });
      await publishTelemetry({ type: "userDailyScores", jobKey, jobId, startedAt, finishedAt, durationMs: 0, totalItems: 0, savedItems: 0, errorCount: 1, status: "FAILED", error: "userId mancante", __source: "tickerscanner" });
      await reportJobDone(bus, redisStatusChannel, jobId, { status: "FAILED", error: "userId mancante" });
      return;
    }

    try {
      logger.info(`${jobFn} start user=${userIdSafe} pipe=${pipeIdSafe} date=${targetDate} model=${modelName || "Manual update"}:${modelVersion || "1.0"}`);
      const weights = await fetchUserScoreWeights(userIdSafe, pipeIdSafe);
      const fundamentalsRows = await fetchAllPages(datahubAxios, `/api/table/universe`);

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
            logger.warning(`${jobFn} market fetch failed ${safeStringify({ symbol, error: fmtErr(err) })}`);
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
          updateJob(jobId, { errors: [...list, { symbol, error: "close mancante per data target", available: mdRows.length }] });
          continue;
        }

        const getPastClose = (days) => {
          const d = new Date(targetDate);
          d.setDate(d.getDate() - days);
          return findClose(mdRows, d.toISOString().slice(0, 10));
        };

        const r = (a, b) => (a != null && b != null && b !== 0 ? a / b - 1 : null);
        const r5 = r(p0, getPastClose(5));
        const r10 = r(p0, getPastClose(10));
        const r20 = r(p0, getPastClose(20));
        const r60 = r(p0, getPastClose(60));
        const r120 = r(p0, getPastClose(120));

        const raw_mom = weightedSum([[r20, weights.wt_raw_mom_20d], [r60, weights.wt_raw_mom_60d], [r120, weights.wt_raw_mom_120d]]);
        const raw_short = weightedSum([[r5, weights.wt_raw_short_5d], [r10, weights.wt_raw_short_10d]]);

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
        } catch { momentumObj = null; }

        const candles = mdRows.map((r) => ({
          t: r.date, o: r.open ?? null, h: r.high ?? null, l: r.low ?? null,
          c: r.close ?? r.adj_close ?? null, v: r.volume ?? null,
        }));
        const technicals = momentumCalc.computeTechnicals(candles, { symbol });
        computed.push({ symbol, raw_mom, raw_short, quality_score, risk_score, valuation_score, momentumObj, row, p0, technicals });
        if (raw_mom != null) rawMomValues.push(raw_mom);
        if (raw_short != null) rawShortValues.push(raw_short);
      }

      const results = [];
      const dailyScoreResults = [];
      for (const c of computed) {
        const job = userDailyJobs.get(jobId);
        if (!job || job.cancel) break;

        const momentum_score = c.raw_mom != null ? Math.round((percentileRank(rawMomValues, c.raw_mom) || 0) * 100) : null;
        const momentum_score_short = c.raw_short != null ? Math.round((percentileRank(rawShortValues, c.raw_short) || 0) * 100) : null;
        const total_score = weightedSum([
          [momentum_score, weights.wt_daily_momentum],
          [c.quality_score, weights.wt_daily_quality],
          [c.valuation_score, weights.wt_daily_valuation],
          [c.risk_score, weights.wt_daily_risk],
        ]);
        const marketRiskScore = computeMarketRiskScore(c.momentumObj, weights);
        const volumeScore = computeVolumeScore(c.momentumObj, weights);
        const { marketScore, shortRiskScore } = normalizeShortRisk({ ...(c.row || {}), risk_score: c.risk_score }, c.momentumObj, weights);
        const growthProbability = computeGrowthProbability({ ...(c.row || {}), risk_score: c.risk_score, momentum_score }, c.momentumObj, weights);

        results.push({
          symbol: c.symbol, score_date: targetDate, user_id: userIdSafe, pipe_id: pipeIdSafe,
          momentum_score, momentum_score_short, quality_score: c.quality_score,
          risk_score: c.risk_score, valuation_score: c.valuation_score,
          total_score: total_score != null ? Math.round(total_score) : null,
          market_score: marketScore ?? null, market_risk_score: marketRiskScore ?? null,
          short_risk_score: shortRiskScore ?? null, volume_score: volumeScore ?? null,
          growth_probability: growthProbability ?? null,
        });
        dailyScoreResults.push({
          symbol: c.symbol, score_date: targetDate,
          price: c.p0 ?? null,
          ...c.technicals,
          valuation_score: c.valuation_score, quality_score: c.quality_score, risk_score: c.risk_score,
          momentum_score, momentum_short_score: momentum_score_short,
          momentum_volume_score: volumeScore ?? null,
          total_score: total_score != null ? Math.round(total_score) : null,
          growth_probability: growthProbability ?? null,
          momentum_json: c.momentumObj ?? null,
          scores_json: { market_score: marketScore ?? null, market_risk_score: marketRiskScore ?? null, short_risk_score: shortRiskScore ?? null },
        });
      }

      // scoring model SCD2
      let modelId = null;
      const modelNameSafe = modelName || "Manual update";
      const modelVersionSafe = modelVersion || "1.0";
      try {
        const modelsResp = await datahubAxios.get(`/api/table/scoring_models?name=${encodeURIComponent(modelNameSafe)}`);
        const models = modelsResp.data?.items || [];
        const existingSameVersion = models.find((m) => m.version === modelVersionSafe);
        if (existingSameVersion?.id) {
          modelId = existingSameVersion.id;
        } else {
          const active = models.find((m) => m.version === modelVersionSafe && (m.valid_to === null || m.valid_to === undefined));
          if (active?.id) {
            try { await datahubAxios.put(`/api/table/scoring_models/${active.id}`, { valid_to: targetDate }); }
            catch (err) { logger.warning(`${jobFn} closing scoring_model failed ${safeStringify({ id: active.id, error: fmtErr(err) })}`); }
          }
          const insertResp = await datahubAxios.post(`/api/table/scoring_models`, { name: modelNameSafe, version: modelVersionSafe, valid_from: targetDate, valid_to: null, params_json: weights });
          modelId = insertResp.data?.id ?? insertResp.data?.insertId ?? null;
        }
      } catch (err) {
        logger.warning(`${jobFn} scoring model insert failed ${safeStringify({ name: modelNameSafe, version: modelVersionSafe, error: fmtErr(err) })}`);
      }

      const getFundHistoryId = async (symbol) => {
        try {
          const resp = await datahubAxios.get(`/api/table/fundamentals_history?symbol=${encodeURIComponent(symbol)}`);
          const rows = resp.data?.items || resp.data || [];
          const match = rows.find((r) => {
            const from = (r.valid_from || "").slice(0, 10);
            const to = r.valid_to ? r.valid_to.slice(0, 10) : null;
            return from <= targetDate && (to === null || to > targetDate);
          });
          return match?.id ?? null;
        } catch (err) {
          logger.warning(`${jobFn} fundamentals_history lookup failed ${safeStringify({ symbol, error: fmtErr(err) })}`);
          return null;
        }
      };

      let saved = 0;
      for (const r of results) {
        const job = userDailyJobs.get(jobId);
        if (!job || job.cancel) break;
        const fhId = await getFundHistoryId(r.symbol);
        const payload = { ...r, model_id: modelId, model_version: modelVersionSafe, fundamentals_history_id: fhId };
        try {
          await datahubAxios.post(`/api/table/scores_daily`, payload);
          saved += 1;
        } catch {
          // scores_daily PK is composite: (symbol, score_date, user_id, pipe_id)
          try {
            await datahubAxios.put(
              `/api/table/scores_daily/${encodeURIComponent(r.symbol)}/${encodeURIComponent(r.score_date)}/${encodeURIComponent(userIdSafe)}/${encodeURIComponent(pipeIdSafe)}`,
              payload
            );
            saved += 1;
          } catch (err2) {
            const job2 = userDailyJobs.get(jobId);
            const list = job2?.errors || [];
            updateJob(jobId, { errors: [...list, { symbol: r.symbol, date: r.score_date, error: fmtErr(err2) }] });
          }
        }
      }

      for (const ds of dailyScoreResults) {
        const job = userDailyJobs.get(jobId);
        if (!job || job.cancel) break;
        try {
          await datahubAxios.post(`/api/table/daily_scores`, ds);
        } catch {
          try {
            await datahubAxios.put(
              `/api/table/daily_scores/${encodeURIComponent(ds.symbol)}/${encodeURIComponent(ds.score_date)}`,
              ds
            );
          } catch (err2) {
            logger.warning(`${jobFn} daily_scores upsert failed symbol=${ds.symbol} ${safeStringify({ error: fmtErr(err2) })}`);
          }
        }
      }

      const finishedAt = new Date().toISOString();
      const finalStatus = userDailyJobs.get(jobId)?.cancel ? "cancelled" : "completed";
      updateJob(jobId, { status: finalStatus, saved, total: results.length, finishedAt });
      const job = userDailyJobs.get(jobId);
      await persistJobRecord(jobId, {
        job_id: jobId, user_id: userIdSafe, pipe_id: pipeIdSafe, status: finalStatus,
        target_date: targetDate, model_name: modelNameSafe, model_version: modelVersionSafe,
        total_items: results.length, saved_items: saved, error_count: job?.errors?.length || 0,
        errors_json: job?.errors || [], params_json: weights,
        started_at: toSqlDateTime(startedAt), finished_at: toSqlDateTime(finishedAt),
      });
      const telemetryStatus = finalStatus === "cancelled" ? "CANCELLED" : "COMPLETED";
      await publishTelemetry({ type: "userDailyScores", jobKey, jobId, startedAt, finishedAt, durationMs: Date.now() - new Date(startedAt).getTime(), userId: userIdSafe, pipeId: pipeIdSafe, targetDate, totalItems: results.length, savedItems: saved, errorCount: job?.errors?.length || 0, status: telemetryStatus, __source: "tickerscanner" });
      await reportJobDone(bus, redisStatusChannel, jobId, { status: telemetryStatus, summary: { date: targetDate, pipeId: pipeIdSafe, total: results.length, saved, errors: job?.errors?.length || 0 } });
      logger.info(`${jobFn} ${finalStatus} ${safeStringify({ date: targetDate, pipeId: pipeIdSafe, total: results.length, saved, errors: job?.errors?.length || 0 })}`);
    } catch (err) {
      const errorStr = fmtErr(err);
      const finishedAt = new Date().toISOString();
      updateJob(jobId, { status: "error", error: errorStr, finishedAt });
      const job = userDailyJobs.get(jobId);
      await persistJobRecord(jobId, {
        job_id: jobId, user_id: userIdSafe, pipe_id: pipeIdSafe, status: "error",
        target_date: targetDate, model_name: modelName || "Manual update", model_version: modelVersion || "1.0",
        total_items: job?.total || 0, saved_items: job?.saved || 0,
        error_count: (job?.errors?.length || 0) + 1, errors_json: [...(job?.errors || []), { error: errorStr }],
        started_at: toSqlDateTime(startedAt), finished_at: toSqlDateTime(finishedAt),
      });
      await publishTelemetry({ type: "userDailyScores", jobKey, jobId, startedAt, finishedAt, durationMs: Date.now() - new Date(startedAt).getTime(), userId: userIdSafe, pipeId: pipeIdSafe, targetDate, totalItems: job?.total || 0, savedItems: job?.saved || 0, errorCount: (job?.errors?.length || 0) + 1, status: "FAILED", error: errorStr, __source: "tickerscanner" });
      await reportJobDone(bus, redisStatusChannel, jobId, { status: "FAILED", error: errorStr });
      logger.error(`${jobFn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
    }
  };

  /**
   * launchJobsForUser - creates and starts user daily jobs (one per pipe or single)
   */
  const launchJobsForUser = async ({ userId, targetDate, pipeId, modelName, modelVersion, jobKey }, ctx) => {
    if (pipeId === undefined) {
      const url = `${dbmanagerUrl}/auth/users/${userId}/score-weights`;
      const resp = await axios.get(url, { timeout: 8000 });
      const list = Array.isArray(resp.data) ? resp.data : [];
      if (!list.length) return { ok: false, status: 404, error: "Pesi/pipe non trovati per l'utente" };
      const jobs = [];
      for (const row of list) {
        const pid = row.pipe_id ?? row.pipeId ?? 0;
        const job = createJob();
        updateJob(job.id, { date: targetDate, pipeId: pid, userId, modelName, modelVersion });
        setImmediate(() => runJob(job.id, { userId, targetDate, pipeId: pid, modelName, modelVersion, jobKey }, ctx));
        jobs.push(job.id);
      }
      return { ok: true, type: "async", jobIds: jobs, jobKey };
    }

    const job = createJob();
    updateJob(job.id, { date: targetDate, pipeId, userId, modelName, modelVersion });
    setImmediate(() => runJob(job.id, { userId, targetDate, pipeId, modelName, modelVersion, jobKey }, ctx));
    return { ok: true, type: "async", jobId: job.id, jobKey };
  };

  return {
    createJob, updateJob, getJob, getActiveJobs, persistJobRecord,
    runJob, launchJobsForUser, normalizeMarketDate, computeDelta,
  };
}

module.exports = { createUserDailyService };
