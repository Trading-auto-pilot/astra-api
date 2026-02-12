// server.js (TEMPLATE)
"use strict";

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");

const MainModule = require("./modules/main");
const createStatsModule = require("./modules/stats");
const createLogger = require("../shared/logger");
const createStatusRouter = require("./status"); // router standard /status/*

//const statsModule = createStatsModule(cacheManager);

dotenv.config();

// =======================================================
// PLACEHOLDER che verranno sostituiti dallo script
// =======================================================
const MICROSERVICE   = "cacheManager";   // es. "marketListener"
const MODULE_NAME    = "RESTServer";    // es. "RESTServer"
let MODULE_VERSION = "0.1.0";      // es. "1.0.0"
const DEFAULT_PORT   = 3006;                  // es. 3012 (numero)

let logLevel = process.env.LOG_LEVEL || "info";
const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, logLevel);

const app = express();
app.use(express.json({ limit: process.env.BODY_LIMIT || "20mb" }));
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

const port = process.env.PORT || DEFAULT_PORT;
let serviceInstance;

// -------------------------------------------------------
// init asincrono del modulo principale
// -------------------------------------------------------
(async () => {
  try {
    serviceInstance = new MainModule();
    await serviceInstance.init();
    statsModule = createStatsModule(serviceInstance);
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

// GET /Log → proxy verso DBManager /logs (supporta query, es. ?limit=100)
app.get("/Log", requireReady, async (req, res) => {
  try {
    const base =
      (serviceInstance && serviceInstance.dbmanagerUrl) ||
      process.env.DBMANAGER_URL ||
      "http://dbmanager:3002";

    const search = new URLSearchParams(req.query || {}).toString();
    const target = `${base.replace(/\/+$/, "")}/logs${search ? `?${search}` : ""}`;

    const response = await fetch(target, { method: "GET" });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data?.error || data?.message || "Errore dal DBManager";
      return res.status(response.status || 500).json({ error: message });
    }

    return res.json(data);
  } catch (err) {
    logger.error(`[GET /Log] Proxy error: ${err?.message || String(err)}`);
    return res.status(500).json({ error: err?.message || "Errore proxy verso DBManager" });
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
    const current = serviceInstance?.providerType || process.env.HISTORICAL_PROVIDER || null;
    return res.json({ ok: true, provider: current });
  } catch (e) {
    logger.error(`[GET /provider] Error: ${e?.message || String(e)}`);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.put("/provider/:provider", (req, res) => {
  const next = (req.params.provider || "").toUpperCase();
  if (!next || !["FMP", "ALPACA", "IBKR"].includes(next)) {
    return res.status(400).json({ ok: false, error: "Provider non valido. Usare FMP, ALPACA o IBKR." });
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
          apiKey: process.env.APCA_API_KEY_ID,
          apiSecret: process.env.APCA_API_SECRET_KEY,
          feed: process.env.ALPACA_MARKET_FEED || "sip",
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
