// server.js
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');

const MarketListener = require('./modules/main');
const createLogger = require('../shared/logger');
const buildStatusRouter = require('./status'); // <-- modulo router status

dotenv.config();

const MICROSERVICE = 'marketListener';
const MODULE_NAME = 'RESTServer';
const MODULE_VERSION = '3.0';

let logLevel = process.env.LOG_LEVEL || 'info';
const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, logLevel);

const app = express();
app.use(express.json());

// CORS: singola origin o lista separata da virgole
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

const port = process.env.PORT || 3012;
let marketListener;

// init asincrono del modulo principale
(async () => {
  try {
    marketListener = new MarketListener();
    await marketListener.init();
    logger.info('[main] marketListener avviato con successo');
  } catch (err) {
    logger.error(`[main] Errore durante l'inizializzazione: ${err.message}`);
    process.exit(1);
  }
})();

// middleware: verifica che l'istanza sia pronta
function requireReady(req, res, next) {
  if (!marketListener) {
    return res.status(503).json({ 
      error: 'Service not initialized yet' 
    });
  }

  const status = marketListener.getStatus 
    ? marketListener.getStatus() 
    : null;

  if (status !== 'RUNNING') {
    return res.status(503).json({
      error: 'Service not running',
      currentStatus: status
    });
  }
  next();
}

/* -------------------------- ROUTES: OPERATIVE -------------------------- */
app.put('/connect', requireReady, async (_req, res) => {
  await marketListener.connect();
  res.json({ success: true });
});

app.delete('/connect', requireReady, async (_req, res) => {
  await marketListener.disconnect();
  res.json({ success: true });
});

app.post('/pause', requireReady, (_req, res) => {
  marketListener.pause();
  res.json({ status: 'paused' });
});

app.post('/resume', requireReady, (_req, res) => {
  marketListener.resume();
  res.json({ status: 'resumed' });
});

app.post('/init', requireReady, async (_req, res) => {
  await marketListener.init();
  res.json({ status: 'init' });
});

app.put('/orderActive/remove', requireReady, (req, res) => {
  const { symbol } = req.body;
  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ error: 'Fornire un simbolo valido' });
  }
  try {
    marketListener.updateOrderActive([symbol]);
    res.json({ success: true, removed: symbol });
  } catch (err) {
    logger.error(`Errore rimozione ordine attivo: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// loglevel runtime (PUT = operativo, resta al root)
app.put('/loglevel/:module', requireReady, (req, res) => {
  if (req.params.module === 'RESTServer') {
    logLevel = req.body.logLevel;
  } else {
    marketListener.setLogLevel(req.body.logLevel, req.params.module);
  }
  res.status(200).json({
    success: true,
    logLevel: {
      marketListener: marketListener.getLogLevel(),
      alpacaSocket: marketListener.getLogLevel('alpacaSocket'),
      RESTServer: logLevel
    }
  });
});

/* --------------------------- ROUTES: STATUS ---------------------------- */
// sola lettura sotto /status/*
app.use('/status', requireReady, buildStatusRouter({
  marketListener,
  logger,
  moduleName: MODULE_NAME
}));

/* ----------------------------- STARTUP -------------------------------- */
app.listen(port, () => {
  logger.info(`REST API attiva sulla porta ${port}`);
});
