// server.js (TEMPLATE)
"use strict";

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");

const MainModule = require("./modules/main");
const createStatsModule = require("./modules/stats");
const createHealModule  = require("./modules/heal");
const createLogger = require("../shared/logger");
const createStatusRouter = require("./status"); // router standard /status/*
const { getConfigString } = require("../shared/loadSettings");

//const statsModule = createStatsModule(cacheManager);

dotenv.config();

// =======================================================
// PLACEHOLDER che verranno sostituiti dallo script
// =======================================================
const MICROSERVICE   = "cacheManager";   // es. "marketListener"
const MODULE_NAME    = "RESTServer";    // es. "RESTServer"
let MODULE_VERSION = "0.1.0";      // es. "1.0.0"
const DEFAULT_PORT   = 3006;                  // es. 3012 (numero)

let logLevel = getConfigString("LOG_LEVEL", "info");
const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, logLevel);

const app = express();
app.use(express.json({ limit: getConfigString("BODY_LIMIT", "20mb") }));
let statsModule = null;

// -------------------------------------------------------
// CORS: singola origin o lista separata da virgole
// -------------------------------------------------------
/*
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
*/

// -------------------------------------------------------
// CORS: Gestione con Treafik davanti 
// -------------------------------------------------------
app.use(
  cors({
    origin: true,        // accetta l'origin, deciderà Traefik se restituire gli header
    credentials: true,
  })
);

const port = getConfigString("PORT", String(DEFAULT_PORT)) || DEFAULT_PORT;
let serviceInstance;
let healModule = null;

// -------------------------------------------------------
// init asincrono del modulo principale
// -------------------------------------------------------
(async () => {
  try {
    serviceInstance = new MainModule();
    await serviceInstance.init();
    statsModule = createStatsModule(serviceInstance);
    healModule  = createHealModule(serviceInstance, logger);
    try {
      const rel = await serviceInstance.getReleaseInfo();
      if (rel?.version) {
        MODULE_VERSION = rel.version;
        logger.info(`[main] Module version set from release.json: ${MODULE_VERSION}`);
      }
    } catch (e) {
      logger.warning("[main] impossibile leggere release.json per MODULE_VERSION", e?.message || String(e));
    }
    logger.info("[main] Service initialized successfully");
  } catch (err) {
    logger.error(
      `[main] Error during initialization: ${err?.message || String(err)}`
    );
    process.exit(1);
  }
})();

// -------------------------------------------------------
// middleware: verifica che l'istanza sia pronta
// -------------------------------------------------------
function requireReady(req, res, next) {
  if (!serviceInstance) {
    return res.status(503).json({
      error: "Service not initialized yet",
    });
  }

  const status = serviceInstance.status;

  // Logica generica: se esiste uno stato "ERROR" o "STOPPED" lo blocchiamo
  if (status === "ERROR" || status === "STOPPED") {
    return res.status(503).json({
      error: "Service not running",
      status,
    });
  }

  next();
}

/* -------------------------- ROUTES: OPERATIVE -------------------------- */

// GET /release → ritorna release.json
app.get("/release", async (req, res) => {
  try {
    const data = await serviceInstance.getReleaseInfo();
    // Normalize jsonDetails -> json_details for frontend compatibility
    const addJsonDetails = (row) => {
      if (!row || typeof row !== "object") return row;
      if (row.json_details === undefined && row.jsonDetails !== undefined) {
        return { ...row, json_details: row.jsonDetails };
      }
      return row;
    };
    if (Array.isArray(data)) {
      return res.json(data.map(addJsonDetails));
    }
    if (Array.isArray(data?.items)) {
      return res.json({ ...data, items: data.items.map(addJsonDetails) });
    }
    if (Array.isArray(data?.logs)) {
      return res.json({ ...data, logs: data.logs.map(addJsonDetails) });
    }
    return res.json(data);
  } catch (err) {
    logger.error("[GET /release] Errore:", err.message);
    return res.status(500).json({ error: "Impossibile leggere release.json" });
  }
});

// GET /settings → ritorna i settings caricati
app.get("/settings", requireReady, (req, res) => {
  try {
    const data = serviceInstance.getAllSettings?.() || null;
    if (!data) return res.status(404).json({ error: "Settings non disponibili" });
    return res.json({ ok: true, data });
  } catch (err) {
    logger.error("[GET /settings] Errore:", err.message);
    return res.status(500).json({ error: "Impossibile leggere i settings" });
  }
});

