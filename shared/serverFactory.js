// serverFactory.js - Factory per creare server Express standardizzato
"use strict";

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const createLogger = require("./logger");
const buildStatusRouter = require("./statusRouterFactory");

dotenv.config();

/**
 * createMicroserviceServer - Crea un server Express standardizzato per microservizi
 *
 * @param {object} config - Configurazione del server
 * @param {class} config.ServiceClass - Classe del servizio (estende BaseService)
 * @param {string} config.microservice - Nome del microservizio
 * @param {string} [config.moduleName='RESTServer'] - Nome del modulo
 * @param {string} [config.moduleVersion='1.0.0'] - Versione del modulo
 * @param {number} config.defaultPort - Porta di default
 * @param {array} [config.routes=[]] - Array di route custom { path, router, protected }
 * @param {function} [config.beforeInit] - Hook chiamato prima dell'init del servizio
 * @param {function} [config.afterInit] - Hook chiamato dopo l'init del servizio
 * @param {object} [config.corsOptions] - Opzioni CORS custom
 * @param {boolean} [config.enableStandardRoutes=true] - Abilita route standard
 * @param {boolean} [config.enableStatusRouter=true] - Abilita status router
 * @param {function} [config.logger] - Logger custom (se non fornito, ne crea uno)
 *
 * @returns {object} { app, getService, server }
 *
 * @example
 * const { createMicroserviceServer } = require('../shared/serverFactory');
 * const MyService = require('./modules/main');
 *
 * createMicroserviceServer({
 *   ServiceClass: MyService,
 *   microservice: 'my-service',
 *   defaultPort: 3020,
 *   routes: [
 *     { path: '/custom', router: customRouter, protected: true }
 *   ]
 * });
 */
