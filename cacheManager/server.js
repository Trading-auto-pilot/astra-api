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
const MODULE_VERSION = "0.1.0";      // es. "1.0.0"
const DEFAULT_PORT   = 3006;                  // es. 3012 (numero)

let logLevel = process.env.LOG_LEVEL || "info";
const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, logLevel);

const app = express();
app.use(express.json());

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
    return res.json(data);
  } catch (err) {
    logger.error("[GET /release] Errore:", err.message);
    return res.status(500).json({ error: "Impossibile leggere release.json" });
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

app.use("/status", createStatusRouter(serviceInstance, logger, "CacheManager"));

// Recupero candele
app.get("/candles", async (req, res) => {
  try {
    const { symbol, startDate, endDate, tf } = req.query;
    if (!symbol || !startDate || !endDate) {
      return res.status(400).json({ error: "symbol, startDate, endDate richiesti" });
    }

    const candles = await serviceInstance.getCandles(symbol, startDate, endDate, tf || "1Day");
    res.json(candles);
  } catch (err) {
    logger.error(`[CACHE] Errore GET /candles: ${err.message}`);
    res.status(500).json({ error: err.message });
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
