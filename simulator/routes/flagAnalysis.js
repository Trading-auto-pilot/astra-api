"use strict";

// ---------------------------------------------------------------------------
// routes/flagAnalysis.js
//
// POST /flag-analysis/run
//   Avvia un'analisi rolling-window del pattern flag su dati storici dal
//   cachemanager. Persiste i risultati su datahub (tabelle flag_analysis_runs
//   e flag_analysis_events). Esecuzione asincrona: risponde subito con runId,
//   poi elabora in background.
//
// GET  /flag-analysis/runs
//   Lista delle ultime N run con statistiche aggregate.
//
// GET  /flag-analysis/runs/:runId
//   Dettaglio di una run specifica.
//
// GET  /flag-analysis/events
//   Query sugli eventi con filtri: runId, symbol, flagOk, spikeDetected, da/a.
// ---------------------------------------------------------------------------

const express       = require("express");
const axios         = require("axios");
const { randomUUID } = require("crypto");
const { analyzeCandles } = require("../modules/flagAnalyzer");

const BATCH_SIZE = 200; // max righe per singola POST a datahub

function createFlagAnalysisRouter({ getService, logger }) {
  const router = express.Router();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function getDatahubAxios() {
    const svc = getService();
    const url = svc?.dbmanagerUrl || "http://datahub:3000";
    return axios.create({ baseURL: url, timeout: 30000 });
  }

  function getCandleFetcher() {
    const svc = getService();
    if (!svc?._fetcher) throw new Error("Simulator not initialized (fetcher not available)");
    return svc._fetcher;
  }

  async function persistRunSummary(dh, run) {
    await dh.post("/api/table/flag_analysis_runs", run);
  }

  async function updateRunSummary(dh, runId, patch) {
    // Recupera l'id numerico della run
    const resp = await dh.get(`/api/table/flag_analysis_runs?run_id=${encodeURIComponent(runId)}&limit=1`);
    const rows = resp.data?.items || resp.data?.data || (Array.isArray(resp.data) ? resp.data : []);
    if (!rows.length) return;
    const id = rows[0].id;
    await dh.put(`/api/table/flag_analysis_runs/${id}`, patch);
  }

  async function persistEvents(dh, events) {
    let inserted = 0, failed = 0;
    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batch = events.slice(i, i + BATCH_SIZE);
      // Promise.allSettled: un insert fallito non blocca il resto del batch né i batch successivi
      const results = await Promise.allSettled(
        batch.map((row) => dh.post("/api/table/flag_analysis_events", row))
      );
      for (const r of results) {
        if (r.status === "fulfilled") inserted++;
        else { failed++; logger?.warning?.(`[persistEvents] insert failed: ${r.reason?.message || r.reason}`); }
      }
    }
    if (failed > 0) logger?.warning?.(`[persistEvents] ${failed} insert(s) failed, ${inserted} ok`);
    return inserted;
  }

  // Converte data ISO o stringa in formato "YYYY-MM-DD HH:MM:SS" per MySQL
  function toMysqlTs(v) {
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().replace("T", " ").slice(0, 19);
  }

  // ---------------------------------------------------------------------------
  // POST /flag-analysis/run
  // ---------------------------------------------------------------------------

  /**
   * Body:
   * {
   *   tickers:       string[]   (obbligatorio)
   *   tf:            string     (default "1Hour")
   *   dateFrom:      string     ISO date
   *   dateTo:        string     ISO date (default oggi)
   *   flagBars:      number     (default 20)
   *   flagAtrK:      number     (default 1.3)
   *   flagPctK:      number     (default 0.0025)
   *   volMult:       number     (default 1.2)
   *   lookaheadBars: number     (default 20)
   *   spikePct:      number     (default 0.005 = 0.5%)
   * }
   */
  router.post("/run", async (req, res) => {
    const fn = "[POST /flag-analysis/run]";
    try {
      const {
        tickers,
        tf            = "1Hour",
        dateFrom,
        dateTo        = new Date().toISOString().slice(0, 10),
        flagBars      = 20,
        flagAtrK      = 1.3,
        flagPctK      = 0.0025,
        volMult       = 1.2,
        lookaheadBars = 20,
        spikePct      = 0.005,
        stride        = 1,
        impulseBars   = 80,
        atrPeriod     = 20,
        swingWindow   = 3,
      } = req.body || {};

      if (!Array.isArray(tickers) || tickers.length === 0) {
        return res.status(400).json({ ok: false, error: "tickers[] è obbligatorio" });
      }
      if (!dateFrom) {
        return res.status(400).json({ ok: false, error: "dateFrom è obbligatorio" });
      }

      const runId    = `flag_${Date.now()}_${randomUUID().slice(0, 8)}`;
      const startedAt = toMysqlTs(new Date());
      const params = { flagBars, flagAtrK, flagPctK, volMult, lookaheadBars, spikePct, stride, impulseBars, atrPeriod, swingWindow };

      // Risponde subito con runId
      res.json({ ok: true, runId, status: "running", tickers, tf, dateFrom, dateTo, params });

      // Elaborazione asincrona
      setImmediate(async () => {
        const dh = getDatahubAxios();
        try {
          // Crea run record
          await persistRunSummary(dh, {
            run_id:          runId,
            started_at:      startedAt,
            tickers:         JSON.stringify(tickers),
            tf,
            date_from:       dateFrom,
            date_to:         dateTo,
            flag_bars:       flagBars,
            flag_atr_k:      flagAtrK,
            flag_pct_k:      flagPctK,
            vol_mult:        volMult,
            lookahead_bars:  lookaheadBars,
            stride:          stride,
            spike_pct:       spikePct,
            impulse_bars:    impulseBars,
            atr_period:      atrPeriod,
            swing_window:    swingWindow,
            status:          "running",
          });
        } catch (e) {
          logger?.warning?.(`${fn} persistRunSummary failed: ${e?.message}`);
        }

        const fetcher = getCandleFetcher();
        let totalWindows        = 0;
        let flagOkCount         = 0;
        let totalTrendOkWindows = 0;
        let tickersWithData     = 0;   // ticker con abbastanza candele da analizzare
        let actualDateFrom      = null; // prima candela reale (min tra tutti i ticker)
        let actualDateTo        = null; // ultima candela reale (max tra tutti i ticker)
        const allEvents  = [];
        const tickerTrendOkWin  = {}; // totalTrendOkWindows per ticker, per by_symbol
        const tickerCondFails   = {}; // condFail per ticker

        for (const ticker of tickers) {
          try {
            logger?.info?.(`${fn} fetching ${ticker} tf=${tf} ${dateFrom}→${dateTo}`);
            const candles = await fetcher.getRange(ticker, dateFrom, dateTo, tf);

            if (!Array.isArray(candles) || candles.length < 60) {
              logger?.warning?.(`${fn} ${ticker}: solo ${candles?.length ?? 0} candele, skip`);
              continue;
            }

            // Normalizza: assicura campi {t,h,l,c,v} come numeri
            // Il cachemanager può restituire il timestamp in campi diversi
            const normalized = candles.map((c) => ({
              t: c.t ?? c.timestamp ?? c.date ?? c.ts ?? c.time ?? c.datetime ?? null,
              h: Number(c.h ?? c.high),
              l: Number(c.l ?? c.low),
              c: Number(c.c ?? c.close),
              v: Number(c.v ?? c.volume),
            })).filter((c) => isFinite(c.h) && isFinite(c.l) && isFinite(c.c));

            tickersWithData++;

            // Traccia periodo effettivo coperto dai dati reali
            const firstT = normalized[0]?.t;
            const lastT  = normalized[normalized.length - 1]?.t;
            if (firstT) {
              const d = new Date(firstT);
              if (!isNaN(d) && (!actualDateFrom || d < new Date(actualDateFrom))) actualDateFrom = firstT;
            }
            if (lastT) {
              const d = new Date(lastT);
              if (!isNaN(d) && (!actualDateTo || d > new Date(actualDateTo))) actualDateTo = lastT;
            }

            const firstTs = normalized[0]?.t ?? "(null — controlla campo timestamp del cachemanager)";
            logger?.info?.(`${fn} ${ticker}: ${normalized.length} candele, firstTs=${firstTs}`);

            const { events, totalTrendOkWindows: trendOkWin, condFail: tickerCondFail } = analyzeCandles(normalized, ticker, tf, params, runId);
            const windowSize = Math.max(100, normalized.length < 100 ? 0 : 100);
            totalWindows += Math.max(0, Math.ceil((normalized.length - windowSize) / stride)); // finestre totali con stride
            totalTrendOkWindows += trendOkWin;
            tickerTrendOkWin[ticker] = trendOkWin;
            tickerCondFails[ticker] = tickerCondFail;
            allEvents.push(...events);

            logger?.info?.(`${fn} ${ticker}: ${events.length} eventi (flagOk=${events.filter(e=>e.flag_ok===1).length})`);
          } catch (tickerErr) {
            logger?.warning?.(`${fn} ${ticker} error: ${tickerErr?.message}`);
          }
        }

        // ── Calcolo stats completo in memoria (tutti gli eventi, nessun limite DB) ──
        flagOkCount = allEvents.filter((e) => e.flag_ok === 1).length;

        const _trendOkCount   = allEvents.filter((e) => e.trend_ok === 1).length;
        const _missedCount    = allEvents.filter((e) => e.flag_ok === 0 && e.spike_detected === 1).length;
        const _spikeCount     = allEvents.filter((e) => e.spike_detected === 1).length;
        const _trendOkSpike   = allEvents.filter((e) => e.trend_ok === 1 && e.spike_detected === 1).length;
        const _flagOkSpike    = allEvents.filter((e) => e.flag_ok === 1 && e.spike_detected === 1).length;
        const _flagOkConf     = allEvents.filter((e) => e.flag_ok === 1 && e.spike_detected === 1 && e.breakout_confirmed === 1).length;
        const _confirmedCount = allEvents.filter((e) => e.spike_detected === 1 && e.breakout_confirmed === 1).length;

        const _failReasons = {};
        allEvents.filter((e) => e.flag_ok === 0).forEach((e) => {
          const r = e.fail_reason || "unknown";
          _failReasons[r] = (_failReasons[r] || 0) + 1;
        });

        const _bySymbol = {};
        for (const e of allEvents) {
          const s = e.symbol;
          if (!_bySymbol[s]) _bySymbol[s] = {
            totalTrendOkWindows: tickerTrendOkWin[s] || 0,
            condFail: tickerCondFails[s] || { range_too_wide: 0, slope_negative: 0, volume_not_contracted: 0 },
            trendOk: 0, flagOk: 0, missed: 0, allSpikes: 0, trendOkSpike: 0, flagOkSpike: 0, flagOkConfirmed: 0, confirmed: 0,
          };
          if (e.trend_ok === 1)                                              _bySymbol[s].trendOk++;
          if (e.flag_ok === 1)                                               _bySymbol[s].flagOk++;
          if (e.flag_ok === 0 && e.spike_detected === 1)                     _bySymbol[s].missed++;
          if (e.spike_detected === 1)                                        _bySymbol[s].allSpikes++;
          if (e.trend_ok === 1 && e.spike_detected === 1)                    _bySymbol[s].trendOkSpike++;
          if (e.flag_ok === 1 && e.spike_detected === 1)                     _bySymbol[s].flagOkSpike++;
          if (e.flag_ok === 1 && e.spike_detected === 1 && e.breakout_confirmed === 1) _bySymbol[s].flagOkConfirmed++;
          if (e.spike_detected === 1 && e.breakout_confirmed === 1)          _bySymbol[s].confirmed++;
        }
        // Assicura entry per tutti i ticker analizzati (anche senza eventi registrati)
        for (const [sym, win] of Object.entries(tickerTrendOkWin)) {
          if (!_bySymbol[sym]) _bySymbol[sym] = {
            totalTrendOkWindows: win,
            condFail: tickerCondFails[sym] || { range_too_wide: 0, slope_negative: 0, volume_not_contracted: 0 },
            trendOk: 0, flagOk: 0, missed: 0, allSpikes: 0, trendOkSpike: 0, flagOkSpike: 0, flagOkConfirmed: 0, confirmed: 0,
          };
        }

        // Totale globale condFail (somma su tutti i ticker)
        const _globalCondFail = { range_too_wide: 0, slope_negative: 0, volume_not_contracted: 0 };
        for (const s of Object.values(_bySymbol)) {
          _globalCondFail.range_too_wide        += s.condFail?.range_too_wide        || 0;
          _globalCondFail.slope_negative        += s.condFail?.slope_negative        || 0;
          _globalCondFail.volume_not_contracted += s.condFail?.volume_not_contracted || 0;
        }

        // Ticker che hanno prodotto almeno uno spike (da by_symbol in memoria)
        const tickersWithSpikes = Object.values(_bySymbol).filter((s) => s.allSpikes > 0).length;

        // Persiste eventi
        if (allEvents.length > 0) {
          try {
            logger?.info?.(`${fn} persisting ${allEvents.length} events (flagOk=${flagOkCount})...`);
            await persistEvents(dh, allEvents);
          } catch (persistErr) {
            logger?.warning?.(`${fn} persistEvents error: ${persistErr?.message}`);
          }
        }

        // Aggiorna run summary con stats pre-calcolate
        try {
          await updateRunSummary(dh, runId, {
            finished_at:              toMysqlTs(new Date()),
            total_windows:            totalWindows,
            total_trend_ok_windows:   totalTrendOkWindows,
            tickers_with_data:        tickersWithData,
            tickers_with_spikes:      tickersWithSpikes,
            actual_date_from:         actualDateFrom ? actualDateFrom.toString().slice(0, 10) : null,
            actual_date_to:           actualDateTo   ? actualDateTo.toString().slice(0, 10)   : null,
            flag_ok_count:            flagOkCount,
            trend_ok_count:           _trendOkCount,
            missed_count:      _missedCount,
            spike_count:       _spikeCount,
            trend_ok_spike:    _trendOkSpike,
            flag_ok_spike:     _flagOkSpike,
            flag_ok_confirmed: _flagOkConf,
            confirmed_count:   _confirmedCount,
            fail_reasons_json: JSON.stringify({ ..._failReasons, _condFail: _globalCondFail }),
            by_symbol_json:    JSON.stringify(_bySymbol),
            status:            "completed",
          });
        } catch (e) {
          logger?.warning?.(`${fn} updateRunSummary failed: ${e?.message}`);
        }

        logger?.info?.(`${fn} run ${runId} completed — ${allEvents.length} events, trendOk=${_trendOkCount}, flagOk=${flagOkCount}, spikes=${_spikeCount}`);
      });

    } catch (err) {
      logger?.warning?.(`${fn} ${err?.message}`);
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /flag-analysis/runs
  // ---------------------------------------------------------------------------
  router.get("/runs", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const dh = getDatahubAxios();
      const resp = await dh.get(`/api/table/flag_analysis_runs?limit=${limit}&sort_by=started_at&sort_dir=desc`);
      const rows = resp.data?.items || resp.data?.data || (Array.isArray(resp.data) ? resp.data : []);
      return res.json({ ok: true, runs: rows });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /flag-analysis/runs/:runId
  // ---------------------------------------------------------------------------
  router.get("/runs/:runId", async (req, res) => {
    try {
      const dh = getDatahubAxios();
      const resp = await dh.get(`/api/table/flag_analysis_runs?run_id=${encodeURIComponent(req.params.runId)}&limit=1`);
      const rows = resp.data?.items || resp.data?.data || (Array.isArray(resp.data) ? resp.data : []);
      if (!rows.length) return res.status(404).json({ ok: false, error: "run not found" });
      return res.json({ ok: true, run: rows[0] });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /flag-analysis/events
  //
  // Query params: runId, symbol, flagOk (0|1), spikeDetected (0|1),
  //               from (ISO date), to (ISO date), limit, offset
  // ---------------------------------------------------------------------------
  router.get("/events", async (req, res) => {
    try {
      const dh = getDatahubAxios();
      const parts = [];
      if (req.query.runId)                  parts.push(`run_id=${encodeURIComponent(req.query.runId)}`);
      if (req.query.symbol)                 parts.push(`symbol=${encodeURIComponent(req.query.symbol.toUpperCase())}`);
      if (req.query.flagOk        != null)  parts.push(`flag_ok=${encodeURIComponent(req.query.flagOk)}`);
      if (req.query.spikeDetected != null)  parts.push(`spike_detected=${encodeURIComponent(req.query.spikeDetected)}`);
      if (req.query.from)                   parts.push(`candle_ts[gte]=${encodeURIComponent(req.query.from)}`);
      if (req.query.to)                     parts.push(`candle_ts[lte]=${encodeURIComponent(req.query.to)}`);
      parts.push(`limit=${Math.min(parseInt(req.query.limit) || 100, 1000)}`);
      parts.push(`offset=${parseInt(req.query.offset) || 0}`);

      const resp  = await dh.get(`/api/table/flag_analysis_events?${parts.join("&")}`);
      const items = resp.data?.items || resp.data?.data || (Array.isArray(resp.data) ? resp.data : []);
      const count = resp.data?.count ?? items.length;
      return res.json({ ok: true, count, items });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /flag-analysis/stats/:runId
  // Legge le stats pre-calcolate da flag_analysis_runs (no query sugli eventi)
  // ---------------------------------------------------------------------------
  router.get("/stats/:runId", async (req, res) => {
    try {
      const dh    = getDatahubAxios();
      const runId = req.params.runId;

      const runResp = await dh.get(`/api/table/flag_analysis_runs?run_id=${encodeURIComponent(runId)}&limit=1`);
      const runRows = runResp.data?.items || runResp.data?.data || [];
      if (!runRows.length) return res.status(404).json({ ok: false, error: "run not found" });

      const run = runRows[0];

      // Datahub può restituire colonne JSON già come oggetti JS (non stringhe)
      const _parseJson = (v) => {
        if (!v) return {};
        if (typeof v === "object") return v;
        try { return JSON.parse(v); } catch { return {}; }
      };
      const failReasons = _parseJson(run.fail_reasons_json);
      const bySymbol    = _parseJson(run.by_symbol_json);

      return res.json({
        ok: true,
        run,
        stats: {
          total_events:              Number(run.total_windows),
          total_trend_ok_windows:    Number(run.total_trend_ok_windows || 0),
          tickers_with_data:         Number(run.tickers_with_data    || 0),
          tickers_with_spikes:       Number(run.tickers_with_spikes  || 0),
          actual_date_from:          run.actual_date_from || null,
          actual_date_to:            run.actual_date_to   || null,
          trend_ok_count:            Number(run.trend_ok_count   || 0),
          flag_ok_count:        Number(run.flag_ok_count    || 0),
          missed_count:         Number(run.missed_count     || 0),
          all_spikes_count:     Number(run.spike_count      || 0),
          trend_ok_spike:       Number(run.trend_ok_spike   || 0),
          flag_ok_spike:        Number(run.flag_ok_spike    || 0),
          flag_ok_confirmed:    Number(run.flag_ok_confirmed|| 0),
          all_spikes_confirmed: Number(run.confirmed_count  || 0),
          fail_reasons:         failReasons,
          by_symbol:            bySymbol,
        },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  return router;
}

module.exports = { createFlagAnalysisRouter };
