// statusRouterFactory.js - Factory per creare router /status/* standardizzato
"use strict";

const { Router } = require("express");

const maxInterval = parseInt(process.env.MAX_RETRY_DELAY, 10) || 60000;

/**
 * buildStatusRouter - Crea un router Express standardizzato per /status/*
 *
 * @param {object} options - Opzioni di configurazione
 * @param {function} options.getServiceInstance - Function che ritorna l'istanza del servizio
 * @param {object} options.logger - Istanza del logger
 * @param {string} [options.moduleName='status'] - Nome del modulo per logging
 * @returns {Router} Express router configurato
 *
 * @example
 * const buildStatusRouter = require('../shared/statusRouterFactory');
 *
 * app.use('/status', buildStatusRouter({
 *   getServiceInstance: () => serviceInstance,
 *   logger: logger,
 *   moduleName: 'RESTServer'
 * }));
 */
function buildStatusRouter(options) {
  // Support both old and new API
  let getServiceInstance;
  let logger;
  let moduleName;

  if (typeof options === 'function') {
    // New API: buildStatusRouter(() => serviceInstance)
    getServiceInstance = options;
    logger = console;
    moduleName = 'status';
  } else if (options && typeof options === 'object') {
    // Old API: buildStatusRouter({ service, logger, moduleName })
    if (options.service) {
      // Direct service instance (old pattern)
      const serviceInstance = options.service;
      getServiceInstance = () => serviceInstance;
    } else if (typeof options.getServiceInstance === 'function') {
      // Function getter (new pattern)
      getServiceInstance = options.getServiceInstance;
    } else {
      throw new Error('statusRouterFactory requires either service instance or getServiceInstance function');
    }

    logger = options.logger || console;
    moduleName = options.moduleName || 'status';
  } else {
    throw new Error('statusRouterFactory requires options object or getServiceInstance function');
  }

  const router = Router();

  // =========================================================
  // GET /status/health - Simple health check
  // =========================================================
  router.get("/health", (_req, res) => {
    const service = getServiceInstance();

    if (!service) {
      return res.status(503).json({
        status: "unavailable",
        module: moduleName,
      });
    }

    res.json({
      status: "OK",
      module: moduleName,
      uptime: process.uptime(),
    });
  });

  // =========================================================
  // GET /status/info - Service information
  // Calls getInfoWithAuth() if available (e.g. ibkr-bridge), otherwise getInfo()
  // =========================================================
  router.get("/info", async (_req, res) => {
    try {
      const service = getServiceInstance();

      if (!service || typeof service.getInfo !== "function") {
        return res.status(501).json({ error: "getInfo() not implemented" });
      }

      if (typeof service.getInfoWithAuth === "function") {
        const info = await service.getInfoWithAuth();
        return res.json(info);
      }

      res.json(service.getInfo());
    } catch (e) {
      logger.error(`[${moduleName}] [status/info] ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // =========================================================
  // GET /status/communicationChannels - Get channel config
  // =========================================================
  router.get("/communicationChannels", (_req, res) => {
    try {
      const service = getServiceInstance();

      const info =
        service && typeof service.getInfo === "function"
          ? service.getInfo()
          : null;

      const channels =
        info && info.communicationChannels
          ? info.communicationChannels
          : null;

      if (!channels) {
        return res.status(404).json({
          error: "communicationChannels not available",
        });
      }

      res.json({ communicationChannels: channels });
    } catch (e) {
      logger.error(`[${moduleName}] [GET] /communicationChannels ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // =========================================================
  // PUT /status/communicationChannels - Update channel config
  // =========================================================
  router.put("/communicationChannels", async (req, res) => {
    const allowedKeys = ["telemetry", "metrics", "data", "logs", "events"];

    try {
      const service = getServiceInstance();

      if (!service || typeof service.updateCommunicationChannel !== "function") {
        return res.status(501).json({
          error: "updateCommunicationChannel() not implemented in service",
        });
      }

      // Accept both { communicationChannels: {...} } and direct {...}
      const input =
        (req.body &&
          (req.body.communicationChannels || req.body)) ||
        {};

      if (typeof input !== "object" || Array.isArray(input)) {
        return res.status(400).json({
          error: "Invalid payload: expected configuration object",
        });
      }

      const normalized = {};
      const details = {};

      for (const key of allowedKeys) {
        const cfg = input[key];

        if (!cfg || typeof cfg !== "object") {
          // If missing, don't force anything: let main apply defaults/previous
          continue;
        }

        if (typeof cfg.on !== "boolean") {
          return res.status(400).json({
            error: `key "${key}": "on" must be boolean`,
          });
        }

        const ms = cfg?.params?.intervalsMs;
        if (
          typeof ms !== "number" ||
          !Number.isInteger(ms) ||
          ms < 0
        ) {
          return res.status(400).json({
            error: `key "${key}": "params.intervalsMs" must be non-negative integer`,
          });
        }

        const clamped = ms > 0 ? Math.min(ms, maxInterval) : ms;
        const nowCfg = { on: cfg.on, params: { intervalsMs: clamped } };
        normalized[key] = nowCfg;

        details[key] = {
          on: nowCfg.on,
          intervalsMs: nowCfg.params.intervalsMs,
        };
      }

      // Delegate actual application to main module (which will update bus + state)
      const result = await service.updateCommunicationChannel(normalized);

      return res.status(200).json({
        communicationChannels: result?.channels || normalized,
        details,
        maxAllowedIntervalMs: maxInterval,
      });
    } catch (e) {
      logger.error(
        `[${moduleName}] [PUT] /communicationChannels ${e.message}`
      );
      return res.status(500).json({ error: e.message });
    }
  });

  // =========================================================
  // GET /status/metrics - Get metrics snapshot
  // =========================================================
  router.get("/metrics", (_req, res) => {
    try {
      const service = getServiceInstance();

      if (!service || typeof service.getMetricsSnapshot !== "function") {
        return res.status(501).json({
          error: "getMetricsSnapshot() not implemented",
        });
      }

      const data = service.getMetricsSnapshot(100);
      res.json(data);
    } catch (e) {
      logger.error(`[${moduleName}] [GET] /metrics ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // =========================================================
  // GET /status/logLevel - Get current log level
  // =========================================================
  router.get("/logLevel", (_req, res) => {
    try {
      const service = getServiceInstance();

      const current =
        service && typeof service.getLogLevel === "function"
          ? service.getLogLevel()
          : null;

      // Return with service name if available
      const microserviceName = service?.microservice || service?._microservice || 'service';
      const response = { [microserviceName]: current };

      res.status(200).json(response);
    } catch (e) {
      logger.error(`[${moduleName}] [GET] /logLevel ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // =========================================================
  // PUT /status/logLevel - Set log level
  // =========================================================
  router.put("/logLevel", (req, res) => {
    try {
      const service = getServiceInstance();
      const { logLevel } = req.body || {};

      if (!logLevel) {
        return res.status(400).json({
          success: false,
          error: "Missing logLevel in request body"
        });
      }

      if (!service || typeof service.setLogLevel !== "function") {
        return res.status(501).json({
          success: false,
          error: "setLogLevel() not implemented",
        });
      }

      service.setLogLevel(logLevel);

      const current =
        service && typeof service.getLogLevel === "function"
          ? service.getLogLevel()
          : logLevel;

      // Return with service name if available
      const microserviceName = service?.microservice || service?._microservice || 'service';
      const response = {
        success: true,
        [microserviceName]: current
      };

      res.status(200).json(response);
    } catch (e) {
      logger.error(`[${moduleName}] [PUT] /logLevel ${e.message}`);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}

module.exports = buildStatusRouter;
