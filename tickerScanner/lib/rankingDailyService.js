"use strict";

/**
 * rankingDailyService.js — Phase 3b: Daily ranking snapshot
 *
 * Reads daily_scores (Phase 2b) for a given score_date, joins with universe
 * for asset metadata (is_etf, market_cap, sector, country), applies optional
 * filters, ranks symbols within asset-type buckets, and writes the reduced
 * ranked list to AST_RANKING_DAILY via DataHub.
 *
 * Idempotency:
 *   mode=normal — if rows for score_date already exist in AST_RANKING_DAILY, skip
 *   mode=force  — delete existing rows for score_date first, then re-build
 */

// ---- bucket thresholds ----

const LARGECAP_THRESHOLD = 10_000_000_000; // 10B USD
const MIDCAP_THRESHOLD   =  2_000_000_000; //  2B USD

const DEFAULT_LIMITS = {
  LARGECAP:    50,
  MIDCAP:      30,
  SMALLCAP:    20,
  ETF_GENERAL: 30,
};

// ---- pure helpers ----

function detectAssetType(row) {
  return row.is_etf ? "ETF" : "EQUITY";
}

function detectBucket(row) {
  if (row.is_etf) return "ETF_GENERAL";
  const cap = row.market_cap != null ? Number(row.market_cap) : null;
  if (cap == null || !Number.isFinite(cap) || cap < 0) return "SMALLCAP";
  if (cap >= LARGECAP_THRESHOLD) return "LARGECAP";
  if (cap >= MIDCAP_THRESHOLD)   return "MIDCAP";
  return "SMALLCAP";
}

/**
 * Apply user-defined filters to a merged row (daily_scores + universe fields).
 *
 * Supported filters:
 *   min_dollar_vol   — minimum dollar_vol_20d
 *   min_market_cap   — minimum market_cap (equities only)
 *   min_total_score  — minimum total_score
 *   max_atr_14_pct   — maximum atr_14_pct
 *   exclude_etf      — boolean; if true, skip ETFs
 *   sectors          — string[] allow-list of sectors (from universe)
 *   countries        — string[] allow-list of countries (from universe)
 */
function applyFilters(rows, filters = {}) {
  return rows.filter((row) => {
    if (
      filters.min_dollar_vol != null &&
      (row.dollar_vol_20d == null || Number(row.dollar_vol_20d) < filters.min_dollar_vol)
    ) return false;

    if (
      filters.min_market_cap != null &&
      !row.is_etf &&
      (row.market_cap == null || Number(row.market_cap) < filters.min_market_cap)
    ) return false;

    if (
      filters.min_total_score != null &&
      (row.total_score == null || Number(row.total_score) < filters.min_total_score)
    ) return false;

    if (
      filters.max_atr_14_pct != null &&
      row.atr_14_pct != null &&
      Number(row.atr_14_pct) > filters.max_atr_14_pct
    ) return false;

    if (filters.exclude_etf && row.is_etf) return false;

    if (Array.isArray(filters.sectors) && filters.sectors.length > 0) {
      if (!filters.sectors.includes(row.sector)) return false;
    }

    if (Array.isArray(filters.countries) && filters.countries.length > 0) {
      if (!filters.countries.includes(row.country)) return false;
    }

    return true;
  });
}

function buildReasonJson(row) {
  return {
    source:          "daily_scores",
    total_score:     row.total_score     ?? null,
    quality_score:   row.quality_score   ?? null,
    risk_score:      row.risk_score      ?? null,
    momentum_score:  row.momentum_score  ?? null,
    price:           row.price           ?? null,
    atr_14_pct:      row.atr_14_pct      ?? null,
    dollar_vol_20d:  row.dollar_vol_20d  ?? null,
    trend: {
      price_gt_sma50:  (row.price != null && row.sma_50  != null) ? Number(row.price) > Number(row.sma_50)  : null,
      sma50_gt_sma200: (row.sma_50 != null && row.sma_200 != null) ? Number(row.sma_50) > Number(row.sma_200) : null,
    },
    filters: {},
  };
}

