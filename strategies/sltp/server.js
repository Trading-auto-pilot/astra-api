// server.js
const express = require('express');
const redis = require('redis');
const cors = require('cors');
const dotenv = require('dotenv');
const SLTP = require('./sltp');
const PARAMS = require('./params.json');

const REDIS_POSITIONS_KEY = 'alpaca:positions';

dotenv.config();
const app = express();

app.use(cors({
  origin: 'http://localhost:5173', // indirizzo frontend
  credentials: true // se usi cookie o auth
}));

app.use(express.json());

const port = process.env.PORT || 3011;
const sltp = new SLTP();


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




// Avvio asincrono
(async () => {
  try {
    await sltp.init();
    console.log('[SLTP RESTServer] Listener avviato');
  } catch (err) {
    console.error('[SLTP RESTServer] Errore in fase di init:', err.message);
    process.exit(1);
  }
})();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', uptime: process.uptime() });
});

// Info
app.get('/info', (req, res) => {
  const info = sltp.getInfo();
  res.json(info);
});

    app.get('/params', (req, res) => {
      res.json(PARAMS);
    });

    app.get('/loglevel', (req, res) => {
      res.json({SLTP:sltp.getLogLevel()});
    });

    app.put('/loglevel/:module', (req, res) => {

      const moduleMap = {
        SLTP:sltp
      };

      const targetModule = moduleMap[req.params.module];

      if (!targetModule || typeof targetModule.setLogLevel !== 'function') {
        return res.status(400).json({ success: false, error: `Modulo ${req.params.module} non esistente` });
      }

      targetModule.setLogLevel(req.body.logLevel);
      res.status(200).json({ success: true, logLevel: {SLTP : sltp.getLogLevel()}});
    });


// Carica ordini attivi da Alpaca 
app.post('/loadActiveOrders', async (req, res) => {
  const positions = await sltp.loadActiveOrders();
  res.json({ positions: positions });
});

// Resume
app.post('/processCandle', async (req, res) => {

    const { candle, strategyParams } = req.body;

    if (!candle || !strategyParams) {
        return res.status(400).json({ error: 'Parametri richiesti: candle, scenarioId' });
    }


    try{
        const result = await sltp.processCandle(candle, strategyParams);
        res.status(200).json(result);
    } catch (error) {
        console.error('[SLTP][processCandle][REST Server] Errore:', error.message);
        res.status(500).json({ error: 'Errore interno '+JSON.stringify(error) });
    }
});

app.listen(port, () => {
  console.log(`[SLTP RESTServer] Server REST attivo su porta ${port}`);
});

process.on('SIGINT', () => {
  console.log('[server] Terminazione SIGINT ricevuta (CTRL+C). Chiusura server...');
  server.close(() => {
    console.log('[server] Server chiuso correttamente.');
    process.exit(0);
  });
});