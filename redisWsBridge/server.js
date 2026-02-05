const express = require('express');
const http = require('http');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const createLogger = require('../shared/logger');

const { RedisBus } = require('../shared/redisBus');   // <— riuso libreria
const buildStatusRouter = require('./status');
const { makeWsHub } = require('./wsHub');
const { loadConfig } = require('./config');

const MICROSERVICE = 'redisWsBridge';
const MODULE_NAME = 'RESTServer';
const MODULE_VERSION = '1.0';

(async () => {
  const cfg = loadConfig();

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

  let logLevel = process.env.LOG_LEVEL || 'info'
  logger = createLogger(
      MICROSERVICE,
      MODULE_NAME,
      MODULE_VERSION,
      logLevel,
      {
          bus: null,                          // <--- FIX: non _bus
          busTopicPrefix: this.env || 'DEV',
          console: true,
          enqueueDb: true,
      }
  );
  cfg['logger']=logger;
  logger.info('[bridge] allowedOrigins', {
    raw: process.env.CORS_ORIGIN || null,
    parsed: allowedOrigins
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const hub = makeWsHub({ cfg });



  // --- RedisBus: init + connect
  const bus = new RedisBus({
    url: cfg.redisUrl,
    name: 'redis-ws-bridge',
    logger: logger,
    channels: {
      // opzionale: telemetria del bridge (controllata dal key "telemetry")
      telemetry: { on: true, params: { intervalsMs: 2000 } }
    },
    defaultIntervalMs: 500
  });
  await bus.connect();
  logger.info('[bridge] BUS status:', JSON.stringify(bus.status())); // deve mostrare subIsOpen: true

  for (const pat of cfg.redisPatterns) {
    logger.info('[bridge] PSUBSCRIBE ->', pat);
    const ret = await bus.psubscribe(pat, (parsed, raw, channel) => {
      logger.log('[bridge] recv', JSON.stringify({ channel, parsed, rawLen: raw?.length }));
      const msg = parsed ?? { type: 'raw', payload: raw };
      msg.__channel = channel;
      hub.dispatch(msg);
    });
    logger.log('[bridge] psubscribe ret:', ret);
  }

  if (!bus.sub?.isOpen) {
    logger.error('[bridge] SUB not open!');
  }


  logger.info('[bridge] bus status:', JSON.stringify(bus.status())); 
    bus.sub.on('error', (e) => logger.error('[bus sub error]', e));
    bus.pub.on('error', (e) => logger.error('[bus pub error]', e));

  // status endpoints
  app.use('/status', buildStatusRouter({
    cfg,
    hub,
    bus
  }));

  /**
   * GET /dbLogger
   * Restituisce lo stato del logging su DB, se supportato dal logger.
   */
  app.get("/dbLogger", async (_req, res) => {
    if (!logger?.getDbLogStatus) {
      return res.status(501).json({
        ok: false,
        error: "getDbLogStatus() not implemented in this microservice",
      });
    }

    try {
      const data = await logger.getDbLogStatus();
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
    if (!logger?.setDbLogStatus) {
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
      const data = await logger.setDbLogStatus(enable);
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

  // bind WS
  wss.on('connection', (socket, req) => hub.addClient(socket, req));

  server.listen(cfg.port, () => {
    console.log(`[bridge] listening on :${cfg.port}`);
  });
})();
