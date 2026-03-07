// server.js (TEMPLATE)
"use strict";

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const axios = require("axios");
const MainModule = require("./modules/main");
const createLogger = require("../shared/logger");
const buildStatusRouter = require("./status"); // router standard /status/*
const { createSchedulerJobsClient } = require("./modules/schedulerJobsClient");

dotenv.config();

// =======================================================
// PLACEHOLDER che verranno sostituiti dallo script
// =======================================================
const MICROSERVICE   = "scheduler";   // es. "marketListener"
const MODULE_NAME    = "RESTServer";    // es. "RESTServer"
const MODULE_VERSION = "0.1.0";      // es. "1.0.0"
const DEFAULT_PORT   = 3014;                  // es. 3012 (numero)

let logLevel = process.env.LOG_LEVEL || "info";
const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, logLevel);

const app = express();
app.use(express.json());

// DEBUG: Log all PUT requests
app.use((req, res, next) => {
  if (req.method === 'PUT') {
    logger.log(`[DEBUG] ${req.method} ${req.path} | body: ${JSON.stringify(req.body)}`);
  }
  next();
});

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
// Helper: Transform frontend job format to DB schema
// -------------------------------------------------------
/**
 * Convert a raw DB row (snake_case) to the camelCase format expected by the frontend.
 * Mirrors the old DBManager response format.
 */
function dbRowToJob(row) {
  if (!row) return row;
  return {
    id:          row.id,
    jobKey:      row.job_key ?? row.jobKey ?? null,
    description: row.description ?? null,
    enabled:     row.enabled === 1 || row.enabled === true,
    method:      row.method || "GET",
    url:         row.url ?? null,
    headers:     row.headers ?? null,
    body:        row.body ?? null,
    timeoutMs:   row.timeout_ms ?? row.timeoutMs ?? 15000,
    retry: {
      maxAttempts: row.retry_max_attempts ?? row.retry?.maxAttempts ?? 1,
      backoffMs:   row.retry_backoff_ms   ?? row.retry?.backoffMs   ?? 5000,
    },
    timezone:    row.timezone || "UTC",
    rules:       row.rules ?? [],
    lastRunAt:   row.last_run_at  ?? row.lastRunAt  ?? null,
    lastStatus:  row.last_status  ?? row.lastStatus  ?? null,
    lastError:   row.last_error   ?? row.lastError   ?? null,
    createdAt:   row.created_at   ?? row.createdAt   ?? null,
    updatedAt:   row.updated_at   ?? row.updatedAt   ?? null,
  };
}

// -------------------------------------------------------
/**
 * Convert a raw scheduler_rules DB row to the camelCase format used by engine and frontend.
 * days_of_week is a MySQL SET type returned as comma-separated string "MON,TUE".
 */
function normalizeRule(row) {
  if (!row) return null;
  return {
    id:          row.id,
    ruleType:    row.rule_type    ?? row.ruleType    ?? "daily",
    daysOfWeek:  row.days_of_week
      ? String(row.days_of_week).split(",").map(s => s.trim()).filter(Boolean)
      : (Array.isArray(row.daysOfWeek) ? row.daysOfWeek : []),
    daysOfMonth: row.days_of_month ?? row.daysOfMonth ?? [],
    time:        row.time_hhmm    ?? row.time        ?? "00:00",
  };
}

// -------------------------------------------------------
/**
 * Transform frontend job format to database schema format
 * Frontend sends: { job: {...}, rules: [] }
 * Database expects: { description, enabled, method, url, ... }
 */
function transformJobDataForDB(requestBody) {
  const jobData = requestBody.job || requestBody;
  const transformedData = {};

  // Direct mappings
  if (jobData.job_key !== undefined) transformedData.job_key = jobData.job_key;
  if (jobData.jobKey !== undefined) transformedData.job_key = jobData.jobKey;
  if (jobData.description !== undefined) transformedData.description = jobData.description;
  if (jobData.enabled !== undefined) transformedData.enabled = jobData.enabled;
  if (jobData.method !== undefined) transformedData.method = jobData.method;
  if (jobData.url !== undefined) transformedData.url = jobData.url;
  if (jobData.headers !== undefined) transformedData.headers = jobData.headers;
  if (jobData.body !== undefined) transformedData.body = jobData.body;
  if (jobData.timezone !== undefined) transformedData.timezone = jobData.timezone;

  // CamelCase to snake_case mappings
  // NOTE: market_aware and market_exchanges columns do not exist in scheduler_jobs table
  if (jobData.timeoutMs !== undefined) transformedData.timeout_ms = jobData.timeoutMs;
  if (jobData.timeout_ms !== undefined) transformedData.timeout_ms = jobData.timeout_ms;

  // Flatten retry object
  if (jobData.retry) {
    if (jobData.retry.maxAttempts !== undefined) transformedData.retry_max_attempts = jobData.retry.maxAttempts;
    if (jobData.retry.backoffMs !== undefined) transformedData.retry_backoff_ms = jobData.retry.backoffMs;
  }

  return transformedData;
}

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

