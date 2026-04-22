// modules/heal.js — POST /l2/heal + POST /l2/heal/scan
"use strict";

const fs    = require("fs");
const path  = require("path");
const axios = require("axios");
const { randomUUID } = require("crypto");
const { getSetting, getConfigString, getConfigInt } = require("../../shared/loadSettings");

// -------------------------------------------------------
// Default days-back per TF (usati dal full scan)
// -------------------------------------------------------
const DEFAULT_DAYS_BACK_PER_TF = {
  "1day":   365,
  "1week":  730,
  "1month": 730,
  "4h":      90,
  "2h":      90,
  "1h":      60,
  "30min":   30,
  "15min":   30,
  "5min":    14,
  "1min":     7,
};

// -------------------------------------------------------
// TF intraday (sotto-giornalieri): soggetti al filtro liquidità
// -------------------------------------------------------
const INTRADAY_TFS = new Set(["1min","5min","15min","30min","1h","2h","4h","1hour","2hour","4hour"]);
function isIntradayTf(tf) { return INTRADAY_TFS.has((tf || "").toLowerCase()); }

// -------------------------------------------------------
// Fetch dollar_vol_20d per tutti i simboli da daily_scores
// Ritorna Map<symbol, dollar_vol_20d> con il dato più recente
// -------------------------------------------------------
async function fetchDollarVolMap(datahubUrl, logger) {
  const db = axios.create({ baseURL: datahubUrl || "http://datahub:3000", timeout: 30000 });
  const PAGE = 1000;
  const volMap = new Map();
  let offset = 0;
  try {
    for (;;) {
      const { data: body } = await db.get(`/api/table/daily_scores?sort_by=score_date&sort_dir=desc&limit=${PAGE}&offset=${offset}`);
      const rows = Array.isArray(body?.data) ? body.data : [];
      for (const row of rows) {
        const sym = String(row.symbol ?? "").toUpperCase();
        // sort_dir=desc → prima riga per symbol è la più recente
        if (sym && !volMap.has(sym) && row.dollar_vol_20d != null) {
          volMap.set(sym, Number(row.dollar_vol_20d));
        }
      }
      if (rows.length < PAGE) break;
      offset += PAGE;
    }
    logger.info(`[heal/scan] dollar_vol_20d caricato per ${volMap.size} simboli`);
  } catch (err) {
    logger.warn(`[heal/scan] Impossibile caricare dollar_vol_20d: ${err.message} — filtro liquidità disabilitato`);
  }
  return volMap;
}

// -------------------------------------------------------
// NYSE holidays (fixed + approximate floating, 2023-2027)
// -------------------------------------------------------
const NYSE_HOLIDAYS = new Set([
  "2023-01-02","2023-01-16","2023-02-20","2023-04-07","2023-05-29",
  "2023-06-19","2023-07-04","2023-09-04","2023-11-23","2023-12-25",
  "2024-01-01","2024-01-15","2024-02-19","2024-03-29","2024-05-27",
  "2024-06-19","2024-07-04","2024-09-02","2024-11-28","2024-12-25",
  "2025-01-01","2025-01-20","2025-02-17","2025-04-18","2025-05-26",
  "2025-06-19","2025-07-04","2025-09-01","2025-11-27","2025-12-25",
  "2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25",
  "2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25",
  "2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31",
  "2027-06-18","2027-07-05","2027-09-06","2027-11-25","2027-12-24",
]);

function isNyseOpen(d) {
  const dow = new Date(d + "T12:00:00Z").getUTCDay();
  return dow !== 0 && dow !== 6 && !NYSE_HOLIDAYS.has(d);
}

function getTradingDays(from, to) {
  const out = [], cur = new Date(from + "T12:00:00Z"), end = new Date(to + "T12:00:00Z");
  while (cur <= end) { const d = cur.toISOString().slice(0,10); if (isNyseOpen(d)) out.push(d); cur.setUTCDate(cur.getUTCDate()+1); }
  return out;
}

function monthBoundsStr(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return {
    from: `${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-01`,
    to:   new Date(Date.UTC(y, m, 0)).toISOString().slice(0,10),
  };
}

