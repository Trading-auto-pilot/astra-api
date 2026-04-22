// status.js (TEMPLATE GENERICO)
"use strict";

const { Router } = require("express");
const createStatsModule = require("./modules/stats");
const { getConfigInt } = require("../shared/loadSettings");

const maxInterval = getConfigInt("MAX_RETRY_DELAY", 60000);

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
 * @param {object} [opts.stats]   - modulo stats opzionale
 */
module.exports = function buildStatusRouter({ service, logger, moduleName, stats }) {
  const router = Router();
  const statsRef = stats || {
    getL1Stats: () => ({}),
    getL2Stats: () => ({}),
    getParamsSetting: () => ({}),
    getCacheHits: () => ({}),
    getL2Size: async () => ({ basePath: null, totalBytes: 0, tree: {} }),
    deleteL2: async () => ({ ok: false }),
    getL3Size: async () => ({ ok: false, totalBytes: 0, keys: [] }),
    deleteL3: async () => ({ ok: false }),
  };

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
    const allowedKeys = ["telemetry", "metrics", "data", "logs", "events"];

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
    const current =
      service && typeof service.getLogLevel === "function"
        ? service.getLogLevel()
        : null;
    res.status(200).json({ cacheManager: current });
  });

  router.put("/logLevel", (req, res) => {
    const { logLevel } = req.body || {};
    if (!logLevel || !service || typeof service.setLogLevel !== "function") {
      return res
        .status(400)
        .json({ success: false, error: "Missing logLevel or setter not available" });
    }
    service.setLogLevel(logLevel);
    const current =
      service && typeof service.getLogLevel === "function"
        ? service.getLogLevel()
        : logLevel;
    res.status(200).json({ success: true, cacheManager: current });
  });



  router.get("/L1", (_req, res) => {
    try {
      const data = statsRef.getL1Stats();
      res.json({ ok: true, data });
    } catch (e) {
      logger.error(`[${moduleName}] [GET] /stats/L1 ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // /stats/L2
  router.get("/L2", (_req, res) => {
    try {
      const data = statsRef.getL2Stats();
      res.json({ ok: true, data });
    } catch (e) {
      logger.error(`[${moduleName}] [GET] /stats/L2 ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // /paramsSetting
  router.get("/paramsSetting", (_req, res) => {
    try {
      const data = statsRef.getParamsSetting();
      res.json({ ok: true, data });
    } catch (e) {
      logger.error(`[${moduleName}] [GET] /paramsSetting ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // /cacheHits
  router.get("/cacheHits", (_req, res) => {
    try {
      const data = statsRef.getCacheHits();
      res.json({ ok: true, data });
    } catch (e) {
      logger.error(`[${moduleName}] [GET] /cacheHits ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // /stats/L2/size
  router.get("/L2/size", async (_req, res) => {
    try {
      const data = await statsRef.getL2Size();
      res.json({ ok: true, data });
    } catch (e) {
      logger.error(`[${moduleName}] [GET] /L2/size ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // DELETE /L2/size -> delete all
  router.delete("/L2/size", async (_req, res) => {
    try {
      const result = await statsRef.deleteL2([]);
      if (!result.ok) {
        return res.status(404).json({ ok: false, error: "Path not found or not deleted" });
      }
      res.json({ ok: true, deleted: result.deleted });
    } catch (e) {
      logger.error(`[${moduleName}] [DELETE] /L2/size ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // DELETE /L2/size/:symbol -> delete symbol folder
  router.delete("/L2/size/:symbol", async (req, res) => {
    try {
      const segments = [req.params.symbol].filter(Boolean);
      const result = await statsRef.deleteL2(segments);
      if (!result.ok) {
        return res.status(404).json({ ok: false, error: "Path not found or not deleted" });
      }
      res.json({ ok: true, deleted: result.deleted });
    } catch (e) {
      logger.error(`[${moduleName}] [DELETE] /L2/size/:symbol ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // DELETE /L2/size/:symbol/:date -> delete specific file
  router.delete("/L2/size/:symbol/:date", async (req, res) => {
    try {
      const segments = [req.params.symbol, req.params.date].filter(Boolean);
      const result = await statsRef.deleteL2(segments);
      if (!result.ok) {
        return res.status(404).json({ ok: false, error: "Path not found or not deleted" });
      }
      res.json({ ok: true, deleted: result.deleted });
    } catch (e) {
      logger.error(`[${moduleName}] [DELETE] /L2/size/:symbol/:date ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // /L3/size (Redis)
  router.get("/L3/size", async (_req, res) => {
    try {
      const data = await statsRef.getL3Size();
      if (data.ok === false) {
        return res.status(503).json(data);
      }
      res.json({ ok: true, data });
    } catch (e) {
      logger.error(`[${moduleName}] [GET] /L3/size ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // DELETE L3 cache
  router.delete("/L3/size", async (_req, res) => {
    try {
      const result = await statsRef.deleteL3([]);
      if (!result.ok) return res.status(500).json(result);
      res.json({ ok: true, ...result });
    } catch (e) {
      logger.error(`[${moduleName}] [DELETE] /L3/size ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.delete("/L3/size/:symbol", async (req, res) => {
    try {
      const result = await statsRef.deleteL3([req.params.symbol]);
      if (!result.ok) return res.status(500).json(result);
      res.json({ ok: true, ...result });
    } catch (e) {
      logger.error(`[${moduleName}] [DELETE] /L3/size/:symbol ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.delete("/L3/size/:symbol/:tf", async (req, res) => {
    try {
      const result = await statsRef.deleteL3([req.params.symbol, req.params.tf]);
      if (!result.ok) return res.status(500).json(result);
      res.json({ ok: true, ...result });
    } catch (e) {
      logger.error(`[${moduleName}] [DELETE] /L3/size/:symbol/:tf ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });


  return router;
};
