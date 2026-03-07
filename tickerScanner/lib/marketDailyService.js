"use strict";

const axios = require("axios");
const { reportJobDone } = require("../../shared/jobReporter");
const { safeNum } = require("./scoreDecorator");

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

const getFmpApiKey = () => process.env.FMP_API_KEY || process.env.FMP_KEY || null;

/**
 * createMarketDailyService - factory for market daily job management
 *
 * @param {object} deps
 * @param {object} deps.logger
 * @param {string} deps.dbmanagerUrl
 * @param {object} deps.datahubAxios  axios instance with datahub adapter
 */
function createMarketDailyService({ logger, dbmanagerUrl, datahubAxios }) {
  const fn = "marketDailyService";

  // ---- In-memory job state ----
  const marketDailyJobs = new Map();

  const newJobId = () => `market_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const createJob = () => {
    const now = new Date().toISOString();
    const job = {
      id: newJobId(),
      status: "queued",
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

  const updateJob = (id, patch) => {
    const job = marketDailyJobs.get(id);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    return job;
  };

  const getJob = (id) => marketDailyJobs.get(id);

  const getActiveJobs = () =>
    Array.from(marketDailyJobs.values()).filter((j) => j.status === "queued" || j.status === "running");

  const persistJobRecord = async (jobId, payload) => {
    const job = marketDailyJobs.get(jobId);
    if (job?.persisted) return;
    try {
      await datahubAxios.post(`/api/table/market_daily_jobs`, payload);
      if (job) job.persisted = true;
    } catch (err) {
      logger.error(`${fn} job=${jobId} persist failed ${safeStringify({ error: fmtErr(err) })}`);
    }
  };

  /**
   * runJob - executes the market daily update for all symbols
   * @param {string} jobId
   * @param {string} jobKey
   * @param {object} ctx - { bus, redisStatusChannel, redisTelemetryChannel }
   */
  const runJob = async (jobId, jobKey = "manual", { bus, redisStatusChannel, redisTelemetryChannel }) => {
    logger.info(`${fn} update-market-daily start job=${jobId} jobKey=${jobKey}`);
    const startedAt = new Date().toISOString();
    const job = updateJob(jobId, { status: "running", startedAt });
    if (!job) return;

    const publishTelemetry = async (payload) => {
      try {
        await bus?.publish?.(redisTelemetryChannel, payload);
      } catch (err) {
        logger.warning(`${fn} telemetry publish failed: ${fmtErr(err)}`);
      }
    };

    const apiKey = getFmpApiKey();
    if (!apiKey) {
      const finishedAt = new Date().toISOString();
      updateJob(jobId, { status: "error", error: "FMP_API_KEY non configurata", finishedAt });
      await persistJobRecord(jobId, {
        job_id: jobId, status: "error", total_symbols: 0, processed: 0, inserted: 0, updated: 0,
        error_count: 1, errors_json: [{ error: "FMP_API_KEY non configurata" }], params_json: {},
        started_at: toSqlDateTime(startedAt), finished_at: toSqlDateTime(finishedAt),
      });
      await publishTelemetry({ type: "updateMarketDaily", jobKey, jobId, startedAt, finishedAt, durationMs: 0, totalSymbols: 0, processed: 0, inserted: 0, updated: 0, errorCount: 1, status: "FAILED", error: "FMP_API_KEY non configurata", __source: "tickerscanner" });
      await reportJobDone(bus, redisStatusChannel, jobId, { status: "FAILED", error: "FMP_API_KEY non configurata" });
      return;
    }

    try {
      const rows = await fetchAllPages(datahubAxios, `/api/table/universe`);
      const symbols = [...new Set(rows.map((r) => String(r.symbol || "").toUpperCase()).filter(Boolean))];
      updateJob(jobId, { totalSymbols: symbols.length });
      logger.info(`${fn} job=${jobId} symbols=${symbols.length}`);

      const concurrencyRaw = Number(process.env.MARKET_DAILY_CONCURRENCY);
      const concurrency = Number.isFinite(concurrencyRaw) && concurrencyRaw > 0 ? Math.floor(concurrencyRaw) : 5;
      const FMP_SPACING_BASE = 200;
      const FMP_SPACING_MAX = 2000;
      let fmpSpacingMs = FMP_SPACING_BASE;
      let nextFmpAt = 0;
      let fmpOkStreak = 0;
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitForFmpSlot = async () => {
        const now = Date.now();
        const delay = Math.max(0, nextFmpAt - now);
        nextFmpAt = Math.max(now, nextFmpAt) + fmpSpacingMs;
        if (delay > 0) await wait(delay);
      };

      const upsertBulk = async (bulkRows, symbol) => {
        const current = marketDailyJobs.get(jobId);
        if (!current || current.cancel) return null;
        const started = Date.now();
        try {
          const postResp = await axios.post(`${dbmanagerUrl}/api/custom/marketDaily/bulk`, bulkRows);
          if (postResp.data?.ok === false) throw new Error(postResp.data.error || "POST bulk market_daily failed");
          const total = Number(postResp.data?.total ?? bulkRows.length) || bulkRows.length;
          const affected = Number(postResp.data?.affectedRows ?? 0) || 0;
          const updatedEst = affected > total ? affected - total : 0;
          const insertedEst = total - updatedEst;
          const cur = marketDailyJobs.get(jobId);
          if (cur) updateJob(jobId, { inserted: (cur.inserted || 0) + insertedEst, updated: (cur.updated || 0) + updatedEst });
          return { inserted: insertedEst, updated: updatedEst, ms: Date.now() - started };
        } catch (err) {
          const cur = marketDailyJobs.get(jobId);
          const list = cur?.errors || [];
          const errMsg = fmtErr(err);
          updateJob(jobId, { errors: [...list, { symbol, error: errMsg }] });
          logger.error(`${fn} job=${jobId} bulk upsert error ${safeStringify({ symbol, error: errMsg })}`);
          return { inserted: 0, updated: 0, ms: Date.now() - started, error: errMsg };
        }
      };

      const pickNum = (obj, keys = []) => {
        for (const k of keys) {
          if (obj && obj[k] !== undefined && obj[k] !== null) {
            const n = safeNum(obj[k]);
            if (n !== null) return n;
          }
        }
        return null;
      };

      let sampleLogged = 0;

      const processSymbol = async (sym) => {
        const cur = marketDailyJobs.get(jobId);
        if (!cur || cur.cancel) return;
        const fmpUrl = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(apiKey)}`;
        let data = [];
        const fmpStart = Date.now();
        const maxRetries = 3;
        let attempt = 0;
        let lastErr = null;

        while (attempt < maxRetries) {
          attempt++;
          try {
            await waitForFmpSlot();
            const resp = await axios.get(fmpUrl, { timeout: 15000 });
            data = Array.isArray(resp.data?.historical) ? resp.data.historical : Array.isArray(resp.data) ? resp.data : [];
            fmpOkStreak++;
            if (fmpOkStreak >= 30 && fmpSpacingMs > FMP_SPACING_BASE) {
              fmpSpacingMs = Math.max(FMP_SPACING_BASE, fmpSpacingMs - 100);
              fmpOkStreak = 0;
              logger.info(`${fn} job=${jobId} spacing recovery -> ${fmpSpacingMs}ms`);
            }
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            if (err.response?.status === 429) {
              const prevSpacing = fmpSpacingMs;
              fmpSpacingMs = Math.min(fmpSpacingMs * 2, FMP_SPACING_MAX);
              fmpOkStreak = 0;
              const backoffMs = 1000 * Math.pow(2, attempt - 1);
              logger.warning(`${fn} job=${jobId} 429 on ${sym} – spacing ${prevSpacing}->${fmpSpacingMs}ms, retry in ${backoffMs}ms`);
              await wait(backoffMs);
              continue;
            }
            break;
          }
        }

        if (lastErr) {
          const cur2 = marketDailyJobs.get(jobId);
          const list = cur2?.errors || [];
          const errMsg = fmtErr(lastErr);
          updateJob(jobId, { errors: [...list, { symbol: sym, error: errMsg, url: fmpUrl }] });
          logger.error(`${fn} job=${jobId} fetch error ${safeStringify({ symbol: sym, error: errMsg })}`);
          logger.trace?.(`${fn} job=${jobId} fmp fetch error ${safeStringify({ symbol: sym, ms: Date.now() - fmpStart, error: errMsg })}`);
          return;
        }

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
            logger.info(`${fn} job=${jobId} sample payload ${safeStringify(payload)}`);
            sampleLogged += 1;
          }
          pending.push(payload);
        }

        const chunkSize = 300;
        for (let i = 0; i < pending.length; i += chunkSize) {
          const cur3 = marketDailyJobs.get(jobId);
          if (!cur3 || cur3.cancel) break;
          await upsertBulk(pending.slice(i, i + chunkSize), sym);
        }

        const cur4 = marketDailyJobs.get(jobId);
        if (cur4 && !cur4.cancel) updateJob(jobId, { processed: (cur4.processed || 0) + 1 });
      };

      let nextIdx = 0;
      const workers = Array.from({ length: Math.min(concurrency, symbols.length) }, () => async () => {
        while (true) {
          const cur = marketDailyJobs.get(jobId);
          if (!cur || cur.cancel) return;
          const sym = symbols[nextIdx++];
          if (!sym) return;
          await processSymbol(sym);
        }
      });
      await Promise.all(workers.map((fn) => fn()));

      const end = marketDailyJobs.get(jobId);
      const finishedAt = new Date().toISOString();
      const finalStatus = end?.cancel ? "cancelled" : "completed";
      const finalStatusUpper = end?.cancel ? "CANCELLED" : "COMPLETED";

      updateJob(jobId, { status: finalStatus, finishedAt });
      await persistJobRecord(jobId, {
        job_id: jobId, status: finalStatus,
        total_symbols: end?.totalSymbols || 0, processed: end?.processed || 0,
        inserted: end?.inserted || 0, updated: end?.updated || 0,
        error_count: end?.errors?.length || 0, errors_json: end?.errors || [],
        params_json: {}, started_at: toSqlDateTime(startedAt), finished_at: toSqlDateTime(finishedAt),
      });
      await publishTelemetry({
        type: "updateMarketDaily", jobKey, jobId, startedAt, finishedAt,
        durationMs: Date.now() - new Date(startedAt).getTime(),
        totalSymbols: end?.totalSymbols || 0, processed: end?.processed || 0,
        inserted: end?.inserted || 0, updated: end?.updated || 0,
        errorCount: end?.errors?.length || 0, status: finalStatusUpper, __source: "tickerscanner",
      });
      await reportJobDone(bus, redisStatusChannel, jobId, { status: finalStatusUpper });
      logger.info(`${fn} job=${jobId} ${finalStatus} ${safeStringify({ totalSymbols: end?.totalSymbols, processed: end?.processed, inserted: end?.inserted, updated: end?.updated, errors: end?.errors?.length || 0 })}`);
      if (end?.errors?.length) {
        logger.error(`${fn} job=${jobId} completed with errors ${safeStringify(end.errors.slice(-5))}`);
      }
    } catch (err) {
      const errorStr = fmtErr(err);
      const finishedAt = new Date().toISOString();
      updateJob(jobId, { status: "error", error: errorStr, finishedAt });
      await persistJobRecord(jobId, {
        job_id: jobId, status: "error",
        total_symbols: job?.totalSymbols || 0, processed: job?.processed || 0,
        inserted: job?.inserted || 0, updated: job?.updated || 0,
        error_count: (job?.errors?.length || 0) + 1,
        errors_json: [...(job?.errors || []), { error: errorStr }],
        params_json: {}, started_at: toSqlDateTime(startedAt), finished_at: toSqlDateTime(finishedAt),
      });
      await publishTelemetry({
        type: "updateMarketDaily", jobKey, jobId, startedAt, finishedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(startedAt).getTime(),
        totalSymbols: job?.totalSymbols || 0, processed: job?.processed || 0,
        inserted: job?.inserted || 0, updated: job?.updated || 0,
        errorCount: (job?.errors?.length || 0) + 1, status: "FAILED", error: errorStr, __source: "tickerscanner",
      });
      await reportJobDone(bus, redisStatusChannel, jobId, { status: "FAILED", error: errorStr });
      logger.error(`${fn} job=${jobId} error ${safeStringify(err?.response?.data || err?.message || err)}`);
    }
  };

  return { createJob, updateJob, getJob, getActiveJobs, persistJobRecord, runJob };
}

module.exports = { createMarketDailyService };