function listMonthKeysBetween(from, to) {
  const out = [];
  let cur = new Date(Date.UTC(new Date(from+"T00:00:00Z").getUTCFullYear(), new Date(from+"T00:00:00Z").getUTCMonth(), 1));
  const endMon = new Date(Date.UTC(new Date(to+"T00:00:00Z").getUTCFullYear(), new Date(to+"T00:00:00Z").getUTCMonth(), 1));
  while (cur <= endMon) {
    out.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth()+1).padStart(2,"0")}`);
    cur.setUTCMonth(cur.getUTCMonth()+1);
  }
  return out;
}

function todayStr() { return new Date().toISOString().slice(0,10); }

function daysBackToFrom(days) {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0,10);
}

// -------------------------------------------------------
// Quality score
// -------------------------------------------------------
function computeQualityScore({ trading_days_expected, trading_days_present, gaps_unhealed, months_checked, months_ok }) {
  if (trading_days_expected === 0) return 100;
  const completeness = Math.min(100, (trading_days_present / trading_days_expected) * 100);
  const gap_score    = Math.min(100, Math.max(0, ((trading_days_expected - gaps_unhealed) / trading_days_expected) * 100));
  const month_score  = months_checked > 0 ? (months_ok / months_checked) * 100 : 100;
  return Math.round(Math.min(100, Math.max(0, completeness * 0.4 + gap_score * 0.4 + month_score * 0.2)) * 100) / 100;
}

// -------------------------------------------------------
// Normalizza un timestamp di candela settimanale al lunedì della sua ISO week
// POLYGON usa domenica chiusura, ALPACA usa lunedì apertura → stessa settimana, key diversa
// -------------------------------------------------------
function toWeekMonday(isoStr) {
  const d = new Date(isoStr);
  const day = d.getUTCDay(); // 0=domenica, 1=lunedì, ...
  const offset = day === 0 ? 1 : (day === 1 ? 0 : -(day - 1));
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + offset);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString();
}

// -------------------------------------------------------
// Normalizza tutte le candele di un file: per 1week sposta al lunedì della ISO week
// -------------------------------------------------------
function normalizeCandles(candles, tfCache) {
  if (tfCache !== "1week") return candles;
  return candles.map((c) => {
    const t = c?.t ?? c?.timestamp ?? c?.time ?? c?.date;
    if (!t) return c;
    return { ...c, t: toWeekMonday(String(t)) };
  });
}

// -------------------------------------------------------
// Per 1week: restituisce array di date YYYY-MM-DD (lunedì) per ogni settimana ISO
// che ha almeno un giorno di trading in tradingDays.
// Per altri TF: restituisce tradingDays invariato.
// -------------------------------------------------------
function getExpectedKeysForTf(tradingDays, tfCache) {
  if (tfCache !== "1week") return tradingDays;
  const seen = new Set();
  const out  = [];
  for (const d of tradingDays) {
    const monday = new Date(toWeekMonday(d + "T12:00:00Z")).toISOString().slice(0, 10);
    if (!seen.has(monday)) { seen.add(monday); out.push(monday); }
  }
  return out;
}

// -------------------------------------------------------
// Merge candles (dedup per day, newCandles vince)
// Per 1week: normalizza al lunedì prima del merge
// -------------------------------------------------------
function mergeCandles(existing, newC, tfCache = "") {
  const normalized = normalizeCandles([...existing, ...newC], tfCache);
  const toMs = (c) => { const v = c?.t ?? c?.timestamp ?? c?.time ?? c?.date; if (!v) return null; const n = typeof v === "number" ? (v < 1e12 ? v*1000 : v) : Date.parse(String(v)); return Number.isFinite(n) ? n : null; };
  const byDay = new Map();
  for (const c of normalized) { const ms = toMs(c); if (ms === null) continue; byDay.set(new Date(ms).toISOString().slice(0,10), { ...c, t: new Date(ms).toISOString() }); }
  return Array.from(byDay.values()).sort((a,b) => new Date(a.t)-new Date(b.t));
}

// -------------------------------------------------------
// Discover TF → symbols from cache directory
// -------------------------------------------------------
// Returns Array<{ tf, exchange, symbols: Set<string> }> where:
//   - legacy files (no suffix)   → exchange = undefined  (healable, no exchange context needed)
//   - SIP files (_SIP suffix)    → exchange = "SIP"      (healable, US stocks via default providers)
//   - non-US files (_LSE, etc.)  → skipped               (heal cannot re-fetch without exchange)
function discoverTfSymbols(cacheBasePath, normalizeTf, usOnlyProviders) {
  const root = path.isAbsolute(cacheBasePath) ? cacheBasePath : path.resolve(process.cwd(), cacheBasePath);
  // key: `${tf}|||${exchange ?? ""}` → Set<symbol>
  const tfExMap = {};
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const symbol = entry.name.toUpperCase();
    const symDir = path.join(root, entry.name);
    let files;
    try { files = fs.readdirSync(symDir); } catch { continue; }
    for (const f of files) {
      const m = /^\d{4}-\d{2}_([^_]+)(?:_([A-Z]{2,}))?\.json$/i.exec(f);
      if (!m) continue;
      const tf = normalizeTf(m[1]);
      const exchange = m[2] ? m[2].toUpperCase() : undefined;
      // Skip non-US exchange files — heal cannot re-fetch without the right exchange context
      if (exchange && exchange !== "SIP") continue;
      const key = `${tf}|||${exchange ?? ""}`;
      if (!tfExMap[key]) tfExMap[key] = { tf, exchange, symbols: new Set() };
      tfExMap[key].symbols.add(symbol);
    }
  }
  return Object.values(tfExMap);
}

// -------------------------------------------------------
// Progress publisher
// -------------------------------------------------------
async function publishProgress(bus, env, jobId, progress) {
  if (!bus) return;
  try {
    const key = `${env}:cachemanager:heal:${jobId}:progress`;
    await bus.set(key, progress, { EX: 7200 });
    const channel = `${env}.cachemanager.events`;
    await bus.publish(channel, { type: "heal_progress", jobId, ...progress });
  } catch { /* non blocca il job */ }
}

// -------------------------------------------------------
// Core: heal a single symbol/TF for a date range
// Returns metrics object + unhealed arrays + monthData (per-file breakdown)
// -------------------------------------------------------
async function healOneSymbol({ symbol, tfCache, exchange, from, to, heal, dry_run, cacheManager, logger }) {
  const today       = todayStr();
  // Se oggi è un giorno di borsa, la candela odierna potrebbe non essere ancora disponibile
  // (il heal può girare prima della chiusura mercato). Usiamo l'ultimo giorno di borsa CHIUSO
  // (= il giorno di borsa precedente a oggi) per evitare falsi "missing" sul mese corrente.
  const lastClosedTradingDay = (() => {
    let d = new Date(today + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    let candidate = d.toISOString().slice(0, 10);
    let safety = 0;
    while (!isNyseOpen(candidate) && safety++ < 10) {
      d.setUTCDate(d.getUTCDate() - 1);
      candidate = d.toISOString().slice(0, 10);
    }
    return candidate;
  })();
  const safeToday   = isNyseOpen(today) ? lastClosedTradingDay : today;
  const effectiveTo = to > safeToday ? safeToday : to;
  const monthKeys   = listMonthKeysBetween(from, effectiveTo);

  const m = {
    symbol, tf: tfCache,
    months_checked: monthKeys.length, months_ok: 0, months_empty: 0, months_missing: 0,
    trading_days_expected: 0, trading_days_present_pre: 0, trading_days_present_post: 0,
    gaps_found: 0, gaps_healed: 0, gaps_unhealed: 0, candles_added: 0,
    freshness: 100,
    details: { missing_months: [], gap_months: [] },
  };
  const unhealedMissing = [];
  const unhealedGaps    = [];
  // Per-file breakdown: una entry per month_key — usata per cache_quality_file_scores
  const monthData       = [];

  // Per TF settimanale: conta le settimane ISO distinte invece dei giorni
  const countExpectedForTf = (tradingDays) => {
    if (tfCache !== "1week") return tradingDays.length;
    const weeks = new Set(tradingDays.map((d) => {
      const dt = new Date(d + "T12:00:00Z");
      const thu = new Date(dt);
      thu.setUTCDate(dt.getUTCDate() + (4 - (dt.getUTCDay() || 7)));
      const yearStart = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
      const wn = Math.ceil(((thu - yearStart) / 86400000 + 1) / 7);
      return `${thu.getUTCFullYear()}-${wn}`;
    }));
    return weeks.size;
  };

  for (const monthKey of monthKeys) {
    const { from: mFrom, to: mTo } = monthBoundsStr(monthKey);
    const isCurrentMonth   = monthKey === today.slice(0,7);
    const effectiveMonthTo = isCurrentMonth ? today : mTo;
    const expectedDays     = getTradingDays(mFrom, effectiveMonthTo);
    // Per 1week: escludi lunedì che cadono prima dell'inizio del mese
    // (settimane a cavallo di mese: es. 28 ott - 1 nov → lunedì 28 ott non appartiene al file novembre)
    const expectedKeys     = getExpectedKeysForTf(expectedDays, tfCache).filter((k) => k >= mFrom);
    const expectedCount    = expectedKeys.length > 0 ? expectedKeys.length : countExpectedForTf(expectedDays);
    m.trading_days_expected += expectedCount;

    const filePath   = cacheManager._l2MonthFilePath(symbol, tfCache, monthKey, exchange);
    const fileExists = fs.existsSync(filePath) && fs.statSync(filePath).size > 0;

    // ── File mancante ─────────────────────────────────
    if (!fileExists) {
      m.months_missing++;
      m.details.missing_months.push(monthKey);
      if (!heal || dry_run) {
        unhealedMissing.push({ symbol, month: monthKey, tf: tfCache, reason: dry_run ? "dry_run" : "heal=false" });
        monthData.push({ month_key: monthKey, expected_count: expectedCount, actual_count: 0, missing_count: expectedCount, missing_dates: expectedKeys });
        continue;
      }
      try {
        const rawCandles = await cacheManager._retrieveFromProvider(symbol, mFrom+"T00:00:00.000Z", effectiveMonthTo+"T23:59:59.999Z", tfCache, exchange);
        if (!rawCandles || rawCandles.length === 0) throw new Error("0 candele restituite");
        const candles = mergeCandles([], rawCandles, tfCache);
        await cacheManager._writeL2MonthFile(symbol, tfCache, monthKey, candles, exchange);
        m.months_ok++;
        m.trading_days_present_post += candles.length;
        m.candles_added += candles.length;
        const healedDates  = new Set(candles.map((c) => String(c?.t ?? "").slice(0, 10)).filter(Boolean));
        const stillMissing = expectedKeys.filter((d) => !healedDates.has(d));
        monthData.push({ month_key: monthKey, expected_count: expectedCount, actual_count: healedDates.size, missing_count: stillMissing.length, missing_dates: stillMissing });
      } catch (err) {
        unhealedMissing.push({ symbol, month: monthKey, tf: tfCache, reason: err.message || "All providers failed" });
        monthData.push({ month_key: monthKey, expected_count: expectedCount, actual_count: 0, missing_count: expectedCount, missing_dates: expectedKeys });
      }
      continue;
    }

    // ── File presente ──────────────────────────────────
    let existing = [];
    try { existing = JSON.parse(fs.readFileSync(filePath, "utf8")); if (!Array.isArray(existing)) existing = []; } catch { existing = []; }
    // Per 1week: dedup domenica/lunedì in place (POLYGON vs ALPACA stessa settimana)
    if (tfCache === "1week" && existing.length > 0) {
      const deduped = mergeCandles([], existing, "1week");
      if (deduped.length !== existing.length) {
        existing = deduped;
        try { await cacheManager._writeL2MonthFile(symbol, tfCache, monthKey, existing, exchange); } catch { /* non critico */ }
      }
    }
    existing.length === 0 ? m.months_empty++ : m.months_ok++;

    if (isCurrentMonth) {
      try { const staleHours = getConfigInt("CURRENT_MONTH_STALE_THRESHOLD_HOURS", 12); if ((Date.now()-fs.statSync(filePath).mtimeMs) > staleHours*3600000) m.freshness = 50; } catch { m.freshness = 50; }
    }

    const normalizedExisting = normalizeCandles(existing, tfCache);
    const actualDates = new Set(normalizedExisting.map((c) => String(c?.t ?? "").slice(0,10)).filter(Boolean));
    m.trading_days_present_pre  += actualDates.size;
    m.trading_days_present_post += actualDates.size;

    const gaps = expectedKeys.filter((d) => !actualDates.has(d));
    if (gaps.length === 0) {
      monthData.push({ month_key: monthKey, expected_count: expectedCount, actual_count: actualDates.size, missing_count: 0, missing_dates: [] });
      continue;
    }

    m.gaps_found += gaps.length;
    m.details.gap_months.push({ month: monthKey, gaps });

    if (!heal || dry_run) {
      m.gaps_unhealed += gaps.length;
      unhealedGaps.push({ symbol, month: monthKey, tf: tfCache, gaps, reason: dry_run ? "dry_run" : "heal=false" });
      monthData.push({ month_key: monthKey, expected_count: expectedCount, actual_count: actualDates.size, missing_count: gaps.length, missing_dates: gaps });
      continue;
    }

    // Raggruppa gap contigui (per 1week: settimane consecutive ≤14gg, per altri: ≤4gg)
    const gapMergeThreshold = tfCache === "1week" ? 14 : 4;
    const ranges = [];
    let rs = gaps[0], re = gaps[0];
    for (let i = 1; i < gaps.length; i++) {
      if ((new Date(gaps[i]+"T12:00:00Z") - new Date(re+"T12:00:00Z")) / 86400000 <= gapMergeThreshold) { re = gaps[i]; }
      else { ranges.push({ from: rs, to: re }); rs = gaps[i]; re = gaps[i]; }
    }
    ranges.push({ from: rs, to: re });

    let addedThisMonth = 0, failError = "";
    for (const range of ranges) {
      try {
        const fetchTo = tfCache === "1week"
          ? (() => { const d = new Date(range.to+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()+6); return d.toISOString().slice(0,10); })()
          : range.to;
        const newC = await cacheManager._retrieveFromProvider(symbol, range.from+"T00:00:00.000Z", fetchTo+"T23:59:59.999Z", tfCache, exchange);
        if (newC && newC.length > 0) { const merged = mergeCandles(existing, newC, tfCache); addedThisMonth += merged.length - existing.length; existing = merged; await cacheManager._writeL2MonthFile(symbol, tfCache, monthKey, existing, exchange); }
      } catch (err) { failError = err.message || "All providers failed"; }
    }

    const normalizedPost = normalizeCandles(existing, tfCache);
    const actualPost  = new Set(normalizedPost.map((c) => String(c?.t ?? "").slice(0,10)).filter(Boolean));
    const residual    = expectedKeys.filter((d) => !actualPost.has(d));
    const healed      = gaps.length - residual.length;
    m.gaps_healed             += healed;
    m.gaps_unhealed           += residual.length;
    m.candles_added           += addedThisMonth;
    m.trading_days_present_post += addedThisMonth;
    if (residual.length > 0) unhealedGaps.push({ symbol, month: monthKey, tf: tfCache, gaps: residual, reason: failError });
    monthData.push({ month_key: monthKey, expected_count: expectedCount, actual_count: actualPost.size, missing_count: residual.length, missing_dates: residual });
  }

  // Scores pre/post
  m.completeness_pre       = m.trading_days_expected > 0 ? Math.round((m.trading_days_present_pre  / m.trading_days_expected) * 10000) / 100 : 100;
  m.gap_score_pre          = m.trading_days_expected > 0 ? Math.round(((m.trading_days_expected - m.gaps_found) / m.trading_days_expected) * 10000) / 100 : 100;
  m.quality_score_pre_heal = computeQualityScore({ trading_days_expected: m.trading_days_expected, trading_days_present: m.trading_days_present_pre,  gaps_unhealed: m.gaps_found,    months_checked: m.months_checked, months_ok: Math.max(0, m.months_ok - (m.candles_added > 0 ? 1 : 0)) });
  m.quality_score_post_heal = computeQualityScore({ trading_days_expected: m.trading_days_expected, trading_days_present: m.trading_days_present_post, gaps_unhealed: m.gaps_unhealed, months_checked: m.months_checked, months_ok: m.months_ok });

  return { metrics: m, unhealedMissing, unhealedGaps, monthData };
}

// -------------------------------------------------------
// Helper: aggrega metriche simbolo → summary job
// -------------------------------------------------------
function aggregateToSummary(summary, m) {
  summary.symbolsChecked++;
  summary.missingFiles          += m.months_missing;
  summary.missingFilesHealed    += Math.max(0, m.months_missing - m.months_ok);  // appross.
  summary.missingFilesUnhealed  += (m.months_missing > 0 && m.months_ok === 0) ? 1 : 0;
  summary.internalGapsFound     += m.gaps_found;
  summary.internalGapsHealed    += m.gaps_healed;
  summary.internalGapsUnhealed  += m.gaps_unhealed;
  summary.totalCandlesAdded     += m.candles_added;
}

function emptySummary() {
  return { symbolsChecked: 0, missingFiles: 0, missingFilesHealed: 0, missingFilesUnhealed: 0, internalGapsFound: 0, internalGapsHealed: 0, internalGapsUnhealed: 0, totalCandlesAdded: 0 };
}

function toScoreRow(m) {
  return {
    symbol: m.symbol, tf: m.tf,
    quality_score_pre_heal: m.quality_score_pre_heal, quality_score_post_heal: m.quality_score_post_heal,
    completeness_pre: m.completeness_pre, gap_score_pre: m.gap_score_pre, freshness: m.freshness,
    months_checked: m.months_checked, months_ok: m.months_ok, months_missing: m.months_missing, months_empty: m.months_empty,
    trading_days_expected: m.trading_days_expected, trading_days_present: m.trading_days_present_post,
    gaps_found: m.gaps_found, gaps_healed: m.gaps_healed, gaps_unhealed: m.gaps_unhealed, candles_added: m.candles_added,
    details: m.details, // { missing_months: [], gap_months: [{month, gaps:[...dates]}] }
  };
}

// -------------------------------------------------------
// Datahub persistence
// -------------------------------------------------------
async function persistToDb(job, allMetrics, logger) {
  const db      = axios.create({ baseURL: getConfigString(["DATAHUB_URL", "DBMANAGER_URL"], "http://datahub:3000"), timeout: 15000 });
  const today   = todayStr();
  const scores  = allMetrics;
  const weighted = scores.reduce((s,x) => s + x.quality_score_post_heal * (x.trading_days_expected || 1), 0);
  const totalW   = scores.reduce((s,x) => s + (x.trading_days_expected || 1), 0);
  const systemScore   = scores.length ? Math.round((weighted / (totalW || 1)) * 100) / 100 : null;
  const universeScore = scores.length ? Math.round((scores.reduce((s,x) => s + x.quality_score_post_heal, 0) / scores.length) * 100) / 100 : null;

  try {
    await db.post("/api/table/cache_quality_runs", {
      run_id: job.jobId, mode: job.params.dry_run ? "dry_run" : (job.params._scanMode || "heal"),
      started_at:  job.startedAt  ? job.startedAt.replace("T"," ").replace("Z","")  : null,
      finished_at: job.finishedAt ? job.finishedAt.replace("T"," ").replace("Z","") : null,
      symbols_checked:     job.summary.symbolsChecked,
      system_score:        systemScore,
      universe_score:      universeScore,
      symbols_below_50:    scores.filter((s) => s.quality_score_post_heal < 50).length,
      symbols_below_80:    scores.filter((s) => s.quality_score_post_heal < 80).length,
      total_gaps_found:    job.summary.internalGapsFound,
      total_gaps_healed:   job.summary.internalGapsHealed,
      total_candles_added: job.summary.totalCandlesAdded,
      params_json: JSON.stringify(job.params),
      status: job.status,
    });
    logger.info(`[heal] Scritto cache_quality_runs run_id=${job.jobId}`);
  } catch (err) { logger.error(`[heal] Errore cache_quality_runs: ${err.message}`); }

  for (const sc of scores) {
    try {
      await db.post("/api/table/cache_quality_scores", {
        run_id: job.jobId, symbol: sc.symbol, tf: sc.tf, check_date: today,
        range_from: job.params.from, range_to: job.params.to,
        quality_score: sc.quality_score_pre_heal, completeness: sc.completeness_pre,
        gap_score: sc.gap_score_pre, validity: 100, freshness: sc.freshness,
        quality_score_post_heal: sc.quality_score_post_heal,
        months_checked: sc.months_checked, months_ok: sc.months_ok, months_empty: sc.months_empty, months_missing: sc.months_missing,
        trading_days_expected: sc.trading_days_expected, trading_days_present: sc.trading_days_present,
        gaps_found: sc.gaps_found, gaps_healed: sc.gaps_healed, gaps_unhealed: sc.gaps_unhealed,
        invalid_candles: 0, candles_added: sc.candles_added, healed: sc.candles_added > 0 ? 1 : 0,
        details_json: JSON.stringify(sc),
      });
    } catch (err) { logger.error(`[heal] Errore cache_quality_scores symbol=${sc.symbol} tf=${sc.tf}: ${err.message}`); }
  }

  // Aggiorna job con system_score calcolato
  job.systemScore   = systemScore;
  job.universeScore = universeScore;
  logger.info(`[heal] Persistenza DB: ${scores.length} righe — system_score=${systemScore}`);
}

// -------------------------------------------------------
// Persistenza granulare per file: cache_quality_file_scores
// allMonthData: array di { metrics, monthData[] }
// -------------------------------------------------------
async function persistFileScoresToDb(job, allMonthData, logger) {
  const db  = axios.create({ baseURL: getConfigString(["DATAHUB_URL", "DBMANAGER_URL"], "http://datahub:3000"), timeout: 15000 });
  const now = new Date().toISOString().replace("T", " ").replace("Z", "");
  let written = 0, errors = 0;

  for (const { metrics, monthData } of allMonthData) {
    for (const entry of monthData) {
      const [year, month] = entry.month_key.split("-").map(Number);
      // Score per singolo file: completeness semplice (candele presenti / attese)
      const qualityScore = Math.min(100, entry.expected_count > 0
        ? Math.round((entry.actual_count / entry.expected_count) * 10000) / 100
        : 100);
      try {
        await db.post("/api/table/cache_quality_file_scores", {
          run_id:         job.jobId,
          symbol:         metrics.symbol,
          tf:             metrics.tf,
          year,
          month,
          expected_count: entry.expected_count,
          actual_count:   entry.actual_count,
          missing_count:  entry.missing_count,
          missing_dates:  JSON.stringify(entry.missing_dates ?? []),
          quality_score:  qualityScore,
          healed_at:      now,
        });
        written++;
      } catch (err) {
        errors++;
        logger.error(`[heal] Errore cache_quality_file_scores symbol=${metrics.symbol} tf=${metrics.tf} ${entry.month_key}: ${err.message}`);
      }
    }
  }
  logger.info(`[heal] cache_quality_file_scores: ${written} righe scritte, ${errors} errori`);
}

// -------------------------------------------------------
// Runner: job heal singolo TF (comportamento attuale)
// -------------------------------------------------------
async function runHealJob(job, cacheManager, logger) {
  const { params } = job;
  const { tf, from, to, heal, dry_run } = params;
  const tfCache     = cacheManager._normalizeTfCache(tf);
  const today       = todayStr();
  const effectiveTo = to > today ? today : to;

  job.status = "running";

  let symbols = [];
  if (params.symbol) {
    symbols = [params.symbol.toUpperCase()];
  } else {
    try {
      const root = path.isAbsolute(cacheManager.cacheBasePath||"cache") ? cacheManager.cacheBasePath : path.resolve(process.cwd(), cacheManager.cacheBasePath||"cache");
      symbols = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name.toUpperCase());
    } catch (err) { job.status = "error"; job.error = `Impossibile leggere cache: ${err.message}`; job.finishedAt = new Date().toISOString(); return; }
  }

  const summary      = emptySummary();
  const unhealed     = { missing_files: [], internal_gaps: [] };
  const allMetrics   = [];
  const allMonthData = []; // raccoglie { metrics, monthData } per persistFileScoresToDb
  const total        = symbols.length;
  const startTs      = Date.now();
  let done           = 0;

  for (const symbol of symbols) {
    if (job.aborted) break;

    job.progress = { done, total, currentSymbol: symbol, tf: tfCache, pct: total ? Math.round((done / total) * 100) : 0, eta_seconds: null };
    await publishProgress(cacheManager.bus, cacheManager.env, job.jobId, job.progress);

    const { metrics, unhealedMissing, unhealedGaps, monthData } = await healOneSymbol({ symbol, tfCache, from, to: effectiveTo, heal, dry_run, cacheManager, logger });
    aggregateToSummary(summary, metrics);
    allMetrics.push(metrics);
    allMonthData.push({ metrics, monthData });
    unhealed.missing_files.push(...unhealedMissing);
    unhealed.internal_gaps.push(...unhealedGaps);

    done++;
    const elapsed     = (Date.now() - startTs) / 1000;
    const eta_seconds = done > 0 && done < total ? Math.round((elapsed / done) * (total - done)) : 0;
    job.progress = { done, total, currentSymbol: symbol, tf: tfCache, pct: total ? Math.round((done / total) * 100) : 100, eta_seconds };
    await publishProgress(cacheManager.bus, cacheManager.env, job.jobId, job.progress);
  }

  if (job.aborted) {
    job.status     = "cancelled";
    job.finishedAt = new Date().toISOString();
    job.summary    = summary;
    job.unhealed   = unhealed;
    job.scores     = allMetrics.map(toScoreRow);
    logger.info(`[heal] Job ${job.jobId} annullato dopo ${done}/${total} symbols`);
    return;
  }

  job.status     = "completed";
  job.finishedAt = new Date().toISOString();
  job.summary    = summary;
  job.unhealed   = unhealed;
  job.scores     = allMetrics.map(toScoreRow);

  await publishProgress(cacheManager.bus, cacheManager.env, job.jobId, { type: "heal_complete", jobId: job.jobId, status: "completed", finishedAt: job.finishedAt });
  if (!dry_run) {
    persistToDb(job, allMetrics.map(toScoreRow), logger).catch((err) => logger.error(`[heal] DB error: ${err.message}`));
    persistFileScoresToDb(job, allMonthData, logger).catch((err) => logger.error(`[heal] File scores DB error: ${err.message}`));
  }
}

// -------------------------------------------------------
// Runner: full scan — tutti i TF/symbol presenti in cache
// -------------------------------------------------------
async function runFullScanJob(job, cacheManager, logger) {
  job.status = "running";
  const { heal, dry_run, days_back_per_tf: customDaysBack = {} } = job.params;
  const today = todayStr();

  // Merge default con custom
  const daysBackPerTf = { ...DEFAULT_DAYS_BACK_PER_TF, ...customDaysBack };

  // Discover TF+exchange → symbols (skips non-US exchange files)
  const tfEntries = discoverTfSymbols(cacheManager.cacheBasePath || "cache", (tf) => cacheManager._normalizeTfCache(tf));

  if (tfEntries.length === 0) {
    job.status = "done"; job.error = null;
    job.summary = { message: "Nessun file healabile trovato in cache L2 (i file con exchange non-US vengono saltati)" };
    job.finishedAt = new Date().toISOString();
    logger.info(`[heal/scan] Nessun file healabile trovato — la cache contiene solo file con exchange non-US o è vuota`);
    return;
  }

  const tfList = [...new Set(tfEntries.map((e) => e.tf))];
  const totalSymbols = new Set(tfEntries.flatMap((e) => [...e.symbols])).size;
  logger.info(`[heal/scan] TF trovati: ${tfList.join(", ")} — entries: ${tfEntries.length} — totale symbols unici: ${totalSymbols}`);

  // Filtro liquidità per TF intraday
  // min_intraday_vol letto da settings (es. 1000000 = $1M/giorno)
  const minIntradayVol = (() => {
    try { const v = getSetting("min_intraday_vol"); return v != null ? Number(v) : null; } catch { return null; }
  })();
  const dollarVolMap = (minIntradayVol != null && tfList.some(isIntradayTf))
    ? await fetchDollarVolMap(cacheManager.dbmanagerUrl || getConfigString(["DATAHUB_URL", "DBMANAGER_URL"], "http://datahub:3000"), logger)
    : new Map();
  if (minIntradayVol != null) {
    logger.info(`[heal/scan] Filtro liquidità intraday: min_intraday_vol=$${minIntradayVol.toLocaleString()}`);
  }

  const summary      = emptySummary();
  const unhealed     = { missing_files: [], internal_gaps: [] };
  const allMetrics   = [];
  const allMonthData = []; // raccoglie { metrics, monthData } per persistFileScoresToDb

  // Pre-compute total for progress tracking
  const total   = tfEntries.reduce((s, e) => s + e.symbols.size, 0);
  const startTs = Date.now();
  let done      = 0;

  for (const { tf: tfCache, exchange, symbols: symbolSet } of tfEntries) {
    const symbols  = [...symbolSet].sort();
    const daysBack = daysBackPerTf[tfCache] ?? 365;
    const from     = daysBackToFrom(daysBack);
    const to       = today;

    logger.info(`[heal/scan] TF=${tfCache} exchange=${exchange ?? "legacy"} symbols=${symbols.length} from=${from} to=${to}`);

    for (const symbol of symbols) {
      if (job.aborted) break;

      // Salta simboli a bassa liquidità per TF intraday
      if (minIntradayVol != null && isIntradayTf(tfCache)) {
        const dvol = dollarVolMap.get(symbol);
        if (dvol != null && dvol < minIntradayVol) {
          logger.info(`[heal/scan] Skip ${symbol}/${tfCache}: dollar_vol_20d=$${dvol.toLocaleString()} < $${minIntradayVol.toLocaleString()}`);
          done++;
          continue;
        }
      }

      job.progress = { done, total, currentSymbol: symbol, tf: tfCache, pct: total ? Math.round((done / total) * 100) : 0, eta_seconds: null };
      await publishProgress(cacheManager.bus, cacheManager.env, job.jobId, job.progress);

      const { metrics, unhealedMissing, unhealedGaps, monthData } = await healOneSymbol({ symbol, tfCache, exchange, from, to, heal, dry_run, cacheManager, logger });
      aggregateToSummary(summary, metrics);
      allMetrics.push(metrics);
      allMonthData.push({ metrics, monthData });
      unhealed.missing_files.push(...unhealedMissing);
      unhealed.internal_gaps.push(...unhealedGaps);

      done++;
      const elapsed     = (Date.now() - startTs) / 1000;
      const eta_seconds = done > 0 && done < total ? Math.round((elapsed / done) * (total - done)) : 0;
      job.progress = { done, total, currentSymbol: symbol, tf: tfCache, pct: total ? Math.round((done / total) * 100) : 100, eta_seconds };
      await publishProgress(cacheManager.bus, cacheManager.env, job.jobId, job.progress);
    }
    if (job.aborted) break;
  }

  if (job.aborted) {
    const totalW2      = allMetrics.reduce((s, m) => s + (m.trading_days_expected || 1), 0);
    const weightedSum2 = allMetrics.reduce((s, m) => s + m.quality_score_post_heal * (m.trading_days_expected || 1), 0);
    job.status        = "cancelled";
    job.finishedAt    = new Date().toISOString();
    job.summary       = summary;
    job.unhealed      = unhealed;
    job.scores        = allMetrics.map(toScoreRow);
    job.systemScore   = allMetrics.length ? Math.round((weightedSum2 / (totalW2||1)) * 100) / 100 : null;
    job.universeScore = allMetrics.length ? Math.round((allMetrics.reduce((s,m) => s + m.quality_score_post_heal, 0) / allMetrics.length) * 100) / 100 : null;
    logger.info(`[heal/scan] Job ${job.jobId} annullato dopo ${done}/${total} symbols`);
    return;
  }

  // System score (media pesata per trading_days_expected)
  const totalW      = allMetrics.reduce((s, m) => s + (m.trading_days_expected || 1), 0);
  const weightedSum = allMetrics.reduce((s, m) => s + m.quality_score_post_heal * (m.trading_days_expected || 1), 0);
  const systemScore    = allMetrics.length ? Math.round((weightedSum / (totalW||1)) * 100) / 100 : null;
  const universeScore  = allMetrics.length ? Math.round((allMetrics.reduce((s,m) => s + m.quality_score_post_heal, 0) / allMetrics.length) * 100) / 100 : null;

  job.status        = "completed";
  job.finishedAt    = new Date().toISOString();
  job.summary       = summary;
  job.unhealed      = unhealed;
  job.scores        = allMetrics.map(toScoreRow);
  job.systemScore   = systemScore;
  job.universeScore = universeScore;
  job.tfsScanned    = tfList;

  // Aggiorna params con from/to effettivi per la persistenza
  job.params.from = daysBackToFrom(Math.max(...tfList.map((tf) => daysBackPerTf[tf] ?? 365)));
  job.params.to   = today;
  job.params._scanMode = "full_scan";

  await publishProgress(cacheManager.bus, cacheManager.env, job.jobId, { type: "heal_complete", jobId: job.jobId, status: "completed", finishedAt: job.finishedAt });
  if (!dry_run) {
    persistToDb(job, allMetrics.map(toScoreRow), logger).catch((err) => logger.error(`[heal/scan] DB error: ${err.message}`));
    persistFileScoresToDb(job, allMonthData, logger).catch((err) => logger.error(`[heal/scan] File scores DB error: ${err.message}`));
  }
}

// -------------------------------------------------------
// Markdown report
// -------------------------------------------------------
function buildMarkdownReport(job) {
  const { jobId, startedAt, finishedAt, params, summary, unhealed, scores, systemScore, universeScore } = job;
  const lines = [
    `# Heal Report — ${jobId}`,
    `**Status:** ${job.status}   **Started:** ${startedAt}   **Finished:** ${finishedAt||"—"}`,
    "",
  ];
  if (systemScore != null) lines.push(`**System Score:** ${systemScore}   **Universe Score:** ${universeScore}`,"");
  lines.push("## Parametri","```json", JSON.stringify(params,null,2), "```","","## Summary","| Campo | Valore |","|-------|--------|");
  if (summary) for (const [k,v] of Object.entries(summary)) lines.push(`| ${k} | ${v} |`);

  if (scores?.length) {
    lines.push("","## Scores per Symbol/TF","| Symbol | TF | Score Pre | Score Post | Completeness | Gap Score | Mesi ok/tot | Gap h/u | +Candele |","|--------|----|-----------:|-----------:|-------------:|----------:|------------|---------|----------|");
    for (const s of scores.sort((a,b) => a.quality_score_post_heal - b.quality_score_post_heal)) {
      lines.push(`| ${s.symbol} | ${s.tf} | ${s.quality_score_pre_heal?.toFixed(1)} | **${s.quality_score_post_heal?.toFixed(1)}** | ${s.completeness_pre?.toFixed(1)}% | ${s.gap_score_pre?.toFixed(1)}% | ${s.months_ok}/${s.months_checked} | ${s.gaps_healed}/${s.gaps_unhealed} | ${s.candles_added||"—"} |`);
    }
  }

  lines.push("","## File non riparati");
  if (unhealed?.missing_files?.length) { lines.push("### File mancanti","| Simbolo | Mese | TF | Motivo |","|---------|------|----|--------|"); for (const u of unhealed.missing_files) lines.push(`| ${u.symbol} | ${u.month} | ${u.tf} | ${u.reason} |`); }
  if (unhealed?.internal_gaps?.length) { lines.push("### Gap interni","| Simbolo | Mese | TF | Gap | Motivo |","|---------|------|----|-----|--------|"); for (const u of unhealed.internal_gaps) lines.push(`| ${u.symbol} | ${u.month} | ${u.tf} | ${(u.gaps||[]).join(", ")} | ${u.reason} |`); }
  if (!unhealed?.missing_files?.length && !unhealed?.internal_gaps?.length) lines.push("_Nessun elemento non riparato._");
  return lines.join("\n");
}

