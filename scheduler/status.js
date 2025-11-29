// status.js (TEMPLATE GENERICO)
"use strict";

const { Router } = require("express");

const maxInterval = parseInt(process.env.MAX_RETRY_DELAY, 10) || 60000;

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

  return router;
};
