// server.js (TEMPLATE)
"use strict";

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");

const MainModule = require("./modules/main");
const createLogger = require("../shared/logger");
const buildStatusRouter = require("./status"); // router standard /status/*
const buildDecisionEngineRouter = require("./modules/decision-engine");
const { getGuardConfig, updateGuardConfig } = require("./modules/live-manager");

dotenv.config();

// =======================================================
// PLACEHOLDER che verranno sostituiti dallo script
// =======================================================
const MICROSERVICE   = "decision-engine";   // es. "marketListener"
const MODULE_NAME    = "RESTServer";    // es. "RESTServer"
const MODULE_VERSION = "0.1.0";      // es. "1.0.0"
const DEFAULT_PORT   = 3018;                  // es. 3012 (numero)

let logLevel = process.env.LOG_LEVEL || "info";
const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, logLevel);
process.env.MICROSERVICE_NAME = process.env.MICROSERVICE_NAME || MICROSERVICE;

const app = express();
app.use(express.json());

// -------------------------------------------------------
// CORS: singola origin o lista separata da virgole
// -------------------------------------------------------
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

/* --------------------------- ROUTES: GUARDS CONFIG ------------------------- */
/**
 * GET /guards/config
 * Returns the current volatility event guard configuration (earnings, FOMC, macro, dividend).
 */
app.get("/guards/config", requireReady, (_req, res) => {
  res.json({ ok: true, data: getGuardConfig() });
});

/**
 * PATCH /guards/config
 * Updates guard settings at runtime without restart.
 * Body: { earnings?: { enabled?: bool, blockDays?: number, blockWeeks?: number },
 *         fomc?:     { enabled?: bool, blockDays?: number },
 *         macro?:    { enabled?: bool, blockDays?: number },
 *         dividend?: { enabled?: bool, blockDays?: number } }
 */
app.patch("/guards/config", requireReady, (req, res) => {
  try {
    const updated = updateGuardConfig(req.body || {});
    logger.info(`[PATCH /guards/config] updated: ${JSON.stringify(updated)}`);
    res.json({ ok: true, data: updated });
  } catch (err) {
    logger.error(`[PATCH /guards/config] ${err?.message || String(err)}`);
    res.status(400).json({ ok: false, error: err?.message || String(err) });
  }
});

/* --------------------------- ROUTES: SPOT FINDER --------------------------- */
const decisionEngineRouter = buildDecisionEngineRouter({
  service: serviceInstance,
  logger,
});

app.use("/spot-finder", requireReady, decisionEngineRouter);

if (Array.isArray(decisionEngineRouter._internalSpotFinder)) {
  app.post(
    "/internal/spot-finder/:pipeId",
    requireReady,
    ...decisionEngineRouter._internalSpotFinder
  );
}

if (Array.isArray(decisionEngineRouter._internalSpotFinderLive)) {
  app.post(
    "/internal/spot-finder/live/:pipeId",
    requireReady,
    ...decisionEngineRouter._internalSpotFinderLive
  );
}

if (Array.isArray(decisionEngineRouter._internalSpotFinderLiveStop)) {
  app.delete(
    "/internal/spot-finder/live/:pipeId",
    requireReady,
    ...decisionEngineRouter._internalSpotFinderLiveStop
  );
}

/* --------------------------- ROUTES: STATUS ---------------------------- */
/**
 * Router generico /status/*
 * Il modulo `status.js` deve usare `serviceInstance.getInfo()` se disponibile.
 */
app.use(
  "/status",
  requireReady,
  buildStatusRouter({
    service: serviceInstance,
    logger,
    moduleName: MODULE_NAME,
  })
);

/* ----------------------------- STARTUP -------------------------------- */
app.listen(port, () => {
  logger.info(`REST API for ${MICROSERVICE} listening on port ${port}`);
});