// -------------------------------------------------------
// In-memory job store
// -------------------------------------------------------
const MAX_JOBS = 20;
const jobs = new Map();
function storeJob(job) { if (jobs.size >= MAX_JOBS) jobs.delete(jobs.keys().next().value); jobs.set(job.jobId, job); }

// -------------------------------------------------------
// Factory
// -------------------------------------------------------
module.exports = function createHealModule(cacheManager, logger) {
  function makeJob(params) {
    const jobId = `heal_${Date.now()}_${randomUUID().slice(0,6)}`;
    const job   = { jobId, status: "running", startedAt: new Date().toISOString(), finishedAt: null, error: null, params, summary: null, unhealed: null, scores: null, systemScore: null, universeScore: null };
    storeJob(job);
    return job;
  }

  return {
    /** POST /l2/heal — singolo TF, tutti o un simbolo */
    startJob(params) {
      const job = makeJob(params);
      runHealJob(job, cacheManager, logger).catch((err) => { job.status = "error"; job.error = err.message||String(err); job.finishedAt = new Date().toISOString(); logger.error(`[heal] crash ${job.jobId}: ${job.error}`); });
      return { jobId: job.jobId, status: job.status, startedAt: job.startedAt };
    },

    /** POST /l2/heal/scan — tutti i TF/symbol presenti in cache */
    startScanJob(params) {
      const job = makeJob(params);
      runFullScanJob(job, cacheManager, logger).catch((err) => { job.status = "error"; job.error = err.message||String(err); job.finishedAt = new Date().toISOString(); logger.error(`[heal/scan] crash ${job.jobId}: ${job.error}`); });
      return { jobId: job.jobId, status: job.status, startedAt: job.startedAt };
    },

    getJob(jobId) { return jobs.get(jobId) || null; },

    listJobs() {
      return Array.from(jobs.values()).sort((a,b) => new Date(b.startedAt)-new Date(a.startedAt)).slice(0,10)
        .map(({ jobId, status, startedAt, finishedAt, params, summary, scores, systemScore, universeScore, tfsScanned, progress }) => ({ jobId, status, startedAt, finishedAt, params, summary, scores, systemScore, universeScore, tfsScanned, progress }));
    },

    cancelJob(jobId) {
      const job = jobs.get(jobId);
      if (!job) return false;
      if (job.status === "running") {
        // Segnala al runner di fermarsi al prossimo ciclo
        job.aborted = true;
        // status e finishedAt verranno aggiornati dal runner stesso
      } else {
        jobs.delete(jobId);
      }
      return true;
    },

    buildMarkdownReport,
    DEFAULT_DAYS_BACK_PER_TF,
  };
};
