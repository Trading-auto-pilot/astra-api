// server.js (TEMPLATE)
"use strict";

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const fs = require("fs/promises");
const path = require("path");

const MainModule = require("./modules/main");
const createLogger = require("../shared/logger");
const buildStatusRouter = require("./status"); // router standard /status/*
const buildFundamentalsRouter = require("./fundamentals");
const { reportJobDone } = require("../shared/jobReporter");

dotenv.config();

// =======================================================
// PLACEHOLDER che verranno sostituiti dallo script
// =======================================================
const MICROSERVICE   = "tickerScanner";   // es. "marketListener"
const MODULE_NAME    = "RESTServer";    // es. "RESTServer"
const MODULE_VERSION = "0.1.0";      // es. "1.0.0"
const DEFAULT_PORT   = 3013;                  // es. 3012 (numero)

let logLevel = process.env.LOG_LEVEL || "info";
const appEnv = process.env.ENV || process.env.APP_ENV || "DEV";
const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, logLevel, {
  busTopicPrefix: appEnv,
});

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
    logger.attachBus(serviceInstance.bus);
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

/**
 * GET /glossary/:fileName
 * Ritorna un file JSON dalla cartella ./Glossary
 * Esempio: /glossary/ratios-ttm.json
 */
app.get("/glossary/:fileName", async (req, res) => {
  try {
    const fileName = String(req.params.fileName || "").trim();
    if (!fileName || !fileName.endsWith(".json")) {
      return res.status(400).json({ error: "Invalid glossary filename" });
    }
    // Prevent path traversal
    if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
      return res.status(400).json({ error: "Invalid glossary filename" });
    }

    const glossaryDir = path.join(__dirname, "Glossary");
    const filePath = path.join(glossaryDir, fileName);

    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return res.json(parsed);
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
      return res.status(404).json({ error: "Glossary file not found" });
    }
    if (err instanceof SyntaxError) {
      logger.error(`[GET /glossary] Invalid JSON file: ${err.message}`);
      return res.status(500).json({ error: "Invalid glossary file content" });
    }
    logger.error(`[GET /glossary] Error: ${err?.message || String(err)}`);
    return res.status(500).json({ error: "Unable to load glossary file" });
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


/**
 * GET /screener
 * Esegue lo screener FMP usando i filtri letti da DB e restituisce il risultato.
 */
app.get("/screener", requireReady, async (_req, res) => {
  if (!serviceInstance?.runScreener) {
    return res.status(501).json({
      ok: false,
      error: "runScreener() not implemented in this microservice",
    });
  }

  try {
    const result = await serviceInstance.runScreener();
    return res.json({ ok: true, ...result });
  } catch (e) {
    logger.error(
      `[GET /screener] Error: ${e?.message || String(e)}`
    );
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
});


/**
 * GET /scan
 * Esegue:
 *  - screener FMP
 *  - fundamentals FMP
 *  - scoring (valuation/quality/risk/total)
 */
// Avvio asincrono dello scan
app.get("/scan", requireReady, async (req, res) => {
  if (!serviceInstance?.startScanJob) {
    return res.status(501).json({
      ok: false,
      error: "startScanJob() not implemented in this microservice",
    });
  }

  try {
    const overrides = { ...(req.query || {}) }; // query string > DB settings
    const jobKey =
      (typeof req.query.jobKey === "string" && req.query.jobKey.trim()) ||
      (typeof req.headers["x-job-key"] === "string" && req.headers["x-job-key"].trim()) ||
      "";
    if (jobKey) {
      overrides.__jobKey = jobKey;
    }
    const info = await serviceInstance.startScanJob(overrides);
    return res.json({ ok: true, type: "async", ...info });
  } catch (e) {
    logger.error(`[GET /scan] Error: ${e?.message || String(e)}`);
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
});

/**
 * GET /scan/force
 * Esegue lo scan ignorando la cache locale (ricalcola e sovrascrive tutti i simboli).
 */
app.get("/scan/force", requireReady, async (req, res) => {
  if (!serviceInstance?.startScanJob) {
    return res.status(501).json({
      ok: false,
      error: "startScanJob() not implemented in this microservice",
    });
  }

  try {
    const overrides = { ...(req.query || {}) };
    const jobKey =
      (typeof req.query.jobKey === "string" && req.query.jobKey.trim()) ||
      (typeof req.headers["x-job-key"] === "string" && req.headers["x-job-key"].trim()) ||
      "";
    if (jobKey) {
      overrides.__jobKey = jobKey;
    }
    const info = await serviceInstance.startScanJob(overrides, { forceRefresh: true });
    return res.json({ ok: true, type: "async", ...info });
  } catch (e) {
    logger.error(`[GET /scan/force] Error: ${e?.message || String(e)}`);
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
});

// Stato di uno scan
app.get("/scan/status/:jobId", requireReady, async (req, res) => {
  if (!serviceInstance?.getScanStatus) {
    return res.status(501).json({
      ok: false,
      error: "getScanStatus() not implemented in this microservice",
    });
  }

  try {
    const job = serviceInstance.getScanStatus(req.params.jobId);
    return res.json({ ok: true, job });
  } catch (e) {
    if (e.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, error: "Job not found" });
    }
    logger.error(
      `[GET /scan/status/${req.params.jobId}] Error: ${e?.message || String(e)}`
    );
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
});


/**
 * GET /scan/jobs
 * Restituisce tutti i job in stato queued/running
 */
app.get("/scan/jobs", requireReady, async (_req, res) => {
  if (!serviceInstance?.getRunningScanJobs) {
    return res.status(501).json({
      ok: false,
      error: "getRunningScanJobs() not implemented in this microservice",
    });
  }

  try {
    const jobs = serviceInstance.getRunningScanJobs();
    return res.json({ ok: true, jobs });
  } catch (e) {
    logger.error(
      `[GET /scan/jobs] Error: ${e?.message || String(e)}`
    );
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
});

// Cancella/termina uno scan job
app.delete("/scan/jobs/:jobId", requireReady, async (req, res) => {
  if (!serviceInstance?.cancelScanJob) {
    return res.status(501).json({
      ok: false,
      error: "cancelScanJob() not implemented in this microservice",
    });
  }

  try {
    const job = serviceInstance.cancelScanJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ ok: false, error: "Job not found" });
    }
    return res.json({ ok: true, job });
  } catch (e) {
    logger.error(
      `[DELETE /scan/jobs/${req.params.jobId}] Error: ${e?.message || String(e)}`
    );
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
});

// Aggiorna momentum per tutti i tickers presenti in DB
app.post("/momentum/refresh", requireReady, async (req, res) => {
  if (!serviceInstance?.refreshMomentumAll) {
    return res.status(501).json({
      ok: false,
      error: "refreshMomentumAll() not implemented in this microservice",
    });
  }

  try {
    const jobKey =
      (typeof req.query.jobKey === "string" && req.query.jobKey.trim()) ||
      (typeof req.headers["x-job-key"] === "string" && req.headers["x-job-key"].trim()) ||
      (typeof req.body?.jobKey === "string" && req.body.jobKey.trim()) ||
      "manual";
    const jobId = `momentum_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = new Date().toISOString();

    logger.info(
      `[momentumRefresh] jobId=${jobId} started jobKey=${jobKey}`
    );

    (async () => {
      const startedAtMs = Date.now();
      try {
        const info = await serviceInstance.refreshMomentumAll();
        const finishedAt = new Date().toISOString();
        const payload = {
          type: "momentumRefresh",
          jobKey,
          jobId,
          startedAt,
          finishedAt,
          durationMs: Date.now() - startedAtMs,
          totalSymbols: info?.totalSymbols ?? 0,
          totalUpdated: info?.totalUpdated ?? 0,
          status: "COMPLETED",
          __source: "tickerscanner",
        };
        try {
          await serviceInstance.bus?.publish?.(
            serviceInstance.redisTelemetyChannel,
            payload
          );
        } catch (publishErr) {
          logger.warning?.(
            `[momentumRefresh] jobId=${jobId} telemetry publish failed: ${publishErr?.message || String(publishErr)}`
          );
        }
        await reportJobDone(serviceInstance.bus, serviceInstance.redisStatusChannel, jobId, { status: "COMPLETED" });
        logger.info(
          `[momentumRefresh] jobId=${jobId} completed totalSymbols=${info?.totalSymbols ?? "?"} totalUpdated=${info?.totalUpdated ?? "?"}`
        );
      } catch (err) {
        const finishedAt = new Date().toISOString();
        const payload = {
          type: "momentumRefresh",
          jobKey,
          jobId,
          startedAt,
          finishedAt,
          durationMs: Date.now() - startedAtMs,
          status: "FAILED",
          error: err?.message || String(err),
          __source: "tickerscanner",
        };
        try {
          await serviceInstance.bus?.publish?.(
            serviceInstance.redisTelemetyChannel,
            payload
          );
        } catch (publishErr) {
          logger.warning?.(
            `[momentumRefresh] jobId=${jobId} telemetry publish failed: ${publishErr?.message || String(publishErr)}`
          );
        }
        await reportJobDone(serviceInstance.bus, serviceInstance.redisStatusChannel, jobId, { status: "FAILED", error: err?.message || String(err) });
        logger.error(
          `[momentumRefresh] jobId=${jobId} failed: ${err?.message || String(err)}`
        );
      }
    })();

    return res.json({ ok: true, type: "async", started: true, jobId, jobKey, startedAt });
  } catch (e) {
    logger.error(
      `[POST /momentum/refresh] Error: ${e?.message || String(e)}`
    );
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
});


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


const fundamentalsRouter = buildFundamentalsRouter({
  service: serviceInstance,
  logger,
  moduleName: MODULE_NAME,
});

app.use("/fundamentals", requireReady, fundamentalsRouter);

if (Array.isArray(fundamentalsRouter._internalUserDailyScores)) {
  app.post(
    "/internal/fundamentals/user-daily-scores",
    requireReady,
    ...fundamentalsRouter._internalUserDailyScores
  );
}

/* ----------------------------- STARTUP -------------------------------- */
app.listen(port, () => {
  logger.info(`REST API for ${MICROSERVICE} listening on port ${port}`);
});
