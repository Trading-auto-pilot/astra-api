const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs/promises');
const { WebSocketServer } = require('ws');
const createLogger = require('../shared/logger');

const { RedisBus } = require('../shared/redisBus');   // <— riuso libreria
const { publishEventsManifest } = require('../shared/eventsManifestRegistry');
const buildStatusRouter = require('./status');
const { makeWsHub } = require('./wsHub');
const { loadConfig } = require('./config');
const {
  initializeSettings,
  getAllSettings,
  setSetting,
  getConfigString,
} = require('../shared/loadSettings');

const MICROSERVICE = 'redisWsBridge';
const MODULE_NAME = 'RESTServer';
const MODULE_VERSION = '1.0';

(async () => {
  const cfg = loadConfig();
  // Support both DATAHUB_URL (preferred) and DBMANAGER_URL (backward compat)
  const dbmanagerUrl = getConfigString(['DATAHUB_URL', 'DBMANAGER_URL'], 'http://datahub:3000');
  let settingsReady = false;

  async function getReleaseInfo() {
    const candidates = Array.from(
      new Set(
        [
          path.resolve(__dirname, 'release.json'),
          path.resolve(__dirname, '..', 'release.json'),
          path.resolve(process.cwd(), 'release.json'),
        ].filter(Boolean)
      )
    );
    for (const filePath of candidates) {
      try {
        await fs.access(filePath);
        const raw = await fs.readFile(filePath, 'utf8');
        logger.info('[getReleaseInfo] lettura release.json', { filePath });
        return JSON.parse(raw);
      } catch {
        // prova il prossimo percorso
      }
    }
    logger.warning('[getReleaseInfo] release.json non trovato', { candidates });
    return {
      lastUpdate: null,
      version: 'unknown',
      microservice: 'redisWsBridge',
      note: ['release.json non trovato'],
    };
  }

  const app = express();
  app.use(express.json());
// -------------------------------------------------------
// CORS: singola origin o lista separata da virgole
// -------------------------------------------------------
const allowedOrigins = (getConfigString('CORS_ORIGIN', 'http://localhost:5173'))
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

  let logLevel = getConfigString('LOG_LEVEL', 'info')
  logger = createLogger(
      MICROSERVICE,
      MODULE_NAME,
      MODULE_VERSION,
      logLevel,
      {
          bus: null,                          // <--- FIX: non _bus
          busTopicPrefix: cfg.env || getConfigString(['ENV', 'APP_ENV'], 'DEV'),
          console: true,
          enqueueDb: true,
      }
  );
  cfg['logger']=logger;
  logger.info('[bridge] allowedOrigins', {
    raw: getConfigString('CORS_ORIGIN', '') || null,
    parsed: allowedOrigins
  });

  try {
    settingsReady = await initializeSettings(dbmanagerUrl);
    if (!settingsReady) {
      logger.warning('[bridge] settings init failed, DB unreachable', {
        dbmanagerUrl,
      });
    }
  } catch (e) {
    logger.warning('[bridge] settings init error', {
      error: e?.message || String(e),
      dbmanagerUrl,
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const hub = makeWsHub({ cfg });



  // --- RedisBus: init + connect
  const bus = new RedisBus({
    url: cfg.redisUrl,
    name: 'redis-ws-bridge',
    logger: logger,
    env: cfg.env || getConfigString(['ENV', 'APP_ENV'], 'DEV'),
    channels: {
      // opzionale: telemetria del bridge (controllata dal key "telemetry")
      telemetry: { on: true, params: { intervalsMs: 2000 } }
    },
    defaultIntervalMs: 500
  });
  await bus.connect();
  await publishEventsManifest({
    bus,
    logger,
    microserviceName: MICROSERVICE,
    serviceRootDir: __dirname,
  });
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

  // GET /release → ritorna release.json
  app.get('/release', async (_req, res) => {
    try {
      const data = await getReleaseInfo();
      return res.json(data);
    } catch (err) {
      logger.error('[GET /release] Errore:', err.message);
      return res.status(500).json({ error: 'Impossibile leggere release.json' });
    }
  });

  // GET /settings → ritorna i settings caricati
  app.get('/settings', (_req, res) => {
    try {
      if (!settingsReady) {
        return res.status(404).json({ error: 'Settings non disponibili' });
      }
      const data = getAllSettings?.() || null;
      if (!data) return res.status(404).json({ error: 'Settings non disponibili' });
      return res.json({ ok: true, data });
    } catch (err) {
      logger.error('[GET /settings] Errore:', err.message);
      return res.status(500).json({ error: 'Impossibile leggere i settings' });
    }
  });

  // PUT /settings → aggiorna un setting in cache (non persistente)
  app.put('/settings', (req, res) => {
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

    if (typeof setting !== 'string' || setting.trim() === '') {
      return res.status(400).json({ ok: false, error: "Parametro 'setting' obbligatorio" });
    }

    try {
      if (!settingsReady) {
        return res.status(404).json({ ok: false, error: 'Settings non disponibili' });
      }
      const next = setSetting(setting, value);
      return res.json({ ok: true, data: next });
    } catch (err) {
      logger.error('[PUT /settings] Errore:', err.message);
      return res.status(500).json({ ok: false, error: 'Impossibile aggiornare il setting' });
    }
  });

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