// ---- pagination helper ----

async function fetchAllPages(datahubAxios, basePath, pageSize = 500) {
  const items = [];
  let offset = 0;
  for (;;) {
    const sep = basePath.includes("?") ? "&" : "?";
    const resp = await datahubAxios.get(`${basePath}${sep}limit=${pageSize}&offset=${offset}`);
    const page = resp.data?.items || [];
    items.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return items;
}

// ---- bounded concurrency ----

async function runConcurrent(items, fn, limit) {
  if (!items.length) return;
  let nextIdx = 0;
  const worker = async () => {
    while (nextIdx < items.length) {
      const i = nextIdx++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// ---- service factory ----

function createRankingDailyService({ logger, datahubAxios }) {
  const TABLE_SOURCE  = "/api/table/daily_scores";
  const TABLE_UNIVERSE = "/api/table/universe";
  const TABLE_TARGET  = "/api/table/AST_RANKING_DAILY";

  async function checkExisting(scoreDate) {
    const qs = new URLSearchParams({ score_date: scoreDate, limit: "1" });
    const resp = await datahubAxios.get(`${TABLE_TARGET}?${qs}`);
    return (resp.data?.count ?? resp.data?.items?.length ?? 0) > 0;
  }

  async function deleteExisting(scoreDate) {
    const rows = await fetchAllPages(
      datahubAxios,
      `${TABLE_TARGET}?score_date=${encodeURIComponent(scoreDate)}`
    );
    let deleted = 0;
    for (const row of rows) {
      if (!row.id) continue;
      try {
        await datahubAxios.delete(`${TABLE_TARGET}/${encodeURIComponent(row.id)}`);
        deleted++;
      } catch (err) {
        logger.warning(`[rankingDailySvc] delete failed id=${row.id}: ${err?.message}`);
      }
    }
    return deleted;
  }

  /**
   * Build (or rebuild) the daily ranking snapshot for a given score_date.
   *
   * @param {object} options
   * @param {string}  options.scoreDate  — YYYY-MM-DD
   * @param {string}  [options.mode]     — "normal" (default) or "force"
   * @param {object}  [options.limits]   — per-bucket row limits (override defaults)
   * @param {object}  [options.filters]  — filter criteria (see applyFilters)
   */
  async function buildDailyRankingSnapshot({ scoreDate, mode = "normal", limits = {}, filters = {} }) {
    const fn = "[rankingDailySvc.buildDailyRankingSnapshot]";

    // Idempotency check
    if (mode !== "force") {
      const exists = await checkExisting(scoreDate);
      if (exists) {
        logger.info(`${fn} score_date=${scoreDate} already exists, skipping (mode=normal)`);
        return { ok: true, skipped: true, score_date: scoreDate };
      }
    } else {
      const deleted = await deleteExisting(scoreDate);
      logger.info(`${fn} force mode: deleted ${deleted} existing rows for score_date=${scoreDate}`);
    }

    // 1. Fetch daily_scores for score_date
    logger.info(`${fn} fetching daily_scores score_date=${scoreDate}`);
    const scoreRows = await fetchAllPages(
      datahubAxios,
      `${TABLE_SOURCE}?score_date=${encodeURIComponent(scoreDate)}`
    );
    if (!scoreRows.length) {
      logger.warning(`${fn} no daily_scores found for score_date=${scoreDate}`);
      return { ok: true, written: 0, score_date: scoreDate, message: "no source data" };
    }
    logger.info(`${fn} fetched ${scoreRows.length} daily_scores rows`);

    // 2. Fetch universe to get is_etf, market_cap, sector, country
    logger.info(`${fn} fetching universe`);
    const universeRows = await fetchAllPages(datahubAxios, TABLE_UNIVERSE);
    const universeMap = new Map(universeRows.map((r) => [r.symbol, r]));
    logger.info(`${fn} fetched ${universeRows.length} universe rows`);

    // 3. Merge daily_scores with universe metadata
    const merged = scoreRows.map((ds) => {
      const uni = universeMap.get(ds.symbol) || {};
      return {
        ...ds,
        is_etf:     uni.is_etf     != null ? Boolean(Number(uni.is_etf)) : false,
        market_cap: uni.market_cap != null ? Number(uni.market_cap)      : null,
        sector:     uni.sector     ?? null,
        industry:   uni.industry   ?? null,
        country:    uni.country    ?? null,
      };
    });

    // 4. Apply filters
    const passed = applyFilters(merged, filters);
    logger.info(`${fn} filters: ${passed.length}/${merged.length} passed`);

    // 5. Group by bucket
    const buckets = {};
    for (const row of passed) {
      const bucket = detectBucket(row);
      if (!buckets[bucket]) buckets[bucket] = [];
      buckets[bucket].push(row);
    }

    // 6. Rank within each bucket, apply per-bucket limits
    const effectiveLimits = { ...DEFAULT_LIMITS, ...limits };
    const toWrite = [];

    for (const [bucket, rows] of Object.entries(buckets)) {
      // Primary: total_score DESC; tiebreaker: dollar_vol_20d DESC
      rows.sort((a, b) => {
        const sa = Number(a.total_score) || 0;
        const sb = Number(b.total_score) || 0;
        if (sb !== sa) return sb - sa;
        return (Number(b.dollar_vol_20d) || 0) - (Number(a.dollar_vol_20d) || 0);
      });

      const bucketLimit = effectiveLimits[bucket] ?? 50;
      rows.slice(0, bucketLimit).forEach((row, idx) => {
        toWrite.push({
          score_date:    scoreDate,
          symbol:        row.symbol,
          asset_type:    detectAssetType(row),
          bucket,
          rank_position: idx + 1,
          rank_score:    row.total_score != null ? Number(row.total_score) : null,
          source_score:  row.total_score != null ? Number(row.total_score) : null,
          passed_filters: 1,
          reason_json:   buildReasonJson(row),
        });
      });
    }

    // 7. Write to AST_RANKING_DAILY (bounded concurrency)
    logger.info(`${fn} writing ${toWrite.length} rows to AST_RANKING_DAILY`);
    let written = 0;
    let errors  = 0;

    await runConcurrent(
      toWrite,
      async (record) => {
        try {
          await datahubAxios.post(TABLE_TARGET, record);
          written++;
        } catch (err) {
          errors++;
          const detail = err?.response?.data?.error || err?.message;
          logger.warning(`${fn} write failed symbol=${record.symbol}: ${detail}`);
        }
      },
      10 // max 10 parallel datahub POSTs
    );

    logger.info(`${fn} done: written=${written}, errors=${errors}, score_date=${scoreDate}`);

    return {
      ok:            true,
      score_date:    scoreDate,
      source_count:  scoreRows.length,
      passed_count:  passed.length,
      written,
      errors,
      buckets: Object.fromEntries(
        Object.entries(buckets).map(([k, v]) => [k, Math.min(v.length, effectiveLimits[k] ?? 50)])
      ),
    };
  }

  /**
   * Read ranking rows for a given score_date from AST_RANKING_DAILY.
   * Returns rows sorted by bucket ASC, rank_position ASC.
   */
  async function getRanking(scoreDate) {
    const rows = await fetchAllPages(
      datahubAxios,
      `${TABLE_TARGET}?score_date=${encodeURIComponent(scoreDate)}`
    );
    rows.sort((a, b) => {
      if (a.bucket < b.bucket) return -1;
      if (a.bucket > b.bucket) return 1;
      return (a.rank_position || 0) - (b.rank_position || 0);
    });
    return { ok: true, score_date: scoreDate, count: rows.length, items: rows };
  }

  return { buildDailyRankingSnapshot, getRanking };
}

module.exports = { createRankingDailyService };