// PUT /settings → aggiorna un setting in cache (non persistente)
app.put("/settings", requireReady, (req, res) => {
  const body = req.body || {};
  // supporta sia { setting, value } sia { SOME_KEY: "value" }
  let setting = body.setting;
  let value = body.value;
  if (!setting) {
    const keys = Object.keys(body);
    if (keys.length === 1) {
      setting = keys[0];
      value = body[setting];
    }
  }

  if (typeof setting !== "string" || setting.trim() === "") {
    return res.status(400).json({ ok: false, error: "Parametro 'setting' obbligatorio" });
  }

  try {
    const next = serviceInstance.setSetting(setting, value);
    return res.json({ ok: true, data: next });
  } catch (err) {
    logger.error("[PUT /settings] Errore:", err.message);
    return res.status(500).json({ ok: false, error: "Impossibile aggiornare il setting" });
  }
});

// GET /Log → proxy verso datahub /api/table/logs (supporta query, es. ?limit=100)
app.get("/Log", requireReady, async (req, res) => {
  try {
    const { convertPathToDatahub, adaptDatahubResponse } = require("../shared/datahubAdapter");

    const base =
      (serviceInstance && serviceInstance.dbmanagerUrl) ||
      getConfigString(["DATAHUB_URL", "DBMANAGER_URL"], "") ||
      "http://datahub:3000";

    const search = new URLSearchParams(req.query || {}).toString();
    // Convert DBManager path to datahub path (/logs -> /api/table/logs)
    const datahubPath = convertPathToDatahub("/logs");
    const target = `${base.replace(/\/+$/, "")}${datahubPath}${search ? `?${search}` : ""}`;

    logger.info(`[GET /Log] Proxying to: ${target}`);
    logger.info(`[GET /Log] Query params: ${JSON.stringify(req.query)}`);

    const response = await fetch(target, { method: "GET" });
    const data = await response.json().catch(() => ({}));

    logger.info(`[GET /Log] Response status: ${response.status}, count: ${data.count || 0}, data length: ${data.data?.length || 0}`);

    if (!response.ok) {
      const message = data?.error || data?.message || "Errore da datahub";
      return res.status(response.status || 500).json({ error: message });
    }

    // Convert datahub response to DBManager format
    const adaptedData = adaptDatahubResponse(data);
    logger.info(`[GET /Log] Adapted response - count: ${adaptedData.count || 0}, items length: ${adaptedData.items?.length || 0}`);
    return res.json(adaptedData);
  } catch (err) {
    logger.error(`[GET /Log] Proxy error: ${err?.message || String(err)}`);
    return res.status(500).json({ error: err?.message || "Errore proxy verso datahub" });
  }
});

/**
 * PUT /connect
 * Route generica per avviare una connessione "live" (es. websocket/market).
 * Il modulo `main` deve esporre `async connect()`.
 */
app.put("/connect", async (_req, res) => {
  if (!serviceInstance?.connect) {
    return res.status(501).json({
      success: false,
      error: "connect() not implemented in this microservice",
    });
  }

  try {
    const status = await serviceInstance.connect();
    const ok = status === "LISTENING" || status === "CONNECTED" || status === "READY";

    return res.json({ success: ok, status });
  } catch (err) {
    logger.error(
      `[PUT /connect] Error during connect: ${err?.message || String(err)}`
    );
    return res
      .status(500)
      .json({ success: false, error: "Error during connect" });
  }
});

/**
 * DELETE /connect
 * Route generica per chiudere la connessione live.
 * Il modulo `main` deve esporre `async disconnect()`.
 */
app.delete("/connect", requireReady, async (_req, res) => {
  if (!serviceInstance?.disconnect) {
    return res.status(501).json({
      success: false,
      error: "disconnect() not implemented in this microservice",
    });
  }

  try {
    const status = await serviceInstance.disconnect();
    const ok =
      status === "DISCONNECTED" ||
      status === "NOT CONNECTED" ||
      status === "STOPPED";

    return res.json({ success: ok, status });
  } catch (err) {
    logger.error(
      `[DELETE /connect] Error during disconnect: ${err?.message || String(err)}`
    );
    return res
      .status(500)
      .json({ success: false, error: "Error during disconnect" });
  }
});

/**
 * GET /dbLogger
 * Restituisce lo stato del logging su DB, se il modulo lo supporta.
 */
