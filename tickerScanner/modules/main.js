"use strict";

const crypto = require("crypto");
const axios = require("axios");
const { asBool } = require("../../shared/helpers");
const { createDatahubAdapter } = require("../../shared/datahubAdapter");
const BaseService = require("../../shared/BaseService");

const {
  createScanJob,
  updateScanJob,
  getScanJob,
  getActiveJobs,
  cancelScanJob,
  buildFundamentalsRecord,
} = require("./scanJob");

const { createMarketDailyService } = require("../lib/marketDailyService");
const { createUserDailyService } = require("../lib/userDailyService");
const { createUniverseScanService } = require("../lib/universeService");
const { reportJobDone } = require("../../shared/jobReporter");

const ScreenerService = require("./screenerService");
const FmpFundamentalsService = require("./fmpFundamentalsService");
const ScoringService = require("./scoringService");
const MomentumCalculator = require("./momentumCalculator");
const FundamentalsService = require("./fundamentalsService");

const { getSetting, getConfigString, getConfigInt } = require("../../shared/loadSettings");

// ---- helpers ----

const numOrNull = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toSqlDateTime = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace("T", " ");
};

function buildHistoryVersionHash(rec) {
  const fields = [
    rec?.sector ?? "",
    rec?.industry ?? "",
    rec?.roe ?? "",
    rec?.roa ?? "",
    rec?.op_margin ?? "",
    rec?.piotroski ?? "",
    rec?.debt_equity ?? "",
    rec?.altman_z ?? "",
    rec?.market_cap ?? "",
    rec?.beta ?? "",
    rec?.is_etf ?? "",
    rec?.is_actively_trading ?? "",
    rec?.is_adr ?? "",
    rec?.is_fund ?? "",
  ];
  return crypto.createHash("sha256").update(fields.join("|")).digest("hex");
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Run async tasks with bounded concurrency.
 * Returns an array of results in the same order as `items`.
 * Individual errors are caught and stored as-is (caller decides how to handle).
 */
async function runConcurrent(items, fn, limit) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIdx = 0;
  const worker = async () => {
    while (nextIdx < items.length) {
      const i = nextIdx++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = { __error: err };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function mapDbRowToScoredRecord(row) {
  let momentum = {};
  if (row.momentum_json) {
    if (typeof row.momentum_json === "string") {
      try { momentum = JSON.parse(row.momentum_json); } catch { momentum = {}; }
    } else {
      momentum = row.momentum_json;
    }
  }
  return {
    symbol: row.symbol,
    sector: row.sector,
    industry: row.industry,
    country: row.country,
    scores: {
      valuation: {
        score: row.valuation_score,
        components: { pe: row.pe, pb: row.pb, dcfUpside: row.dcf_upside, peScore: row.pe_score, pbScore: row.pb_score, dcfScore: row.dcf_score, ratingScore: row.rating_score },
      },
      quality: {
        score: row.quality_score,
        components: { roe: row.roe, roa: row.roa, opMargin: row.op_margin, piotroski: row.piotroski, roeScore: row.roe_score, roaScore: row.roa_score, opMarginScore: row.op_margin_score, piotScore: row.piot_score },
      },
      risk: {
        score: row.risk_score,
        components: { beta: row.beta, debtEq: row.debt_equity, altmanZ: row.altman_z, betaScore: row.beta_score, debtEqScore: row.debt_equity_score, altmanScore: row.altman_z_score },
      },
      momentum,
      marketRiskScore: row.market_risk_score ?? null,
      shortRiskScore: row.short_risk_score ?? null,
      totalScore: row.total_score,
    },
  };
}

// =========================================================
// TickerScanner — extends BaseService
// =========================================================
class TickerScanner extends BaseService {
  constructor() {
    super({
      microservice: "tickerScanner",
      moduleName: "main",
      moduleVersion: "0.1.0",
      defaultPort: 3013,
    });

    // Sub-services (all instantiated in constructor since this.logger and this.dbmanagerUrl are available from super())
    this.fmpFundamentals = new FmpFundamentalsService({ logger: this.logger, getSetting });
    this.screener = new ScreenerService({ logger: this.logger, getSetting });
    this.scoringService = new ScoringService({ logger: this.logger });
    this.momentumCalculator = new MomentumCalculator({
      logger: this.logger,
      cachemanagerUrl: this.cachemanagerUrl,
      tf: getConfigString("MOMENTUM_TF", "1Day"),
      lookbackDays: getConfigInt("MOMENTUM_LOOKBACK_DAYS", 365),
    });
    this.fundamentalService = new FundamentalsService({ logger: this.logger, dbmanagerUrl: this.dbmanagerUrl });

    // Job services — shared singletons accessible from route files via getService()
    const datahubAxios = createDatahubAdapter(axios.create({ baseURL: this.dbmanagerUrl, timeout: 8000 }));
    this.datahubAxios = datahubAxios;
    this.marketDailySvc = createMarketDailyService({ logger: this.logger, dbmanagerUrl: this.dbmanagerUrl, datahubAxios });
    this.userDailySvc = createUserDailyService({ logger: this.logger, dbmanagerUrl: this.dbmanagerUrl, datahubAxios });

    // Phase 1 — Universe scan service
    this.universeSvc = createUniverseScanService({
      logger:          this.logger,
      datahubAxios,
      fmpFundamentals: this.fmpFundamentals,
      screener:        this.screener,
    });
  }

  // =========================================================
  // Custom init hook (called by BaseService.init() after settings load)
  // =========================================================
  async _onInit() {
    this.logger.info("[_onInit] tickerScanner ready");
  }

  // =========================================================
  // SCAN JOB MANAGEMENT
  // =========================================================

  async startScanJob(filterOverrides = {}, options = {}) {
    const forceRefresh = !!options.forceRefresh;
    const overrides = { ...filterOverrides };
    const screener = await this.runScreener(overrides);
    const data = screener?.data || [];
    const totalRaw = data.length;

    const job = createScanJob(totalRaw);
    updateScanJob(job.id, { params: { overrides, forceRefresh } });
    this.logger.info(`[tickScanner] Scan job ${job.id} created with ${totalRaw} raw tickers (forceRefresh=${forceRefresh})`);

    setImmediate(() => {
      this._runScanJob(job.id, overrides, { forceRefresh }).catch((err) => {
        this.logger.error(`[tickScanner] Scan job ${job.id} failed: ${err.message}`);
        updateScanJob(job.id, { status: "error", error: err.message });
      });
    });

    return { jobId: job.id, totalRawTickers: totalRaw, status: job.status };
  }

  async persistScanJobRecord(jobId) {
    const job = getScanJob(jobId);
    if (!job || job.persisted) return;
    const payload = {
      job_id: job.id,
      status: job.status,
      total_raw_tickers: job.totalRawTickers ?? null,
      total_processed: job.totalProcessed ?? null,
      db_hits: job.dbHits ?? null,
      new_calculated: job.newCalculated ?? null,
      error: job.error ?? null,
      errors_json: job.errors ?? [],
      params_json: job.params ?? {},
      started_at: toSqlDateTime(job.startedAt || job.createdAt),
      finished_at: toSqlDateTime(job.finishedAt),
    };
    try {
      await this.datahubAxios.post(`/api/table/ticker_scan_jobs`, payload);
      job.persisted = true;
    } catch (err) {
      this.logger.error(`[tickScanner] persist scan job ${jobId} error: ${err?.response?.data?.error || err?.message || String(err)}`);
    }
  }

  async _runScanJob(jobId, filterOverrides = {}, options = {}) {
    const startedAt = new Date().toISOString();
    updateScanJob(jobId, { status: "running", startedAt });
    try {
      const result = await this.scanAndScoreUniverse(filterOverrides, { ...options, jobId });
      const finalJob = getScanJob(jobId);
      if (finalJob?.cancel || finalJob?.status === "cancelled") {
        updateScanJob(jobId, { status: "cancelled", finishedAt: new Date().toISOString() });
        this.logger.info(`[tickScanner] Scan job ${jobId} cancelled`);
        await this.persistScanJobRecord(jobId);
        return;
      }
      updateScanJob(jobId, { status: "completed", totalProcessed: result.count, dbHits: result.dbHits, newCalculated: result.newCalculated, finishedAt: new Date().toISOString() });
      this.logger.info(`[tickScanner] Scan job ${jobId} completed: total=${result.count}, dbHits=${result.dbHits}, new=${result.newCalculated}`);
      await this.persistScanJobRecord(jobId);
    } catch (err) {
      if (err?.code === "CANCELLED") {
        updateScanJob(jobId, { status: "cancelled", finishedAt: new Date().toISOString() });
        this.logger.info(`[tickScanner] Scan job ${jobId} cancelled`);
        await this.persistScanJobRecord(jobId);
        return;
      }
      updateScanJob(jobId, { status: "error", error: err?.message || String(err), finishedAt: new Date().toISOString() });
      this.logger.error(`[tickScanner] Scan job ${jobId} error: ${err?.message || String(err)}`);
      await this.persistScanJobRecord(jobId);
    }
  }

  getScanStatus(jobId) {
    const job = getScanJob(jobId);
    if (!job) { const err = new Error("Job not found"); err.code = "NOT_FOUND"; throw err; }
    return job;
  }

  getRunningScanJobs() {
    return getActiveJobs();
  }

  cancelScanJob(jobId) {
    const job = cancelScanJob(jobId);
    if (!job) { const err = new Error("Job not found"); err.code = "NOT_FOUND"; throw err; }
    if (!job.finishedAt) {
      updateScanJob(jobId, { status: "cancelled", finishedAt: new Date().toISOString() });
      this.persistScanJobRecord(jobId);
    }
    return job;
  }

  // =========================================================
  // UNIVERSE SCAN (Phase 1 — bi-weekly)
  // =========================================================

  /**
   * Crea un job in-memory e avvia lo scan dell'universo in background.
   * Scrive solo dati fondamentali FMP nella tabella `universe`.
   */
  async startUniverseScan(filterOverrides = {}, options = {}) {
    const forceRefresh = !!options.forceRefresh;
    const job = createScanJob(0);   // totalRawTickers sarà aggiornato durante lo scan
    updateScanJob(job.id, { type: "universe", params: { filterOverrides, forceRefresh } });

    this.logger.info(
      `[tickerScanner] Universe scan job ${job.id} creato (forceRefresh=${forceRefresh})`
    );

    setImmediate(() => {
      this._runUniverseScanJob(job.id, filterOverrides, { forceRefresh }).catch((err) => {
        this.logger.error(`[tickerScanner] Universe scan job ${job.id} failed: ${err.message}`);
        updateScanJob(job.id, { status: "error", error: err.message });
      });
    });

    return { jobId: job.id, status: job.status };
  }

  async _runUniverseScanJob(jobId, filterOverrides = {}, options = {}) {
    const startedAt = new Date().toISOString();
    updateScanJob(jobId, { status: "running", startedAt });
    try {
      const result = await this.universeSvc.scanUniverse(filterOverrides, { ...options, jobId });

      const job = getScanJob(jobId);
      if (job?.cancel || job?.status === "cancelled") {
        updateScanJob(jobId, { status: "cancelled", finishedAt: new Date().toISOString() });
        this.logger.info(`[tickerScanner] Universe scan job ${jobId} cancelled`);
        await reportJobDone(this.bus, this.redisStatusChannel, jobId, { status: "CANCELLED" });
        return;
      }

      updateScanJob(jobId, {
        status:         "completed",
        totalProcessed: result.count,
        dbHits:         result.skipped,
        newCalculated:  result.inserted + result.updated,
        finishedAt:     new Date().toISOString(),
        errors:         result.errors,
      });
      this.logger.info(
        `[tickerScanner] Universe scan job ${jobId} completed: ` +
        `total=${result.count}, inserted=${result.inserted}, updated=${result.updated}, skipped=${result.skipped}`
      );
      await reportJobDone(this.bus, this.redisStatusChannel, jobId, {
        status: "COMPLETED",
        summary: { count: result.count, inserted: result.inserted, updated: result.updated, skipped: result.skipped },
      });
    } catch (err) {
      if (err?.code === "CANCELLED") {
        updateScanJob(jobId, { status: "cancelled", finishedAt: new Date().toISOString() });
        this.logger.info(`[tickerScanner] Universe scan job ${jobId} cancelled`);
        await reportJobDone(this.bus, this.redisStatusChannel, jobId, { status: "CANCELLED" });
        return;
      }
      updateScanJob(jobId, {
        status:     "error",
        error:      err?.message || String(err),
        finishedAt: new Date().toISOString(),
      });
      this.logger.error(`[tickerScanner] Universe scan job ${jobId} error: ${err?.message || String(err)}`);
      await reportJobDone(this.bus, this.redisStatusChannel, jobId, { status: "FAILED", error: err?.message || String(err) });
    }
  }

  getUniverseScanStatus(jobId) {
    const job = getScanJob(jobId);
    if (!job) { const e = new Error("Job not found"); e.code = "NOT_FOUND"; throw e; }
    return job;
  }

  getActiveUniverseJobs() {
    // Restituisce solo i job di tipo universe attivi
    return getActiveJobs().filter((j) => j.type === "universe");
  }

  cancelUniverseScanJob(jobId) {
    const job = getScanJob(jobId);
    if (!job) { const e = new Error("Job not found"); e.code = "NOT_FOUND"; throw e; }
    cancelScanJob(jobId);
    if (!job.finishedAt) {
      updateScanJob(jobId, { status: "cancelled", finishedAt: new Date().toISOString() });
    }
    return getScanJob(jobId);
  }

  // =========================================================
  // SCREENER
  // =========================================================

  async runScreener(filterOverrides = {}) {
    return this.screener.runScreener(filterOverrides);
  }

  // =========================================================
  // SCAN AND SCORE UNIVERSE
  // =========================================================

  async scanAndScoreUniverse(filterOverrides = {}, options = {}) {
    const forceRefresh = !!options.forceRefresh;
    const jobId = options.jobId;
    let processedCount = 0;
    let dbHitsCount = 0;
    let newCalculatedCount = 0;

    const syncJobProgress = () => {
      if (!jobId) return;
      updateScanJob(jobId, { totalProcessed: processedCount, dbHits: dbHitsCount, newCalculated: newCalculatedCount });
    };
    const abortIfCancelled = () => {
      if (!jobId) return;
      const job = getScanJob(jobId);
      if (job?.cancel || job?.status === "cancelled") {
        const e = new Error("Scan cancelled");
        e.code = "CANCELLED";
        throw e;
      }
    };

    abortIfCancelled();
    const today = new Date().toISOString().slice(0, 10);

    const screener = await this.runScreener(filterOverrides);
    abortIfCancelled();
    const data = screener?.data || [];
    const symbols = data.map((d) => d.symbol).filter(Boolean);

    if (!symbols.length) {
      this.logger.warning("[scanAndScoreUniverse] Nessun simbolo dallo screener");
      return { count: 0, dbHits: 0, newCalculated: 0, results: [] };
    }

    this.logger.info(`[scanAndScoreUniverse] Screener ha restituito ${symbols.length} simboli`);

    let existingRows = [];
    try {
      const resp = await axios.get(`${this.dbmanagerUrl}/fundamentals`, { timeout: 15000 });
      existingRows = Array.isArray(resp.data) ? resp.data : [];
    } catch (e) {
      this.logger.error(`[scanAndScoreUniverse] Errore GET /fundamentals: ${e.message}`);
    }

    const existingMap = new Map(existingRows.filter((r) => r.symbol).map((r) => [r.symbol, r]));
    const existingRecords = [];
    const missingSymbols = [];

    for (const sym of symbols) {
      abortIfCancelled();
      const row = existingMap.get(sym);
      if (row && !forceRefresh) {
        existingRecords.push(mapDbRowToScoredRecord(row));
        processedCount += 1;
        dbHitsCount += 1;
        if (processedCount % 10 === 0) syncJobProgress();
      } else {
        missingSymbols.push(sym);
      }
    }
    syncJobProgress();

    this.logger.info(`[scanAndScoreUniverse] Trovati ${existingRecords.length} in DB, mancanti: ${missingSymbols.length} (forceRefresh=${forceRefresh})`);

    const batchSizeRaw = getConfigInt("SCAN_MISSING_BATCH", 50);
    const batchSize = Number.isFinite(batchSizeRaw) && batchSizeRaw > 0 ? Math.floor(batchSizeRaw) : 50;
    const bulkSizeRaw = getConfigInt("SCAN_BULK_SIZE", 200);
    const bulkSize = Number.isFinite(bulkSizeRaw) && bulkSizeRaw > 0 ? Math.floor(bulkSizeRaw) : 200;
    const fmpConcurrencyRaw = getConfigInt("SCAN_FMP_CONCURRENCY", 3);
    const fmpConcurrency = Number.isFinite(fmpConcurrencyRaw) && fmpConcurrencyRaw > 0 ? Math.floor(fmpConcurrencyRaw) : 3;
    const momentumConcurrencyRaw = getConfigInt("SCAN_MOMENTUM_CONCURRENCY", 5);
    const momentumConcurrency = Number.isFinite(momentumConcurrencyRaw) && momentumConcurrencyRaw > 0 ? Math.floor(momentumConcurrencyRaw) : 5;
    const upsertConcurrencyRaw = getConfigInt("SCAN_UPSERT_CONCURRENCY", 5);
    const upsertConcurrency = Number.isFinite(upsertConcurrencyRaw) && upsertConcurrencyRaw > 0 ? Math.floor(upsertConcurrencyRaw) : 5;

    const newScoredRecords = [];
    const batches = chunkArray(missingSymbols, batchSize);

    for (const batch of batches) {
      abortIfCancelled();

      // Phase 1 — FMP fundamentals (rate-limited, concurrency controlled by SCAN_FMP_CONCURRENCY)
      const fundamentalsBatch = await this.fmpFundamentals.getFundamentalsForSymbols(batch, { concurrency: fmpConcurrency });
      abortIfCancelled();

      // Phase 2 — Momentum (cacheManager calls, not FMP-rate-limited → higher concurrency)
      const momentumResults = await runConcurrent(fundamentalsBatch, async (fmpData) => {
        abortIfCancelled();
        const momentum = await this.momentumCalculator.calculateForSymbol(fmpData.symbol);
        const technicals = this.momentumCalculator.computeTechnicals(momentum._candles || [], { symbol: fmpData.symbol });
        return { fmpData, momentum, technicals };
      }, momentumConcurrency);
      abortIfCancelled();

      // Phase 3 — Scoring (pure computation, synchronous)
      const scoredBatch = [];
      const historyItems = [];
      for (const item of momentumResults) {
        if (item?.__error) {
          this.logger.error(`[scanAndScoreUniverse] Errore momentum: ${item.__error?.message || String(item.__error)}`);
          continue;
        }
        const { fmpData, momentum, technicals } = item;
        const scored = this.scoringService.scoreSymbol(fmpData, { momentumScore: momentum?.score ?? null });
        scoredBatch.push(scored);
        const fundamentalsRecord = buildFundamentalsRecord(scored, momentum);
        // Enrich with ETF flag from FMP profile (not available in scored object)
        fundamentalsRecord.is_etf = fmpData?.profile?.isEtf ? 1 : 0;
        historyItems.push({ symbol: fmpData.symbol, fundamentalsRecord, fmpData, technicals, scored });
      }

      // Phase 4 — Upsert fundamentals_history (datahub calls, no FMP limits → parallelise)
      await runConcurrent(historyItems, async ({ symbol, fundamentalsRecord, fmpData, technicals }) => {
        abortIfCancelled();
        await this.upsertFundamentalsHistory(symbol, fundamentalsRecord, { fmpData, today, technicals }).catch((err) => {
          this.logger.error(`[scanAndScoreUniverse] Errore fundamentals_history ${symbol}: ${err?.message || String(err)}`);
        });
        processedCount += 1;
        newCalculatedCount += 1;
        if (processedCount % 10 === 0) syncJobProgress();
      }, upsertConcurrency);

      syncJobProgress();
      newScoredRecords.push(...scoredBatch);

      // Phase 5 — Bulk upsert to /fundamentals (unchanged)
      const fundamentalsRecords = historyItems.map((h) => h.fundamentalsRecord);
      for (const chunk of chunkArray(fundamentalsRecords, bulkSize)) {
        try {
          const resp = await axios.post(`${this.dbmanagerUrl}/fundamentals/bulk`, { ok: true, count: chunk.length, results: chunk }, { timeout: 30000 });
          if (resp.data?.ok === false) this.logger.error(`[scanAndScoreUniverse] POST /fundamentals/bulk failed: ${resp.data.error}`);
          else this.logger.info(`[scanAndScoreUniverse] Salvati ${chunk.length} fundamentals`);
        } catch (e) {
          this.logger.error(`[scanAndScoreUniverse] Errore POST /fundamentals/bulk: ${e.message}`);
        }
      }

      // Phase 5b — Upsert ticker_fundamentals_history (scored snapshot per FMP report period)
      // PK: (symbol, as_of_date) — as_of_date is the quarterly FMP report date.
      // market_score/short_risk_score/volume_score/growth_probability are per-user and live in
      // scores_daily; they are intentionally omitted here.
      const tickerHistoryRecords = historyItems
        .map(({ symbol, fundamentalsRecord: fr, fmpData: fd, scored: sc }) => {
          const as_of_date = fd?.asOfDate || fd?.as_of_date || null;
          if (!as_of_date) return null;
          const profile = fd?.profile || {};
          const ratios = fd?.ratios || fd?.stableRatios || {};
          return {
            symbol,
            as_of_date,
            price:                 numOrNull(profile.price),
            beta:                  fr.beta,
            pe:                    fr.pe,
            pb:                    fr.pb,
            roe:                   fr.roe,
            roa:                   fr.roa,
            op_margin:             fr.op_margin,
            debt_equity:           fr.debt_equity,
            altman_z:              fr.altman_z,
            piotroski:             fr.piotroski,
            dcf_upside:            fr.dcf_upside,
            valuation_score:       fr.valuation_score,
            quality_score:         fr.quality_score,
            risk_score:            fr.risk_score,
            momentum_score:        fr.momentum_score,
            momentum_short_score:  fr.momentum_short_score,
            momentum_volume_score: fr.momentum_volume_score,
            total_score:           fr.total_score,
            momentum_json:         fr.momentum_json ? JSON.parse(fr.momentum_json) : null,
            profile_json:          profile,
            ratios_json:           ratios,
            scores_json:           sc?.scores || null,
            dcf_json:              fd?.dcf || null,
          };
        })
        .filter(Boolean);

      if (tickerHistoryRecords.length > 0) {
        for (const chunk of chunkArray(tickerHistoryRecords, bulkSize)) {
          try {
            const resp = await axios.post(`${this.dbmanagerUrl}/fundamentals/history`, { records: chunk }, { timeout: 30000 });
            if (resp.data?.ok === false) this.logger.error(`[scanAndScoreUniverse] POST /fundamentals/history failed: ${resp.data.error}`);
            else this.logger.info(`[scanAndScoreUniverse] Salvati ${chunk.length} ticker_fundamentals_history`);
          } catch (e) {
            this.logger.error(`[scanAndScoreUniverse] Errore POST /fundamentals/history: ${e.message}`);
          }
        }
      }
    }

    // Touch last_touch_date for symbols returned from DB cache (not re-scanned)
    if (existingRecords.length > 0) {
      const dbHitSymbols = existingRecords.map((r) => r.symbol).filter(Boolean);
      for (const chunk of chunkArray(dbHitSymbols, 500)) {
        try {
          await axios.put(`${this.dbmanagerUrl}/fundamentals/touch`, { symbols: chunk }, { timeout: 10000 });
        } catch (e) {
          this.logger.warning(`[scanAndScoreUniverse] PUT /fundamentals/touch failed: ${e?.message}`);
        }
      }
    }

    const results = [...existingRecords, ...newScoredRecords];
    return { count: results.length, dbHits: existingRecords.length, newCalculated: newScoredRecords.length, results };
  }

  // =========================================================
  // FUNDAMENTALS HISTORY (SCD2)
  // =========================================================

  async upsertFundamentalsHistory(symbol, fundamentalsRecord, { fmpData = {}, today, technicals = {} } = {}) {
    const ratios = fmpData?.ratios || fmpData?.stableRatios || {};
    const kmRaw = fmpData?.keyMetrics || fmpData?.stable || {};
    const km = Array.isArray(kmRaw) ? kmRaw[0] || {} : kmRaw;
    const profile = fmpData?.profile || {};
    const isRaw = fmpData?.incomeStatement;
    const is = Array.isArray(isRaw) ? isRaw[0] || {} : isRaw || {};
    const bsRaw = fmpData?.balanceSheet;
    const bs = Array.isArray(bsRaw) ? bsRaw[0] || {} : bsRaw || {};
    const period_end = is?.date || km?.date || fmpData?.periodEnd || fmpData?.period_end || null;
    const as_of_date = fmpData?.asOfDate || fmpData?.as_of_date || null;
    const netIncome = numOrNull(is?.netIncome ?? is?.net_income);
    const totalEquity = numOrNull(bs?.totalStockholdersEquity ?? bs?.totalEquity ?? bs?.total_stockholders_equity);
    const totalAssets = numOrNull(bs?.totalAssets ?? bs?.total_assets);
    const roeDerived = netIncome !== null && totalEquity ? (totalEquity !== 0 ? netIncome / totalEquity : null) : null;
    const roaDerived = netIncome !== null && totalAssets ? (totalAssets !== 0 ? netIncome / totalAssets : null) : null;
    const roe = roeDerived ?? numOrNull(ratios?.returnOnEquity) ?? numOrNull(km?.returnOnEquity) ?? fundamentalsRecord?.roe ?? null;
    const roa = roaDerived ?? numOrNull(ratios?.returnOnAssets) ?? numOrNull(km?.returnOnAssets) ?? fundamentalsRecord?.roa ?? null;
    const operating_income = numOrNull(is?.operatingIncome ?? is?.operating_income);
    const revenue = numOrNull(is?.revenue);
    const op_margin_raw = numOrNull(ratios?.operatingProfitMargin) ?? numOrNull(km?.operatingProfitMargin) ?? fundamentalsRecord?.op_margin ?? null;
    const op_margin_derived = operating_income !== null && revenue ? (revenue !== 0 ? operating_income / revenue : null) : null;
    const op_margin = op_margin_raw ?? op_margin_derived ?? null;
    const debt_equity = numOrNull(ratios?.debtToEquityRatio) ?? numOrNull(km?.debtToEquityRatio ?? km?.debtToEquity) ?? numOrNull(ratios?.debtEquityRatio) ?? fundamentalsRecord?.debt_equity ?? null;
    const toTinyInt = (v) => (v === null || v === undefined ? null : asBool(v) ? 1 : 0);
    const market_cap = numOrNull(profile?.marketCap ?? fundamentalsRecord?.market_cap ?? fundamentalsRecord?.marketCap);
    const beta = numOrNull(profile?.beta ?? fundamentalsRecord?.beta);
    const cik = profile?.cik ?? fundamentalsRecord?.cik ?? null;
    const isin = profile?.isin ?? fundamentalsRecord?.isin ?? null;
    const cusip = profile?.cusip ?? fundamentalsRecord?.cusip ?? null;
    const exchange_full_name = profile?.exchangeFullName ?? fundamentalsRecord?.exchange_full_name ?? null;
    const is_etf = toTinyInt(profile?.isEtf ?? fundamentalsRecord?.is_etf ?? fundamentalsRecord?.isEtf);
    const is_actively_trading = toTinyInt(profile?.isActivelyTrading ?? fundamentalsRecord?.is_actively_trading ?? fundamentalsRecord?.isActivelyTrading);
    const is_adr = toTinyInt(profile?.isAdr ?? fundamentalsRecord?.is_adr ?? fundamentalsRecord?.isAdr);
    const is_fund = toTinyInt(profile?.isFund ?? fundamentalsRecord?.is_fund ?? fundamentalsRecord?.isFund);
    const version_hash = buildHistoryVersionHash({ ...fundamentalsRecord, market_cap, beta, is_etf, is_actively_trading, is_adr, is_fund });

    // Technical indicators — price-based, valid for both equities and ETFs.
    // All values are numbers or null; undefined is coerced to null.
    const tech = technicals || {};
    const technicalPayload = {
      ret_1d:        numOrNull(tech.ret_1d),
      ret_5d:        numOrNull(tech.ret_5d),
      ret_20d:       numOrNull(tech.ret_20d),
      ret_60d:       numOrNull(tech.ret_60d),
      sma_10:        numOrNull(tech.sma_10),
      sma_20:        numOrNull(tech.sma_20),
      sma_50:        numOrNull(tech.sma_50),
      sma_200:       numOrNull(tech.sma_200),
      sma_20_slope:  numOrNull(tech.sma_20_slope),
      sma_50_slope:  numOrNull(tech.sma_50_slope),
      atr_14:        numOrNull(tech.atr_14),
      atr_14_pct:    numOrNull(tech.atr_14_pct),
      rsi_14:        numOrNull(tech.rsi_14),
      avg_gap_20:    numOrNull(tech.avg_gap_20),
      max_dd_60:     numOrNull(tech.max_dd_60),
      dollar_vol_20d: numOrNull(tech.dollar_vol_20d),
    };

    const payload = {
      symbol, valid_from: today, valid_to: null, period_end, as_of_date, last_seen_at: today, version_hash,
      sector: fundamentalsRecord?.sector ?? null, industry: fundamentalsRecord?.industry ?? null, country: fundamentalsRecord?.country ?? null,
      market_cap, beta, cik, isin, cusip, exchange_full_name, is_etf, is_actively_trading, is_adr, is_fund,
      roe, roa, op_margin, piotroski: fundamentalsRecord?.piotroski ?? null, debt_equity, altman_z: fundamentalsRecord?.altman_z ?? null,
      ...technicalPayload,
    };

    const existingResp = await axios.get(`${this.dbmanagerUrl}/fundamentals/history/records?symbol=${encodeURIComponent(symbol)}`, { timeout: 8000 });
    const existingData = existingResp.data || {};
    const existing = Array.isArray(existingData?.data) ? existingData.data : Array.isArray(existingData) ? existingData : [];
    const openRecord = existing.find((r) => r.valid_to === null || r.valid_to === undefined);

    if (openRecord) {
      const existingHash = typeof openRecord.version_hash === "string" ? openRecord.version_hash : openRecord.version_hash?.toString?.("hex") || null;
      if (existingHash === version_hash) {
        // Fundamentals unchanged — only refresh last_seen_at and update technicals (daily price data)
        await axios.put(`${this.dbmanagerUrl}/fundamentals/history/records/${openRecord.id}`, { last_seen_at: today, ...technicalPayload }, { timeout: 8000 });
        return;
      }
      await axios.put(`${this.dbmanagerUrl}/fundamentals/history/records/${openRecord.id}`, { valid_to: today }, { timeout: 8000 });
    }

    await axios.post(`${this.dbmanagerUrl}/fundamentals/history/records`, payload, { timeout: 8000 });
  }

  // =========================================================
  // MOMENTUM REFRESH
  // =========================================================

  async refreshMomentumAll() {
    const resp = await axios.get(`${this.dbmanagerUrl}/fundamentals`, { timeout: 15000 });
    const rows = Array.isArray(resp.data) ? resp.data : [];
    const symbols = [...new Set(rows.map((r) => r.symbol).filter(Boolean))];
    this.logger.info(`[momentumRefresh] Trovati ${symbols.length} simboli`);

    const batchSize = 50;
    let totalUpdated = 0;

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      this.logger.info(`[momentumRefresh] Batch ${i / batchSize + 1} (${batch.length} simboli)`);
      const results = [];
      for (const sym of batch) {
        const momentum = await this.momentumCalculator.calculateForSymbol(sym);
        results.push({ symbol: sym, momentum });
      }
      try {
        const r2 = await axios.put(`${this.dbmanagerUrl}/fundamentals/bulk`, { ok: true, count: results.length, results }, { timeout: 30000 });
        this.logger.info(`[momentumRefresh] Aggiornato momentum per batch: ${r2.data?.updated ?? "?"} simboli`);
        totalUpdated += r2.data?.updated ?? 0;
      } catch (err) {
        this.logger.error(`[momentumRefresh] Errore PUT /fundamentals/bulk: ${err?.message}`);
      }
    }

    return { totalSymbols: symbols.length, totalUpdated };
  }

  async recalcMomentumForLastCandles(items = []) {
    if (!Array.isArray(items)) return [];
    const output = [];
    for (const item of items) {
      const symbol = item?.symbol ? String(item.symbol).toUpperCase() : null;
      if (!symbol) { output.push({ symbol: item?.symbol ?? null, error: "symbol missing" }); continue; }
      try {
        const momentum = await this.momentumCalculator.calculateForSymbol(symbol);
        output.push({ symbol, lastCandle: item.lastCandle ?? null, momentum });
      } catch (err) {
        this.logger.error(`[recalcMomentumForLastCandles] ${symbol} errore: ${err?.message || String(err)}`);
        output.push({ symbol, error: err?.message || "recalc error" });
      }
    }
    return output;
  }
}

module.exports = TickerScanner;
