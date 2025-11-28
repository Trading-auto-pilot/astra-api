// status.js (TEMPLATE GENERICO)
"use strict";

const { Router } = require("express");
const createStatsModule = require("./modules/stats");

const maxInterval = parseInt(process.env.MAX_RETRY_DELAY, 10) || 60000;

/**
 * Router di status per CacheManager.
 *
 * Viene montato in server.js con:
 *   const buildStatusRouter = require("./status");
 *   app.use("/status", buildStatusRouter({ cacheManager, logger, moduleName: MODULE_NAME }));
 *
 * Quindi le route esposte saranno:
 *   /status/health
 *   /status/info
 *   /status/L2
 *   /status/L1
 *   /status/paramsSetting
 *   /status/cacheHits
 *   ecc.
 */

/**
 * buildStatusRouter
 *
 * @param {object} opts
 * @param {object} opts.service   - istanza del main module (ex: new MainModule())
 * @param {object} opts.logger    - logger condiviso
 * @param {string} opts.moduleName
 */
module.exports = function buildStatusRouter({ service, logger, moduleName }) {
  const router = Router();

  // /status/health
  router.get("/health", (_req, res) => {
    res.json({
      status: "OK",
      module: moduleName,
      uptime: process.uptime(),
    });
  });

  // /status/info
  router.get("/info", (_req, res) => {
    try {
      if (!service || typeof service.getInfo !== "function") {
        return res.status(501).json({ error: "getInfo() not implemented" });
      }
      res.json(service.getInfo());
    } catch (e) {
      logger.error(`[status/info] ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // /status/communicationChannels (GET)
  router.get("/communicationChannels", (_req, res) => {
    try {
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

  // /status/communicationChannels (PUT)
  router.put("/communicationChannels", async (req, res) => {
    const allowedKeys = ["telemetry", "metrics", "data", "logs"];

    try {
      if (!service || typeof service.updateCommunicationChannel !== "function") {
        return res.status(501).json({
          error: "updateCommunicationChannel() not implemented in service",
        });
      }

      // accetta sia { communicationChannels: {...} } sia direttamente {...}
      const input =
        (req.body &&
          (req.body.communicationChannels || req.body)) ||
        {};

      if (typeof input !== "object" || Array.isArray(input)) {
        return res.status(400).json({
          error: "payload non valido: atteso oggetto di configurazione",
        });
      }

      const normalized = {};
      const details = {};

      for (const key of allowedKeys) {
        const cfg = input[key];

        if (!cfg || typeof cfg !== "object") {
          // se manca, non forziamo nulla: lascia che il main applichi default/precedenti
          continue;
        }

        if (typeof cfg.on !== "boolean") {
          return res.status(400).json({
            error: `chiave "${key}": "on" deve essere booleano`,
          });
        }

        const ms = cfg?.params?.intervalsMs;
        if (
          typeof ms !== "number" ||
          !Number.isInteger(ms) ||
          ms <= 0
        ) {
          return res.status(400).json({
            error: `chiave "${key}": "params.intervalsMs" deve essere intero positivo`,
          });
        }

        const clamped = Math.min(ms, maxInterval);
        const nowCfg = { on: cfg.on, params: { intervalsMs: clamped } };
        normalized[key] = nowCfg;

        details[key] = {
          on: nowCfg.on,
          intervalsMs: nowCfg.params.intervalsMs,
        };
      }

      // delega la vera applicazione al main module (che aggiornerà bus + state)
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

  // /status/metrics
  router.get("/metrics", (_req, res) => {
    try {
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

  // ---------- Log level (solo CacheManager) ----------

  router.get("/logLevel", (req, res) => {
    res
      .status(200)
      .json({ cacheManager: cacheManager.getLogLevel && cacheManager.getLogLevel() });
  });

  router.put("/logLevel", (req, res) => {
    const { logLevel } = req.body || {};
    if (!logLevel || !cacheManager.setLogLevel) {
      return res
        .status(400)
        .json({ success: false, error: "Missing logLevel or setter not available" });
    }
    cacheManager.setLogLevel(logLevel);
    res
      .status(200)
      .json({ success: true, cacheManager: cacheManager.getLogLevel() });
  });



  router.get("/L1", (_req, res) => {
    try {
      const data = stats.getL1Stats();
      res.json({ ok: true, data });
    } catch (e) {
      logger.error(`[${moduleName}] [GET] /stats/L1 ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // /stats/L2
  router.get("/L2", (_req, res) => {
    try {
      const data = stats.getL2Stats();
      res.json({ ok: true, data });
    } catch (e) {
      logger.error(`[${moduleName}] [GET] /stats/L2 ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // /paramsSetting
  router.get("/paramsSetting", (_req, res) => {
    try {
      const data = stats.getParamsSetting();
      res.json({ ok: true, data });
    } catch (e) {
      logger.error(`[${moduleName}] [GET] /paramsSetting ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // /cacheHits
  router.get("/cacheHits", (_req, res) => {
    try {
      const data = stats.getCacheHits();
      res.json({ ok: true, data });
    } catch (e) {
      logger.error(`[${moduleName}] [GET] /cacheHits ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });


  return router;
};