function createMicroserviceServer(config) {
  const {
    ServiceClass,
    microservice,
    moduleName = "RESTServer",
    moduleVersion = "1.0.0",
    defaultPort,
    routes = [],
    beforeInit = async () => {},
    afterInit = async () => {},
    corsOptions = null,
    enableStandardRoutes = true,
    enableStatusRouter = true,
    logger: customLogger = null,
  } = config;

  // Validation
  if (!ServiceClass) {
    throw new Error("createMicroserviceServer requires ServiceClass parameter");
  }
  if (!microservice) {
    throw new Error("createMicroserviceServer requires microservice parameter");
  }
  if (!defaultPort) {
    throw new Error("createMicroserviceServer requires defaultPort parameter");
  }

  // Create logger
  const logLevel = process.env.LOG_LEVEL || "info";
  const logger = customLogger || createLogger(microservice, moduleName, moduleVersion, logLevel);
  process.env.MICROSERVICE_NAME = process.env.MICROSERVICE_NAME || microservice;

  // Create Express app
  const app = express();
  app.use(express.json({ limit: process.env.BODY_LIMIT || '20mb' }));

  // =========================================================
  // CORS Configuration
  // =========================================================
  if (corsOptions === null) {
    // Default CORS configuration with Traefik support
    app.use(
      cors({
        origin: true, // Accept origin, Traefik will decide if to return headers
        credentials: true,
      })
    );
  } else if (corsOptions === false) {
    // CORS disabled
  } else if (typeof corsOptions === 'object') {
    // Custom CORS configuration
    app.use(cors(corsOptions));
  } else {
    // Alternative: list-based CORS
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
  }

  const port = process.env.PORT || defaultPort;
  let serviceInstance = null;
  let httpServer = null;

  // =========================================================
  // Middleware: requireReady - Verify service is ready
  // =========================================================
  function requireReady(req, res, next) {
    if (!serviceInstance) {
      return res.status(503).json({
        error: "Service not initialized yet",
      });
    }

    const status = serviceInstance.status;

    // Generic logic: block if status is "ERROR" or "STOPPED"
    if (status === "ERROR" || status === "STOPPED") {
      return res.status(503).json({
        error: "Service not running",
        status,
      });
    }

    next();
  }

  // =========================================================
  // STANDARD ROUTES (if enabled)
  // =========================================================

  if (enableStandardRoutes) {
    // GET /release → Return release.json
    app.get("/release", async (req, res) => {
      try {
        if (!serviceInstance) {
          return res.status(503).json({ error: "Service not initialized" });
        }
        const data = await serviceInstance.getReleaseInfo();
        return res.json(data);
      } catch (err) {
        logger.error("[GET /release] Error:", err.message);
        return res.status(500).json({ error: "Unable to read release.json" });
      }
    });

    // GET /settings → Return loaded settings
    app.get("/settings", requireReady, (req, res) => {
      try {
        const data = serviceInstance.getAllSettings?.() || null;
        if (!data) return res.status(404).json({ error: "Settings not available" });
        return res.json({ ok: true, data });
      } catch (err) {
        logger.error("[GET /settings] Error:", err.message);
        return res.status(500).json({ error: "Unable to read settings" });
      }
    });

    // PUT /settings → Update a setting in cache (not persistent)
    app.put("/settings", requireReady, (req, res) => {
      const body = req.body || {};
      // Support both { setting, value } and { SOME_KEY: "value" }
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
        return res.status(400).json({ ok: false, error: "'setting' parameter required" });
      }

      try {
        const next = serviceInstance.setSetting(setting, value);
        return res.json({ ok: true, data: next });
      } catch (err) {
        logger.error("[PUT /settings] Error:", err.message);
        return res.status(500).json({ ok: false, error: "Unable to update setting" });
      }
    });

    // POST /settings/reload → Reload settings from DB
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

    // PUT /connect → Start live connection (e.g., websocket/market)
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

    // DELETE /connect → Close live connection
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

    // GET /dbLogger → Get DB logging status
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

    // PUT /dbLogger/:status → Enable/disable DB logging (on/off)
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
  }

  // =========================================================
  // CUSTOM ROUTES
  // =========================================================
  routes.forEach(({ path, router, protected: isProtected = true }) => {
    // Support both router objects and router factory functions
    const routerInstance = typeof router === 'function'
      ? router({ logger, getService: () => serviceInstance, app })
      : router;

    if (isProtected) {
      app.use(path, requireReady, routerInstance);
    } else {
      app.use(path, routerInstance);
    }
  });

  // =========================================================
  // STATUS ROUTER (if enabled)
  // =========================================================
  if (enableStatusRouter) {
    app.use(
      "/status",
      requireReady,
      buildStatusRouter({
        getServiceInstance: () => serviceInstance,
        logger,
        moduleName,
      })
    );
  }

  // =========================================================
  // SERVICE INITIALIZATION
  // =========================================================
  (async () => {
    try {
      logger.info(`[${microservice}] Starting ${moduleName}...`);

      // Before init hook
      await beforeInit();

      // Create and initialize service instance
      serviceInstance = new ServiceClass();
      await serviceInstance.init();

      // After init hook
      await afterInit(serviceInstance);

      logger.info(`[${microservice}] Service initialized successfully`);

      // Start HTTP server
      httpServer = app.listen(port, () => {
        logger.info(`[${microservice}] REST API listening on port ${port}`);
      });
    } catch (err) {
      logger.error(
        `[${microservice}] Error during initialization: ${err?.message || String(err)}`
      );
      console.error(err); // Also log to console for visibility
      process.exit(1);
    }
  })();

  // =========================================================
  // GRACEFUL SHUTDOWN
  // =========================================================
  const shutdown = async (signal) => {
    logger.info(`[${microservice}] Received ${signal}, shutting down gracefully...`);

    // Close HTTP server
    if (httpServer) {
      httpServer.close(() => {
        logger.info(`[${microservice}] HTTP server closed`);
      });
    }

    // Disconnect service
    if (serviceInstance && typeof serviceInstance.disconnect === 'function') {
      try {
        await serviceInstance.disconnect();
      } catch (err) {
        logger.error(`[${microservice}] Error during shutdown: ${err?.message || String(err)}`);
      }
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // =========================================================
  // RETURN API
  // =========================================================
  return {
    app,
    getService: () => serviceInstance,
    getServer: () => httpServer,
    logger,
  };
}

module.exports = { createMicroserviceServer };