app.get("/dbLogger", async (_req, res) => {
  if (!serviceInstance?.getDbLogStatus) {
    return res.status(501).json({
      ok: false,
      error: "getDbLogStatus() not implemented in this microservice",
    });
  }

  try {
    const data = await serviceInstance.getDbLogStatus();
    res.json({ ok: true, data });
  } catch (e) {
    logger.error(
      `[GET /dbLogger] Error: ${e?.message || String(e)}`
    );
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

/**
 * PUT /dbLogger/:status
 * Abilita/disabilita il logging su DB (on/off), se supportato.
 */
app.put("/dbLogger/:status", async (req, res) => {
  if (!serviceInstance?.setDbLogStatus) {
    return res.status(501).json({
      ok: false,
      error: "setDbLogStatus() not implemented in this microservice",
    });
  }

  const raw = String(req.params.status ?? "").trim();
  const normalized = raw.toLowerCase();

  let enable;
  if (normalized === "on") enable = true;
  else if (normalized === "off") enable = false;
  else {
    return res.status(400).json({
      ok: false,
      error: "Invalid status. Use 'on' or 'off'.",
      received: raw,
      allowed: ["on", "off"],
    });
  }

  try {
    const data = await serviceInstance.setDbLogStatus(enable);
    if (data == null) {
      return res.status(404).json({ ok: false, error: "not found" });
    }
    return res.json({ ok: true, status: enable ? "on" : "off", data });
  } catch (e) {
    logger.error(
      `[PUT /dbLogger/:status] Error: ${e?.message || String(e)}`
    );
    return res
      .status(500)
      .json({ ok: false, error: e?.message || String(e) });
  }
});

// Provider storico (GET/PUT)
app.get("/provider", (_req, res) => {
  try {
    const current = serviceInstance?.providerType || getConfigString("HISTORICAL_PROVIDER", "") || null;
    return res.json({ ok: true, provider: current });
  } catch (e) {
    logger.error(`[GET /provider] Error: ${e?.message || String(e)}`);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.put("/provider/:provider", (req, res) => {
  const next = (req.params.provider || "").toUpperCase();
  if (!next || !["AUTO", "FMP", "ALPACA", "POLYGON", "YAHOO", "IBKR"].includes(next)) {
    return res.status(400).json({ ok: false, error: "Provider non valido. Usare AUTO, FMP, ALPACA, POLYGON, YAHOO o IBKR." });
  }

  if (!serviceInstance) {
    return res.status(503).json({ ok: false, error: "Service not initialized" });
  }

  try {
    // re-init provider if needed
    if (next === "ALPACA" && !serviceInstance.alpaca) {
      try {
        const { AlpacaProvider } = require("./modules/alpaca");
        serviceInstance.alpaca = new AlpacaProvider({
          apiKey: getConfigString(["APCA_API_KEY_ID", "APCA-API-KEY-ID"], ""),
          apiSecret: getConfigString(["APCA_API_SECRET_KEY", "APCA-API-SECRET-KEY"], ""),
          feed: getConfigString("ALPACA_MARKET_FEED", "sip"),
          logger,
        });
      } catch (err) {
        logger.error(`[PUT /provider] Error init Alpaca: ${err?.message || String(err)}`);
        return res.status(500).json({ ok: false, error: "Impossibile inizializzare Alpaca" });
      }
    }
    if (next === "IBKR") {
      logger.info("[PUT /provider] Provider impostato a IBKR");
    }
    serviceInstance.providerType = next;
    logger.info(`[PUT /provider] Provider impostato a ${next}`);
    return res.json({ ok: true, provider: next });
  } catch (e) {
    logger.error(`[PUT /provider] Error: ${e?.message || String(e)}`);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

/**
 * POST /settings/reload
 * Ricarica i settings da DB senza riavviare il servizio.
 */
app.post("/settings/reload", requireReady, async (_req, res) => {
  if (!serviceInstance?.reloadSettings) {
    return res.status(501).json({
      ok: false,
      error: "reloadSettings() not implemented in this microservice",
    });
  }

  try {
    const data = await serviceInstance.reloadSettings();
    return res.json({ ok: true, ...data });
  } catch (e) {
    logger.error(
      `[POST /settings/reload] Error: ${e?.message || String(e)}`
    );
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
});

// monta le route /status dopo l'init per avere service e stats pronti
app.use("/status", (req, res, next) => {
  if (!statsModule && serviceInstance) {
    statsModule = createStatsModule(serviceInstance);
  }
  return createStatusRouter({ service: serviceInstance, logger, moduleName: MODULE_NAME, stats: statsModule })(
    req,
    res,
    next
  );
});

// Recupero candele
app.get("/candles", async (req, res) => {
  try {
    const { symbol, startDate, endDate, tf, exchange } = req.query;
    if (!symbol || !startDate || !endDate) {
      return res.status(400).json({ error: "symbol, startDate, endDate richiesti" });
    }

    const candles = await serviceInstance.getCandles(
      symbol,
      startDate,
      endDate,
      tf || "1Day",
      exchange
    );
    res.json(candles);
  } catch (err) {
    logger.error(`[CACHE] Errore GET /candles: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// GET /candles/latest?symbol=AAPL&tf=1min
// Returns the most recent candle from L3 (Redis) for the given symbol/timeframe.
// Does not fetch from provider — returns 404 on cache miss.
app.get("/candles/latest", requireReady, async (req, res) => {
  try {
    const { symbol, tf } = req.query;
    if (!symbol || !tf) {
      return res.status(400).json({ ok: false, error: "symbol and tf required" });
    }
    const candle = await serviceInstance.getLatestCandle(symbol, tf);
    if (!candle) {
      return res.status(404).json({ ok: false, error: "no candle in cache", symbol, tf });
    }
    return res.json({ ok: true, candle, symbol, tf });
  } catch (err) {
    logger.error(`[CACHE] Error GET /candles/latest: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /l2/file?symbol=...&year=YYYY&month=MM&tf=1min
// or /l2/file?fileName=SYMBOL/YYYY-MM_tf.json
app.get("/l2/file", requireReady, async (req, res) => {
  try {
    const { symbol, year, month, tf, fileName } = req.query;
    const result = await serviceInstance.readL2File({
      symbol,
      year,
      month,
      tf,
      fileName,
    });
    res.json({ ok: true, data: result.data, meta: result.meta });
  } catch (err) {
    logger.error(`[CACHE] Errore GET /l2/file: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /l2/file?symbol=...&year=YYYY&month=MM&tf=1min
// or /l2/file?fileName=SYMBOL/YYYY-MM_tf.json
app.put("/l2/file", requireReady, async (req, res) => {
  try {
    const { symbol, year, month, tf, fileName } = req.query;
    const result = await serviceInstance.writeL2File({
      symbol,
      year,
      month,
      tf,
      fileName,
      data: req.body,
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    logger.error(`[CACHE] Errore PUT /l2/file: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /l2/audit?symbol=SYM
app.get("/l2/audit", requireReady, async (req, res) => {
  try {
    if (!statsModule && serviceInstance) {
      statsModule = createStatsModule(serviceInstance);
    }
    const { symbol, tf, clean } = req.query;
    const result = await statsModule.auditL2({
      symbol,
      tf,
      clean: ["true", "1", "yes", "on"].includes(String(clean || "").toLowerCase()),
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    logger.error(`[CACHE] Errore GET /l2/audit: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /l2/clear?symbol=...&file=YYYY-MM_tf.json
// Without params it clears the entire L2 cache.
app.post("/l2/clear", requireReady, async (req, res) => {
  try {
    if (!statsModule && serviceInstance) {
      statsModule = createStatsModule(serviceInstance);
    }
    const { symbol, file } = req.query;
    const segments = [];
    if (symbol) segments.push(String(symbol));
    if (file) segments.push(String(file));
    const result = await statsModule.deleteL2(segments);
    if (!result.ok) {
      return res.status(404).json({ ok: false, error: "Path not found or not deleted" });
    }
    return res.json({ ok: true, deleted: result.deleted });
  } catch (err) {
    logger.error(`[CACHE] Errore POST /l2/clear: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
});




/* --------------------------- ROUTES: L2 QUALITY ------------------------- */

// Fetch paginata da datahub (max 1000 righe per request)
const fetchAllPages = async (table, baseParams) => {
  const base = (serviceInstance && serviceInstance.dbmanagerUrl) || getConfigString(["DATAHUB_URL", "DBMANAGER_URL"], "http://datahub:3000");
  const headers = { "Content-Type": "application/json" };
  const PAGE = 1000;
  const all = [];
  let offset = 0;
  for (;;) {
    const p = new URLSearchParams(baseParams);
    p.set("limit", String(PAGE));
    p.set("offset", String(offset));
    const r2 = await fetch(`${base}/api/table/${table}?${p}`, { headers });
    if (!r2.ok) throw new Error(`Datahub error: ${r2.status}`);
    const d2 = await r2.json().catch(() => ({}));
    const page = Array.isArray(d2?.data) ? d2.data : [];
    all.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return all;
};

// GET /l2/quality?level=symbols|files&symbol=&tf=
app.get("/l2/quality", requireReady, async (req, res) => {
  try {
    const { level = "symbols", symbol, tf } = req.query;

    const baseParams = { sort_by: "healed_at", sort_dir: "desc" };
    if (symbol) baseParams.symbol = String(symbol).toUpperCase();
    if (tf && level === "files") baseParams.tf = String(tf).toLowerCase();

    const rows = await fetchAllPages("cache_quality_file_scores", baseParams);

    // Dedup: per ogni symbol+tf+year+month mantieni solo la riga più recente
    const seen = new Set();
    const deduped = [];
    for (const row of rows) {
      const k = `${row.symbol}|${row.tf}|${row.year}|${row.month}`;
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(row);
    }

    // Retroactive fix per 1week: expected_count errato (giorni invece di settimane)
    for (const row of deduped) {
      if (row.tf === "1week") {
        const actual = Number(row.actual_count ?? 0);
        const expected = Number(row.expected_count ?? 0);
        if (actual <= 5 && expected > 5) {
          const fixedExpected = actual > 0 ? actual : 4;
          row.expected_count = fixedExpected;
          row.quality_score = actual > 0 ? Math.min(100, Math.round((actual / fixedExpected) * 10000) / 100) : 0;
        }
      }
    }

    if (level === "files") {
      const data = deduped.map((row) => ({
        symbol: row.symbol,
        tf: row.tf,
        year: Number(row.year),
        month: Number(row.month),
        expected_count: Number(row.expected_count ?? 0),
        actual_count: Number(row.actual_count ?? 0),
        missing_count: Number(row.missing_count ?? 0),
        missing_dates: Array.isArray(row.missing_dates) ? row.missing_dates : [],
        quality_score: Math.min(100, Number(row.quality_score ?? 0)),
        healed_at: row.healed_at,
      }));
      return res.json({ ok: true, data });
    }

    // level=symbols: aggrega per symbol
    const bySymbol = {};
    for (const row of deduped) {
      if (Number(row.actual_count ?? 0) === 0) continue; // salta file orfani
      const sym = row.symbol;
      if (!bySymbol[sym]) bySymbol[sym] = { scores: [], missing: 0, files: 0, symbol: sym };
      const s = Math.min(100, Number(row.quality_score ?? 0));
      bySymbol[sym].scores.push(s);
      bySymbol[sym].missing += Number(row.missing_count ?? 0);
      bySymbol[sym].files++;
    }

    const fetchLegacyScores = async (symFilter) => {
      const p = { sort_by: "check_date", sort_dir: "desc" };
      if (symFilter) p.symbol = String(symFilter).toUpperCase();
      return fetchAllPages("cache_quality_scores", p).catch(() => []);
    };

    // Se non ci sono dati atomici, fallback su legacy
    if (Object.keys(bySymbol).length === 0) {
      const legacy = await fetchLegacyScores(symbol);
      const legacySeen = new Set();
      const legacyDeduped = legacy.filter((r) => {
        const k = `${r.symbol}|${r.tf}`;
        if (legacySeen.has(k)) return false;
        legacySeen.add(k); return true;
      });
      // Aggrega legacy per symbol (può avere più TF per symbol)
      const legBySymbol = {};
      for (const r of legacyDeduped) {
        const sym = r.symbol;
        if (!legBySymbol[sym]) legBySymbol[sym] = { scores: [], missing: 0, files: 0 };
        const s = Math.min(100, Number(r.quality_score_post_heal ?? r.quality_score ?? 0));
        legBySymbol[sym].scores.push(s);
        legBySymbol[sym].missing += Number(r.gaps_unhealed ?? 0);
        legBySymbol[sym].files++;
      }
      const data = Object.entries(legBySymbol).map(([sym, v]) => ({
        symbol: sym,
        min_score:     v.scores.length > 0 ? Math.min(...v.scores) : null,
        avg_score:     v.scores.length > 0 ? Math.round((v.scores.reduce((a, b) => a + b, 0) / v.scores.length) * 100) / 100 : null,
        total_missing: v.missing,
        files_count:   v.files,
      }));
      return res.json({ ok: true, data, source: "legacy" });
    }

    const data = Object.values(bySymbol).map(({ symbol: sym, scores, missing, files }) => ({
      symbol:        sym,
      min_score:     scores.length > 0 ? Math.min(...scores) : null,
      avg_score:     scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null,
      total_missing: missing,
      files_count:   files,
    }));

    return res.json({ ok: true, data, source: "atomic" });
  } catch (err) {
    logger.error(`[l2/quality] Errore: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* --------------------------- ROUTES: HEAL ------------------------------ */

// POST /l2/heal — avvia job di ispezione e riparazione
app.post("/l2/heal", requireReady, (req, res) => {
  try {
    const symbol  = req.query.symbol  ?? req.body?.symbol  ?? null;
    const tf      = req.query.tf      ?? req.body?.tf      ?? null;
    const from    = req.query.from    ?? req.body?.from    ?? null;
    const to      = req.query.to      ?? req.body?.to      ?? null;
    const heal    = String(req.query.heal    ?? req.body?.heal    ?? "true").toLowerCase() !== "false";
    const dry_run = String(req.query.dry_run ?? req.body?.dry_run ?? "false").toLowerCase() === "true";
    const params  = { symbol: symbol ? String(symbol).toUpperCase() : null, tf, from, to, heal, dry_run };
    const job     = healModule.startJob(params);
    logger.info(`[heal] Job avviato: ${job.jobId} symbol=${params.symbol || "ALL"} ${from}→${to} tf=${tf} heal=${heal} dry_run=${dry_run}`);
    return res.json({ ok: true, jobId: job.jobId });
  } catch (err) {
    logger.error(`[heal] Errore POST /l2/heal: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /l2/heal/scan — full scan di tutti i TF/symbol presenti in cache
app.post("/l2/heal/scan", requireReady, (req, res) => {
  try {
    const heal    = String(req.query.heal    ?? req.body?.heal    ?? "true").toLowerCase() !== "false";
    const dry_run = String(req.query.dry_run ?? req.body?.dry_run ?? "false").toLowerCase() === "true";
    const days_back_per_tf = req.body?.days_back_per_tf ?? {};
    const merged  = { ...healModule.DEFAULT_DAYS_BACK_PER_TF, ...days_back_per_tf };
    const params  = { heal, dry_run, days_back_per_tf: merged };
    const job     = healModule.startScanJob(params);
    logger.info(`[heal/scan] Job avviato: ${job.jobId} heal=${heal} dry_run=${dry_run}`);
    return res.json({ ok: true, jobId: job.jobId });
  } catch (err) {
    logger.error(`[heal] Errore POST /l2/heal/scan: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /l2/heal/jobs — lista job recenti
app.get("/l2/heal/jobs", requireReady, (_req, res) => {
  res.json({ ok: true, data: healModule.listJobs() });
});

// GET /l2/heal/:jobId/report.md — report Markdown
app.get("/l2/heal/:jobId/report.md", requireReady, (req, res) => {
  const job = healModule.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: "Job non trovato" });
  const md = healModule.buildMarkdownReport(job);
  res.set("Content-Type", "text/markdown").send(md);
});

// DELETE /l2/heal/:jobId — annulla job in esecuzione
app.delete("/l2/heal/:jobId", requireReady, (req, res) => {
  const job = healModule.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: "Job non trovato" });
  if (job.status === "running") job.aborted = true;
  res.json({ ok: true, status: job.status });
});

// GET /l2/heal/:jobId — stato e risultato job
app.get("/l2/heal/:jobId", requireReady, (req, res) => {
  const job = healModule.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: "Job non trovato" });
  res.json({ ok: true, data: job });
});

/* --------------------------- ROUTES: STATUS ---------------------------- */
/**
 * Router generico /status/*
 * Il modulo `status.js` deve usare `serviceInstance.getInfo()` se disponibile.

app.use(
  "/status",
  requireReady,
  buildStatusRouter({
    service: serviceInstance,
    logger,
    moduleName: MODULE_NAME,
  })
);
 */

/* ----------------------------- STARTUP -------------------------------- */
app.listen(port, () => {
  logger.info(`REST API for ${MICROSERVICE} listening on port ${port}`);
});
