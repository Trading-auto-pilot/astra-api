"use strict";

/**
 * universeService.js — Phase 1: Universe scan
 *
 * Responsabilità: recupera tutti i ticker (compagnie + ETF) dallo screener FMP,
 * acquisisce i dati fondamentali e li persiste nella tabella `universe` via datahub.
 *
 * Non calcola scores né indicatori tecnici (quelli sono Phase 2 — daily_scores).
 */

const {
  createScanJob,
  updateScanJob,
  getScanJob,
  cancelScanJob: cancelJobInMap,
} = require("../modules/scanJob");

// ---- helpers ----

const numOrNull = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toTinyInt = (v) =>
  v === null || v === undefined ? null : v ? 1 : 0;

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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

// ---- record builder ----

/**
 * Mappa il payload restituito da FmpFundamentalsService.getFundamentalsForSymbol()
 * nelle colonne della tabella `universe`.
 *
 * Non include scores né indicatori tecnici.
 */
function buildUniverseRecord(fmpData) {
  const profile  = fmpData?.profile  || {};
  const ratios   = fmpData?.ratios   || fmpData?.stableRatios || {};
  const scores   = fmpData?.scores   || {};       // financial-scores endpoint (piotroski, altmanZ)
  const dcf      = fmpData?.dcf      || {};

  return {
    symbol:              fmpData.symbol,
    asset_class:         (profile.isEtf || profile.isFund) ? "ETF" : "STOCK",
    is_etf:              toTinyInt(profile.isEtf),
    is_actively_trading: toTinyInt(profile.isActivelyTrading),
    is_adr:              toTinyInt(profile.isAdr),
    is_fund:             toTinyInt(profile.isFund),
    sector:              profile.sector            ?? null,
    industry:            profile.industry          ?? null,
    country:             profile.country           ?? null,
    exchange_full_name:  profile.exchangeFullName  ?? null,
    market_cap:          numOrNull(profile.marketCap),
    beta:                numOrNull(profile.beta),
    // valuation metrics
    pe:                  numOrNull(ratios.priceEarningsRatio),
    pb:                  numOrNull(ratios.priceToBookRatio),
    // quality metrics
    roe:                 numOrNull(ratios.returnOnEquity),
    roa:                 numOrNull(ratios.returnOnAssets),
    op_margin:           numOrNull(ratios.operatingProfitMargin),
    piotroski:           numOrNull(scores.piotroskiScore),
    // risk metrics
    debt_equity:         numOrNull(ratios.debtToEquityRatio ?? ratios.debtEquityRatio),
    altman_z:            numOrNull(scores.altmanZScore),
    dcf_upside:          numOrNull(fmpData.dcfUpside),
    // raw FMP JSON (full detail for future use)
    profile_json:        Object.keys(profile).length ? profile : null,
    ratios_json:         Object.keys(ratios).length  ? ratios  : null,
    dcf_json:            Object.keys(dcf).length     ? dcf     : null,
    // scan metadata
    last_scan_date:      new Date().toISOString().slice(0, 10),
  };
}

// ---- service factory ----

/**
 * @param {object} deps
 * @param {object} deps.logger
 * @param {object} deps.datahubAxios  — axios instance wrapped with createDatahubAdapter
 * @param {object} deps.fmpFundamentals — instance of FmpFundamentalsService
 * @param {object} deps.screener        — instance of ScreenerService
 */
