module.exports = async function createApp({ bus, logger }) {

  const express = require('express');
  const cors = require('cors');
  const fs = require('fs');
  const path = require('path');
  const { mountRoutesFrom } = require("../shared/routes-loader");
  const buildStatusRouter = require("./status");
  require('dotenv').config({ path: '../.env' });

  const log = logger.forModule(__filename);
  const MICROSERVICE = 'DBManager';
  const MODULE_NAME = 'endpoints';
  const MODULE_VERSION = '1.0';
  
  const dbManager = require('./modules');
    const app = express();
    const port = process.env.PORT || 3002;

    const maxInterval = parseInt(process.env.MAX_RETRY_DELAY, 10) || 60000;

    // ── Communication channels (stato locale + bridge verso bus) ──
    const communicationChannels = {
      telemetry: { on: true, params: { intervalsMs: 1000 } },
      metrics:   { on: true, params: { intervalsMs: 1000 } },
      data:      { on: true, params: { intervalsMs: 0    } },
      logs:      { on: true, params: { intervalsMs: 0    } },
      events:    { on: true, params: { intervalsMs: 0    } },
    };

    function normalizeChannels(inCfg = {}, prev = {}) {
      const ms = (v, d = 500) => Number(v ?? d) || d;
      const norm = (k) => ({
        on: !!(inCfg?.[k]?.on ?? prev?.[k]?.on ?? true),
        params: {
          intervalsMs: ms(
            inCfg?.[k]?.params?.intervalsMs ??
            prev?.[k]?.params?.intervalsMs ??
            500
          ),
        },
      });
      return {
        telemetry: norm("telemetry"),
        metrics:   norm("metrics"),
        data:      norm("data"),
        logs:      norm("logs"),
        events:    norm("events"),
      };
    }

    // Service adapter: wrappa il flat dbManager + aggiunge communication channels
    const service = Object.create(dbManager);
    service.communicationChannels = communicationChannels;

    service.getInfo = function () {
      return {
        MICROSERVICE,
        MODULE_NAME,
        MODULE_VERSION,
        ENV: process.env.ENV || process.env.APP_ENV || 'DEV',
        communicationChannels: this.communicationChannels,
      };
    };

    service.updateCommunicationChannel = async function (newConf) {
      const cfg = normalizeChannels(newConf, this.communicationChannels);
      this.communicationChannels = cfg;

      if (typeof bus.setChannelConfig === "function") {
        bus.setChannelConfig("telemetry", cfg.telemetry);
        bus.setChannelConfig("metrics",   cfg.metrics);
        bus.setChannelConfig("data",      cfg.data);
        bus.setChannelConfig("logs",      cfg.logs);
        bus.setChannelConfig("events",    cfg.events);
      }

      log.info(
        `[channels] telemetry=${cfg.telemetry.on} metrics=${cfg.metrics.on} data=${cfg.data.on} logs=${cfg.logs.on} events=${cfg.events.on}`
      );

      return { ok: true, channels: cfg };
    };


    // 🌍 Costanti di modulo
    //const log = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

    //const bus = new RedisBus({ env: process.env.APP_ENV, name: 'strategies-cache', log });
    await bus.connect();
    app.set('bus', bus);

    app.use(cors({
      origin: 'http://localhost:5173', // indirizzo frontend
      credentials: true // se usi cookie o auth
    }));

    const bodyLimit = process.env.BODY_LIMIT || "50mb";
    // log richieste (minimo dettaglio) per capire chi invia payload grandi
    app.use((req, _res, next) => {
      const ua = req.headers["user-agent"] || "-";
      const fwd = req.headers["x-forwarded-for"] || req.ip || "-";
      log.trace(
        `[request] ${req.method} ${req.originalUrl} cl=${req.headers["content-length"] || "-"} ip=${fwd} ua=${ua}`
      );
      next();
    });
    app.use(express.json({ limit: bodyLimit }));
    app.use(express.urlencoded({ limit: bodyLimit, extended: true }));
    // Handler per payload troppo grandi (body-parser)
    app.use((err, req, res, next) => {
      if (err?.type === "entity.too.large" || err?.status === 413) {
        const ua = req.headers["user-agent"] || "-";
        const fwd = req.headers["x-forwarded-for"] || req.ip || "-";
        log.error(
          `[bodyParser] Payload too large ${req.method} ${req.originalUrl} cl=${req.headers["content-length"] || "-"} limit=${bodyLimit} ip=${fwd} ua=${ua}`
        );
        return res.status(413).json({ error: "Payload too large" });
      }
      return next(err);
    });

    // 🔁 Healthcheck
    app.get('/health', (req, res) => {
      res.json({ status: 'OK', module: MODULE_NAME, version: MODULE_VERSION });
    });

    // ℹ️ Info endpoint
    app.get('/info', (req, res) => {
      res.json({
        microservice:MICROSERVICE,
        module: MODULE_NAME,
        version: MODULE_VERSION,
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
      });
    });

  // GET /release → ritorna release.json
  app.get("/release", async (req, res) => {
    try {
      const data = await dbManager.getReleaseInfo();
      return res.json(data);
    } catch (err) {
      logger.error("[GET /release] Errore:", err.message);
      return res.status(500).json({ error: "Impossibile leggere release.json" });
    }
  });

    // middleware/withTimeout.js
    function withTimeout(ms = 8000) {
      return (req, res, next) => {
        const t = setTimeout(() => {
          if (!res.headersSent) {
            log.warning(`Time out richiesta endpoint `);
            res.status(504).json({ error: `timeout ${ms}ms` });
          }
        }, ms)
        res.on("finish", () => clearTimeout(t))
        next()
      }
    }

    // ── /status/* (health, logLevel, communicationChannels) ──
    app.use(
      "/status",
      buildStatusRouter({
        service,
        logger: log,
        moduleName: MODULE_NAME,
      })
    );

    // ── /dbLogger (GET status, PUT on/off) ──
    app.get("/dbLogger", async (_req, res) => {
      try {
        const data = await dbManager.getDbLogStatus();
        res.json({ ok: true, data });
      } catch (e) {
        log.error(`[GET /dbLogger] Error: ${e?.message || String(e)}`);
        res.status(500).json({ ok: false, error: e?.message || String(e) });
      }
    });

    app.put("/dbLogger/:status", async (req, res) => {
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
        const data = await dbManager.setDbLogStatus(enable);
        if (data == null) {
          return res.status(404).json({ ok: false, error: "not found" });
        }
        return res.json({ ok: true, status: enable ? "on" : "off", data });
      } catch (e) {
        log.error(`[PUT /dbLogger/:status] Error: ${e?.message || String(e)}`);
        return res
          .status(500)
          .json({ ok: false, error: e?.message || String(e) });
      }
    });

    app.use("/api", withTimeout(8000))

    // vecchie /routes (flat)
    
  // ROUTES ROOT
  mountRoutesFrom(app, {
    routesDir   : path.join(__dirname, "routes"),
    baseUrl     : "/",
    factoryArgs : [dbManager],
    logger
  });

  // ROUTES API
  mountRoutesFrom(app, {
    routesDir   : path.join(__dirname, "api"),
    baseUrl     : "/api",
    factoryArgs : [dbManager, bus, { logger }],
    logger,
  });


    return app;

}
