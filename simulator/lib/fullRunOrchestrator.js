"use strict";

// ---------------------------------------------------------------------------
// lib/fullRunOrchestrator.js — Multi-day simulation orchestrator
//
// Per ogni giorno lavorativo in [fromDate, toDate]:
//   1. POST tickerscanner/fundamentals/update-market-daily  { date }
//      → poll fino a completamento (skip se dati già presenti in tabella)
//   2. POST tickerscanner/fundamentals/user-daily-scores    { date, userId, pipeId }
//      → poll fino a completamento
//   3. POST tickerscanner/fundamentals/ranking/daily        { score_date: date, mode: "force" }
//   4. GET  decision-engine/spot-finder/:pipeId?date=date   (sync, auto-subscribes tickers)
//   5. loop intraday tick per i ticker sottoscritti
// ---------------------------------------------------------------------------

const axios               = require("axios");
const simController       = require("../modules/simController");
const { publishSnapshot } = require("./snapshotPublisher");
const { pollUntilDone }   = require("./jobPoller");
const fullRunState        = require("./fullRunState");
const orderBook           = require("../modules/orderBook");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ritorna YYYY-MM-DD lun–ven nell'intervallo [from, to]. */
function businessDays(from, to) {
  const days = [];
  const cur = new Date(from + "T12:00:00Z");
  const end = new Date(to   + "T12:00:00Z");
  while (cur <= end) {
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

function log(logger, logLine, msg) {
  logger?.info?.(msg);
  logLine(msg);
}

/** Headers comuni per le chiamate ai microservizi interni. */
function internalHeaders(userId) {
  return { "x-user-id": String(userId) };
}

// ---------------------------------------------------------------------------
// Phase 0: liquidity-manager score
// ---------------------------------------------------------------------------
async function runLiquidityScore({ liquidityManagerUrl, date, logger, logLine }) {
  // Verifica se il liquidity score per questa data esiste già
  try {
    const resp = await axios.get(
      `${liquidityManagerUrl}/liquidity-score/history?days=3`,
      { timeout: 10000 }
    );
    const items = Array.isArray(resp.data?.items) ? resp.data.items : [];
    const exists = items.some((r) => r?.score_date?.slice(0, 10) === date);
    if (exists) {
      log(logger, logLine, `[fullRun] liquidity-score SKIP (già presente) date=${date}`);
      return;
    }
  } catch { /* non fatale — procedi con il calcolo */ }

  log(logger, logLine, `[fullRun] liquidity-score START date=${date}`);
  // backfill accetta from/to e calcola per quella data specifica
  await axios.post(
    `${liquidityManagerUrl}/admin/backfill`,
    { from: date, to: date },
    { timeout: 120000 }
  );
  log(logger, logLine, `[fullRun] liquidity-score DONE date=${date}`);
}

// ---------------------------------------------------------------------------
// Skip check: i dati market_daily per questa data esistono già?
// ---------------------------------------------------------------------------
async function isMarketDailyAlreadyLoaded({ datahubUrl, date }) {
  try {
    const resp = await axios.get(
      `${datahubUrl}/api/table/market_daily?trade_date=${encodeURIComponent(date)}&limit=1`,
      { timeout: 10000 }
    );
    const items = Array.isArray(resp.data?.items) ? resp.data.items : Array.isArray(resp.data?.data) ? resp.data.data : Array.isArray(resp.data) ? resp.data : [];
    return items.length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Phase 1: tickerscanner update-market-daily
// ---------------------------------------------------------------------------
async function runMarketDaily({ tickerscannerUrl, datahubUrl, date, userId, logger, logLine }) {
  const alreadyLoaded = await isMarketDailyAlreadyLoaded({ datahubUrl, date });
  if (alreadyLoaded) {
    log(logger, logLine, `[fullRun] market-daily SKIP (già presente) date=${date}`);
    return;
  }

  log(logger, logLine, `[fullRun] market-daily START date=${date}`);
  const resp = await axios.post(
    `${tickerscannerUrl}/fundamentals/update-market-daily`,
    { date },
    { timeout: 15000, headers: internalHeaders(userId) }
  );
  const jobId = resp.data?.jobId;
  if (!jobId) {
    log(logger, logLine, `[fullRun] market-daily no jobId — assuming sync`);
    return;
  }

  await pollUntilDone({
    fetchStatus: () =>
      axios.get(`${tickerscannerUrl}/fundamentals/update-market-daily`, { timeout: 10000, headers: internalHeaders(userId) })
        .then((r) => {
          const jobs = Array.isArray(r.data?.jobs) ? r.data.jobs : [];
          const found = jobs.find((j) => j.id === jobId);
          if (!found) return { status: "completed" };
          return found;
        }),
    isDone:   (d) => ["completed", "error", "cancelled"].includes(d?.status),
    isError:  (d) => ["error", "cancelled"].includes(d?.status),
    errorMsg: (d) => `market-daily job ${jobId} failed: ${d?.error ?? d?.status}`,
    intervalMs: 3000,
    timeoutMs:  180000,
  });
  log(logger, logLine, `[fullRun] market-daily DONE date=${date} jobId=${jobId}`);
}

// ---------------------------------------------------------------------------
// Skip check: daily_scores per questa data esistono già?
// ---------------------------------------------------------------------------
async function isUserDailyScoresAlreadyLoaded({ tickerscannerUrl, date, userId }) {
  try {
    const resp = await axios.get(
      `${tickerscannerUrl}/fundamentals/ranking/daily?score_date=${encodeURIComponent(date)}&limit=1`,
      { timeout: 10000, headers: internalHeaders(userId) }
    );
    const rows = Array.isArray(resp.data?.data) ? resp.data.data : Array.isArray(resp.data) ? resp.data : [];
    return rows.length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Phase 2: tickerscanner user-daily-scores
// ---------------------------------------------------------------------------
async function runUserDailyScores({ tickerscannerUrl, date, userId, pipeId, logger, logLine }) {
  const alreadyLoaded = await isUserDailyScoresAlreadyLoaded({ tickerscannerUrl, date, userId });
  if (alreadyLoaded) {
    log(logger, logLine, `[fullRun] user-daily-scores SKIP (già presente) date=${date}`);
    return;
  }
  log(logger, logLine, `[fullRun] user-daily-scores START date=${date}`);
  const resp = await axios.post(
    `${tickerscannerUrl}/fundamentals/user-daily-scores`,
    { date, userId, pipeId },
    { timeout: 15000, headers: internalHeaders(userId) }
  );
  const jobId = resp.data?.jobId ?? resp.data?.jobs?.[0]?.job_id ?? null;
  if (!jobId) {
    log(logger, logLine, `[fullRun] user-daily-scores no jobId — assuming sync`);
    return;
  }
  await pollUntilDone({
    fetchStatus: () =>
      axios.get(
        `${tickerscannerUrl}/fundamentals/user-daily-score-jobs?job_id=${encodeURIComponent(jobId)}&limit=1`,
        { timeout: 10000, headers: internalHeaders(userId) }
      ).then((r) => {
        const items = Array.isArray(r.data?.items) ? r.data.items : Array.isArray(r.data) ? r.data : [];
        return items[0] ?? { status: "unknown" };
      }),
    isDone:   (d) => ["completed", "error", "cancelled"].includes(d?.status),
    isError:  (d) => ["error", "cancelled"].includes(d?.status),
    errorMsg: (d) => `user-daily-scores job ${jobId} failed: ${d?.error ?? d?.status}`,
    intervalMs: 2000,
    timeoutMs:  120000,
  });
  log(logger, logLine, `[fullRun] user-daily-scores DONE date=${date} jobId=${jobId}`);
}

// ---------------------------------------------------------------------------
// Phase 3: tickerscanner ranking/daily
// ---------------------------------------------------------------------------
async function runRanking({ tickerscannerUrl, date, userId, logger, logLine }) {
  try {
    const resp = await axios.get(
      `${tickerscannerUrl}/fundamentals/ranking/daily?score_date=${encodeURIComponent(date)}&limit=1`,
      { timeout: 10000, headers: internalHeaders(userId) }
    );
    const rows = Array.isArray(resp.data?.data) ? resp.data.data : Array.isArray(resp.data) ? resp.data : [];
    if (rows.length > 0) {
      log(logger, logLine, `[fullRun] ranking SKIP (già presente) date=${date}`);
      return;
    }
  } catch { /* non fatale — procedi con il calcolo */ }

  log(logger, logLine, `[fullRun] ranking START date=${date}`);
  await axios.post(
    `${tickerscannerUrl}/fundamentals/ranking/daily`,
    { score_date: date, mode: "normal" },
    { timeout: 30000, headers: internalHeaders(userId) }
  );
  log(logger, logLine, `[fullRun] ranking DONE date=${date}`);
}

// ---------------------------------------------------------------------------
// Phase 4: decision-engine pipe execution
// ---------------------------------------------------------------------------
async function runPipe({ decisionengineUrl, pipeId, date, userId, logger, logLine }) {
  log(logger, logLine, `[fullRun] pipe START pipeId=${pipeId} date=${date}`);
  const resp = await axios.get(
    `${decisionengineUrl}/spot-finder/${encodeURIComponent(pipeId)}?date=${encodeURIComponent(date)}`,
    { timeout: 120000, headers: internalHeaders(userId) }
  );
  const tickers = resp.data?.tickers ?? resp.data?.result?.tickers ?? [];
  log(logger, logLine, `[fullRun] pipe DONE date=${date} tickers=${tickers.length}`);
  return tickers;
}

// ---------------------------------------------------------------------------
// Phase 5: intraday candle simulation
// ---------------------------------------------------------------------------
async function runIntraday({ date, tickers, tf, pipeId, decisionengineUrl, svc, fetcher, logger, logLine }) {
  if (!tickers.length) {
    log(logger, logLine, `[fullRun] intraday SKIP — no tickers date=${date}`);
    return;
  }
  log(logger, logLine, `[fullRun] intraday START date=${date} tickers=${tickers.join(",")} tf=${tf}`);

  // Avvia live sul decision-engine per la data simulata.
  // Questo carica lo snapshot già calcolato dalla pipe execution e attiva liveState.
  try {
    await axios.post(
      `${decisionengineUrl}/live/${encodeURIComponent(pipeId)}?date=${encodeURIComponent(date)}`,
      { enabled: true },
      { timeout: 30000 }
    );
    log(logger, logLine, `[fullRun] live ENABLED pipeId=${pipeId} date=${date}`);
  } catch (err) {
    log(logger, logLine, `[fullRun] live enable FAILED: ${err?.message} — continuo senza live`);
  }

  await simController.start(
    { fromDate: date, toDate: date, tickers, tf, initialCapital: undefined },
    fetcher,
    logger,
    svc
  );

  const bus     = svc?.bus;
  const channel = svc?.marketDataChannel;
  let hasMore   = true;

  while (hasMore) {
    const result = await simController.tick(logger, {});

    if (bus && channel && result.candles && Object.keys(result.candles).length > 0) {
      await Promise.all(
        Object.entries(result.candles).map(([sym, candle]) =>
          publishSnapshot(bus, channel, sym, candle).catch((e) => {
            logger?.warning?.(`[fullRun] publish ${sym}: ${e?.message}`);
          })
        )
      );
    }

    fullRunState.addTick();
    hasMore = result.hasMore;
  }

  simController.stop(logger);

  // Ferma la sessione live del decision-engine a fine giornata
  try {
    await axios.delete(
      `${decisionengineUrl}/live/${encodeURIComponent(pipeId)}`,
      { timeout: 10000 }
    );
    log(logger, logLine, `[fullRun] live STOPPED pipeId=${pipeId} date=${date}`);
  } catch (err) {
    log(logger, logLine, `[fullRun] live stop FAILED: ${err?.message}`);
  }

  log(logger, logLine, `[fullRun] intraday DONE date=${date}`);
}

// ---------------------------------------------------------------------------
// Main entry point — fire-and-forget dal route handler
// ---------------------------------------------------------------------------
async function runFullSimulation({
  runId, fromDate, toDate, pipeId, userId, tf, svc, fetcher, logger,
}) {
  const tickerscannerUrl    = svc.tickerscannerUrl;
  const decisionengineUrl   = svc.decisionengineUrl;
  const liquidityManagerUrl = svc.liquidityManagerUrl || null;
  const datahubUrl          = (svc.dbmanagerUrl || svc.datahubUrl || "http://datahub:3000").replace(/\/+$/, "");

  const days = businessDays(fromDate, toDate);
  fullRunState.start({ runId, fromDate, toDate, pipeId, userId, days });

  const logLine = (msg) => fullRunState.addLog(msg);
  log(logger, logLine, `[fullRun] START runId=${runId} days=${days.length} from=${fromDate} to=${toDate}`);

  try {
    for (let i = 0; i < days.length; i++) {
      const date = days[i];
      fullRunState.setDay(i);

      // 0. Liquidity score (non bloccante — continua anche se il servizio non è disponibile)
      fullRunState.setPhase("liquidity-score");
      if (liquidityManagerUrl) {
        try {
          await runLiquidityScore({ liquidityManagerUrl, date, logger, logLine });
        } catch (err) {
          log(logger, logLine, `[fullRun] liquidity-score WARN: ${err?.message} — continuo`);
        }
      } else {
        log(logger, logLine, `[fullRun] liquidity-score SKIP — liquidityManagerUrl non configurato`);
      }

      // 1. Market daily
      fullRunState.setPhase("market-daily");
      await runMarketDaily({ tickerscannerUrl, datahubUrl, date, userId, logger, logLine });

      fullRunState.setPhase("user-scores");
      await runUserDailyScores({ tickerscannerUrl, date, userId, pipeId, logger, logLine });

      fullRunState.setPhase("ranking");
      await runRanking({ tickerscannerUrl, date, userId, logger, logLine });

      fullRunState.setPhase("pipe");
      const tickers = await runPipe({ decisionengineUrl, pipeId, date, userId, logger, logLine });

      // Clear previous day orders before intraday so counts are per-day
      orderBook.clear();

      fullRunState.setPhase("intraday");
      await runIntraday({ date, tickers, tf, pipeId, decisionengineUrl, svc, fetcher, logger, logLine });

      // Collect day summary from orderBook
      const dayOrders = orderBook.getAllOrders();
      const ordersTotal     = dayOrders.length;
      const ordersFilled    = dayOrders.filter((o) => o.status === "FILLED").length;
      const ordersCancelled = dayOrders.filter((o) => o.status === "CANCELLED").length;
      const ordersPending   = dayOrders.filter((o) => o.status === "PENDING").length;
      fullRunState.addDaySummary({ date, tickers, ordersTotal, ordersFilled, ordersCancelled, ordersPending });
      log(logger, logLine, `[fullRun] day SUMMARY date=${date} tickers=${tickers.length} orders=${ordersTotal} filled=${ordersFilled} pending=${ordersPending}`);
    }

    fullRunState.finish();
    const snap = fullRunState.getSnapshot();
    log(logger, logLine, `[fullRun] DONE runId=${runId} totalTicks=${snap.tickCount} totalOrders=${snap.totals.ordersTotal} filled=${snap.totals.ordersFilled}`);
  } catch (err) {
    logger?.error?.(`[fullRun] FAILED runId=${runId}: ${err?.message}`);
    fullRunState.fail(err);
  }
}

module.exports = { runFullSimulation, businessDays };