// Ricarica manualmente i job da dbManager
app.post("/reload", async (req, res) => {
  try {
    const core = serviceInstance.getSchedulerCore();
    if (!core) {
      return res.status(500).json({ ok: false, error: "SchedulerCore non inizializzato" });
    }
    const out = await core.reloadJobs();
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// Helper: join rules (from scheduler_rules) into job list
async function attachRulesToJobs(items, client) {
  const allRules = await client.listAllRules();
  const rulesByJobId = {};
  for (const r of allRules) {
    const jid = String(r.job_id);
    if (!rulesByJobId[jid]) rulesByJobId[jid] = [];
    rulesByJobId[jid].push(normalizeRule(r));
  }
  return items.map(job => ({ ...job, rules: rulesByJobId[String(job.id)] ?? [] }));
}

// Per vedere lo stato attuale dei job
app.get("/jobs", async (req, res) => {
  const includeDisabled =
    req.query.include_disabled === "1" ||
    req.query.include_disabled === "true" ||
    req.query.includeDisabled === "1" ||
    req.query.includeDisabled === "true";
  if (includeDisabled) {
    try {
      const client = createSchedulerJobsClient(serviceInstance.dbmanagerUrl, serviceInstance.getLogger());
      const items = await client.list(true);
      const itemsWithRules = await attachRulesToJobs(items, client);
      return res.json({ ok: true, items: itemsWithRules.map(dbRowToJob) });
    } catch (e) {
      const details = JSON.stringify({
        status: e?.response?.status || 500,
        data: e?.response?.data ?? null,
      });
      serviceInstance
        .getLogger()
        .error(`[GET /jobs] errore include_disabled ${e.message || e} | ${details}`);
      return res.status(500).json({ ok: false, error: "Errore lettura scheduler jobs" });
    }
  }
  const core = serviceInstance.getSchedulerCore();
  if (!core) {
    return res.status(500).json({ ok: false, error: "SchedulerCore non inizializzato" });
  }
  return res.json({ ok: true, items: core.getJobsSnapshot().map(dbRowToJob) });
});

// Crea/aggiorna un job nello scheduler (pass-through verso datahub)
app.post("/jobs", async (req, res) => {
  try {
    const core = serviceInstance.getSchedulerCore();
    if (!core) {
      return res.status(500).json({ ok: false, error: "SchedulerCore non inizializzato" });
    }

    // Transform frontend format to database format
    const transformedData = transformJobDataForDB(req.body);

    serviceInstance.getLogger().log(
      `[POST /jobs] Transformed to DB format with fields: ${Object.keys(transformedData).join(", ")}`
    );

    // Create job via datahub
    const client = createSchedulerJobsClient(serviceInstance.dbmanagerUrl, serviceInstance.getLogger());
    const result = await client.create(transformedData);

    // Save rules to scheduler_rules table
    const incomingRules = req.body?.rules ?? req.body?.job?.rules ?? [];
    const newJobId = result?.id ?? result?.insertedId;
    if (newJobId && Array.isArray(incomingRules)) {
      await client.replaceRules(newJobId, incomingRules);
    }

    // dopo la creazione ricarico i job nello scheduler
    await core.reloadJobs();

    return res.json({ ok: true, ...result });
  } catch (e) {
    const status = e?.response?.status || 500;
    const data = e?.response?.data ?? null;
    const details = JSON.stringify({ status, data });
    serviceInstance
      .getLogger()
      .error(`[POST /scheduler/jobs] errore ${e.message || e} | ${details}`);
    return res.status(status).json({
      ok: false,
      error: e?.message || String(e),
      module: "[POST /scheduler/jobs]",
      data,
    });
  }
});

// Aggiorna un job nello scheduler (pass-through verso datahub)
app.put("/jobs/:id", async (req, res) => {
  try {
    const core = serviceInstance.getSchedulerCore();
    if (!core) {
      return res.status(500).json({ ok: false, error: "SchedulerCore non inizializzato" });
    }

    const { id } = req.params;

    // Log incoming request body for debugging
    serviceInstance.getLogger().log(
      `[PUT /jobs/${id}] Received body with fields: ${Object.keys(req.body).join(", ")}`
    );

    // Transform frontend format to database format
    const transformedData = transformJobDataForDB(req.body);

    serviceInstance.getLogger().log(
      `[PUT /jobs/${id}] Transformed to DB format with fields: ${Object.keys(transformedData).join(", ")}`
    );

    const client = createSchedulerJobsClient(serviceInstance.dbmanagerUrl, serviceInstance.getLogger());
    const result = await client.update(id, transformedData);

    // Save rules to scheduler_rules table
    const incomingRules = req.body?.rules ?? req.body?.job?.rules ?? [];
    if (Array.isArray(incomingRules)) {
      await client.replaceRules(id, incomingRules);
    }

    await core.reloadJobs();

    return res.json({ ok: true, ...result });
  } catch (e) {
    const details = JSON.stringify({
      status: e?.response?.status || 500,
      data: e?.response?.data ?? null,
    });
    serviceInstance
      .getLogger()
      .error(`[PUT /scheduler/jobs/:id] errore ${e.message || e} | ${details}`);
    return res.status(500).json({
      ok: false,
      error: e.message || String(e),
      module: "[PUT /scheduler/jobs/:id]"
    });
  }
});

// Aggiorna last_run / last_status (pass-through verso datahub)
app.put("/jobs/:id/last-run", async (req, res) => {
  try {
    const core = serviceInstance.getSchedulerCore();
    if (!core) {
      return res.status(500).json({ ok: false, error: "SchedulerCore non inizializzato" });
    }

    const { id } = req.params;
    const client = createSchedulerJobsClient(serviceInstance.dbmanagerUrl, serviceInstance.getLogger());
    const result = await client.updateLastRun(id, req.body);

    await core.reloadJobs();

    return res.json({ ok: true, ...result });
  } catch (e) {
    const details = JSON.stringify({
      status: e?.response?.status || 500,
      data: e?.response?.data ?? null,
    });
    serviceInstance
      .getLogger()
      .error(`[PUT /scheduler/jobs/:id/last-run] errore ${e.message || e} | ${details}`);
    return res.status(500).json({
      ok: false,
      error: e.message || String(e),
      module: "[PUT /scheduler/jobs/:id/last-run]"
    });
  }
});

// Cancella un job nello scheduler (pass-through verso datahub)
app.delete("/job/:id", async (req, res) => {
  try {
    const core = serviceInstance.getSchedulerCore();
    if (!core) {
      return res.status(500).json({ ok: false, error: "SchedulerCore non inizializzato" });
    }

    const { id } = req.params;
    const client = createSchedulerJobsClient(serviceInstance.dbmanagerUrl, serviceInstance.getLogger());
    const result = await client.delete(id);

    await core.reloadJobs();

    return res.json({ ok: true, ...result });
  } catch (e) {
    serviceInstance.getLogger().error("[DELETE /scheduler/job/:id] errore", e.message || e);
    return res.status(500).json({
      ok: false,
      error: e.message || String(e),
      module: "[DELETE /scheduler/job/:id]"
    });
  }
});

// Leggi ultima esecuzione di un job da Redis KV
app.get("/jobs/:jobKey/last-run", async (req, res) => {
  try {
    const bus = serviceInstance.getBus();
    if (!bus) {
      return res.status(500).json({ ok: false, error: "Bus non disponibile" });
    }
    const redisKey = bus.key("scheduler", "lastrun", req.params.jobKey);
    const data = await bus.get(redisKey);
    if (!data) {
      return res.status(404).json({ ok: false, error: "Nessun dato trovato" });
    }
    return res.json({ ok: true, data });
  } catch (e) {
    const details = JSON.stringify({
      status: e?.response?.status || 500,
      data: e?.response?.data ?? null,
    });
    serviceInstance
      .getLogger()
      .error(`[GET /jobs/:jobKey/last-run] errore ${e.message || e} | ${details}`);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// Esecuzione manuale di un job per jobKey
app.post("/jobs/:jobKey/run", async (req, res) => {
  try {
    const core = serviceInstance.getSchedulerCore();
    if (!core) {
      return res.status(500).json({ ok: false, error: "SchedulerCore non inizializzato" });
    }

    const { jobKey } = req.params;
    const overrides = {};
    if (req.body?.headers && typeof req.body.headers === "object") {
      overrides.headers = req.body.headers;
    }
    if (req.body?.body !== undefined && req.body?.body !== null) {
      overrides.body = req.body.body;
    }
    const result = await core.runJobByKey(jobKey, overrides);
    if (!result.ok) {
      return res.status(404).json(result);
    }
    return res.json(result);
  } catch (e) {
    const details = JSON.stringify({
      status: e?.response?.status || 500,
      data: e?.response?.data ?? null,
    });
    serviceInstance
      .getLogger()
      .error(`[POST /jobs/:jobKey/run] errore ${e.message || e} | ${details}`);
    return res.status(500).json({
      ok: false,
      error: e.message || String(e),
      module: "[POST /jobs/:jobKey/run]"
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

/* ----------------------------- STARTUP -------------------------------- */
app.listen(port, () => {
  logger.info(`REST API for ${MICROSERVICE} listening on port ${port}`);
});