function createUniverseScanService({ logger, datahubAxios, fmpFundamentals, screener }) {
  const TABLE = "/api/table/universe";

  // ---- internal helpers ----

  /**
   * Recupera tutti i simboli già presenti in universe (paginato).
   * Restituisce un Set<string> di simboli.
   */
  async function fetchExistingSymbols() {
    const symbols = new Set();
    let offset = 0;
    const limit = 1000;
    for (;;) {
      const resp = await datahubAxios.get(`${TABLE}?limit=${limit}&offset=${offset}`);
      const items = resp.data?.items || [];
      items.forEach((r) => r.symbol && symbols.add(r.symbol));
      if (items.length < limit) break;
      offset += limit;
    }
    return symbols;
  }

  /**
   * Upsert di un singolo record in `universe`.
   * Usa PUT se il simbolo è già in DB, POST altrimenti.
   */
  async function upsertRecord(record, isNew) {
    if (isNew) {
      await datahubAxios.post(TABLE, record);
      return "inserted";
    }
    await datahubAxios.put(`${TABLE}/${encodeURIComponent(record.symbol)}`, record);
    return "updated";
  }

  // ---- main scan ----

  /**
   * Esegue lo scan dell'universo.
   * Scrive solo dati fondamentali FMP nella tabella `universe`.
   * Non calcola scores né indicatori tecnici.
   *
   * @param {object} filterOverrides  — override per lo screener FMP
   * @param {object} options
   * @param {boolean} options.forceRefresh — se true, ri-processa anche i simboli già in DB
   * @param {string}  options.jobId        — ID del job per aggiornare il progresso
   */
  async function scanUniverse(filterOverrides = {}, { forceRefresh = false, jobId } = {}) {
    let processed = 0;
    let inserted  = 0;
    let updated   = 0;
    let skipped   = 0;
    const errors  = [];

    const syncProgress = () => {
      if (!jobId) return;
      updateScanJob(jobId, {
        totalProcessed:  processed + skipped,
        newCalculated:   inserted + updated,
        dbHits:          skipped,
      });
    };

    const abortIfCancelled = () => {
      if (!jobId) return;
      const job = getScanJob(jobId);
      if (job?.cancel || job?.status === "cancelled") {
        const e = new Error("Universe scan cancelled");
        e.code = "CANCELLED";
        throw e;
      }
    };

    // Step 1 — Screener FMP → lista simboli
    abortIfCancelled();
    logger.info("[universeService] Avvio screener FMP...");
    const screenerResult = await screener.runScreener(filterOverrides);
    const allSymbols = (screenerResult?.data || []).map((d) => d.symbol).filter(Boolean);

    if (!allSymbols.length) {
      logger.warning("[universeService] Nessun simbolo dallo screener");
      return { count: 0, processed: 0, inserted: 0, updated: 0, skipped: 0, errors: [] };
    }

    logger.info(`[universeService] Screener: ${allSymbols.length} simboli`);
    if (jobId) updateScanJob(jobId, { totalRawTickers: allSymbols.length });

    // Step 2 — Fetch simboli già in universe
    abortIfCancelled();
    let existingSymbols = new Set();
    try {
      existingSymbols = await fetchExistingSymbols();
      logger.info(`[universeService] ${existingSymbols.size} simboli esistenti in universe`);
    } catch (e) {
      logger.error(`[universeService] Errore fetch universe esistenti: ${e.message}`);
    }

    const toProcess = forceRefresh
      ? allSymbols
      : allSymbols.filter((s) => !existingSymbols.has(s));
    skipped = allSymbols.length - toProcess.length;
    syncProgress();

    logger.info(
      `[universeService] Da processare: ${toProcess.length}, saltati (già in DB): ${skipped} (forceRefresh=${forceRefresh})`
    );

    // Step 3 — FMP fundamentals + upsert (batched + concurrency controllata)
    const batchSize      = Math.max(1, Number(process.env.SCAN_MISSING_BATCH)    || 50);
    const fmpConcurrency = Math.max(1, Number(process.env.SCAN_FMP_CONCURRENCY)  || 3);
    const upsertConc     = Math.max(1, Number(process.env.SCAN_UPSERT_CONCURRENCY) || 5);

    for (const batch of chunkArray(toProcess, batchSize)) {
      abortIfCancelled();

      // FMP calls (rate-limited internamente da FmpFundamentalsService)
      const fmpResults = await fmpFundamentals.getFundamentalsForSymbols(batch, {
        concurrency: fmpConcurrency,
      });
      abortIfCancelled();

      // Upsert parallelo (datahub, nessun rate-limit esterno)
      await runConcurrent(
        fmpResults,
        async (fmpData) => {
          abortIfCancelled();
          if (!fmpData?.symbol) return;
          try {
            const record = buildUniverseRecord(fmpData);
            const action = await upsertRecord(record, !existingSymbols.has(record.symbol));
            if (action === "inserted") inserted++;
            else updated++;
            processed++;
            if ((processed + skipped) % 20 === 0) syncProgress();
          } catch (err) {
            logger.error(
              `[universeService] Errore upsert ${fmpData.symbol}: ${err.message}`
            );
            errors.push({ symbol: fmpData.symbol, error: err.message });
          }
        },
        upsertConc
      );

      syncProgress();
    }

    logger.info(
      `[universeService] Scan completato: inserted=${inserted}, updated=${updated}, skipped=${skipped}, errors=${errors.length}`
    );
    return {
      count:    allSymbols.length,
      processed,
      inserted,
      updated,
      skipped,
      errors,
    };
  }

  return { scanUniverse, fetchExistingSymbols };
}

module.exports = { buildUniverseRecord, createUniverseScanService };
