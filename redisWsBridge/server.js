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
  app.use(cors({ origin: cfg.corsOrigins, credentials: true }));

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

  // bind WS
  wss.on('connection', (socket, req) => hub.addClient(socket, req));

  server.listen(cfg.port, () => {
    console.log(`[bridge] listening on :${cfg.port}`);
  });
})();
