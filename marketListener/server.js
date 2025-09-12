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

  let status = marketListener.status;
  if (status !== 'LISTENING') {
    return res.status(200).json({
      error: 'Service not running',
      status: status
    });
  }
  next();
}
  

/* -------------------------- ROUTES: OPERATIVE -------------------------- */
app.put('/connect', async (_req, res) => {
  try {
    const status = await marketListener.connect(); // supponendo che ritorni lo stato aggiornato

    if (status === 'LISTENING') {
      return res.json({ success: true, status });
    } else {
      return res.json({ success: false, status });
    }
  } catch (err) {
    logger.error(`[PUT /connect] Errore durante connessione: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Errore durante la connessione' });
  }
});


app.delete('/connect', requireReady, async (_req, res) => {
  try {
    const status = await marketListener.disconnect();

    if (status === 'DISCONNECTED' || status === 'NOT CONNECTED') {
      return res.json({ success: true, status });
    } else {
      return res.json({ success: false, status });
    }
  } catch (err) {
    // logghiamo l'errore se usi un logger
    logger.error(`[DELETE /connect] Errore durante disconnessione: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Errore durante la disconnessione' });
  }
});


  // (opzionale) GET singola strategia
  app.get("/dbLogger", async (req, res) => {
    try {
      const data = await marketListener.getDbLogStatus();
      res.json({ ok: true, data });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

    // PUT /dbLogger/:status
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
        const data = await marketListener.setDbLogStatus(enable); // <-- passa boolean
        if (data == null) {
        return res.status(404).json({ ok: false, error: "not found" });
        }
        return res.json({ ok: true, status: enable ? "on" : "off", data });
    } catch (e) {
        console.error("[dbLogger] set status error:", e);
        return res
        .status(500)
        .json({ ok: false, error: e?.message || String(e) });
    }
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
