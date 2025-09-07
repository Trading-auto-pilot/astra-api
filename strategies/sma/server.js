const express = require('express');
const redis = require('redis');
const cors = require('cors');
const SMA = require('./SMA');
const PARAMS = require('./params.json');
require('dotenv').config();

const REDIS_POSITIONS_KEY = 'alpaca:positions';

const app = express();

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

const port = process.env.PORT || 3010;

const strategy = new SMA();

app.use(express.json());

// Configurazione REDIS
// Redis Pub/Sub Integration
(async () => {
  const subscriber = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  subscriber.on('error', (err) => console.error('❌ Redis error:', err));

  await subscriber.connect();
  console.log('✅ Connesso a Redis per Pub/Sub');


  await subscriber.subscribe(REDIS_POSITIONS_KEY, async (message) => {
    console.log(`📩 Ricevuto su ${REDIS_POSITIONS_KEY}: `, message);
    try {
      const parsed = JSON.parse(message);
        if (parsed.type === 'positions') {
          sltp.setPositions(parsed.positions);
        } else {
          sltp.getPositions();
        }
    } catch (err) {
      console.error('❌ Errore nel parsing o nell’esecuzione:', err.message);
    }
  });

})();




// Configurazione REST
    // 🔁 Healthcheck
    app.get('/health', (req, res) => {
      res.json({ status: 'OK', service: 'SMA', uptime: process.uptime() });
    });

    // ℹ️ Info del modulo
    app.get('/info', (req, res) => {
      res.json(strategy.getSMAInfo());
    });

    // ℹ️ Info del modulo
    app.get('/params', (req, res) => {
      res.json(PARAMS);
    });

    app.get('/loglevel', (req, res) => {
      res.json({SMA:strategy.getLogLevel()});
    });

    app.put('/loglevel/:module', (req, res) => {

      const moduleMap = {
        SMA:strategy
      };

      const targetModule = moduleMap[req.params.module];

      if (!targetModule || typeof targetModule.setLogLevel !== 'function') {
        return res.status(400).json({ success: false, error: `Modulo ${req.params.module} non esistente` });
      }

      targetModule.setLogLevel(req.body.logLevel);
      res.status(200).json({ success: true, logLevel: {SMA : strategy.getLogLevel()}});
    });


// ⚙️ Endpoint per ricevere segnali di trading
app.post('/processCandle', async (req, res) => {
  const { candle, strategyParams } = req.body;

  if (!candle || !strategyParams) {
    return res.status(400).json({ error: 'Parametri richiesti: candle, strategyParams' });
  }

  try {

    const result = await strategy.processCandle(candle, strategyParams.id, strategyParams.idSymbol, strategyParams.params);
    res.json(result);
  } catch (err) {
    console.error('[SMA][processCandle][REST Server] Errore:', err.message);
    res.status(500).json({ error: 'Errore interno' });
  }
});

app.listen(port, () => {
  console.log(`[SMA] Server avviato sulla porta ${port}`);
});
