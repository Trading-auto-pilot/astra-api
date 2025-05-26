const express = require('express');
const axios = require('axios');
const redis = require('redis');
const CacheManager = require('./cacheManager');
const createLogger = require('../shared/logger');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3006;
const MODULE_NAME = 'CacheManager RESTServer';
const MODULE_VERSION = '1.0';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL || 'info');


const dbManagerBaseUrl = process.env.DBMANAGER_URL || 'http://dbmanager:3002'; // URL del microservizio DBManager
let cacheManager = null;

// Configurazione REDIS
// Redis Pub/Sub Integration
(async () => {
  const settings = await loadSettings();
        cacheManager = new CacheManager({
        cacheBasePath: './cache',
        tf: settings['TF-DEFAULT'],
        feed: settings['ALPACA-HISTORICAL-FEED'],
        apiKey: process.env.APCA_API_KEY_ID,
        apiSecret: process.env.APCA_API_SECRET_KEY,
        restUrl: settings['ALPACA-LIVE-BASE'],
        timeout: settings['ALPACA-API-TIMEOUT']
      });

      const subscriber = redis.createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' });
      subscriber.on('error', (err) => console.error('❌ Redis error:', err));

      await subscriber.connect();
      console.log('✅ Connesso a Redis per Pub/Sub');

      await subscriber.subscribe('commands', async (message) => {
        console.log(`📩 Ricevuto su 'commands':`, message);
        try {
          const parsed = JSON.parse(message);
          if (parsed.action === 'loadSettings') {
            await loadSettings();
            console.log('✔️  Eseguito comando:', parsed.action);
          }
        } catch (err) {
          console.error('❌ Errore nel parsing o nell’esecuzione:', err.message);
        }
      });

      // Avvio del server REST
      try {
        app.listen(port, () => {
          console.log(`[cacheManager] Server avviato sulla porta ${port}`);
        });
      } catch (err) {
        console.error('[STARTUP] Errore nell\'inizializzazione del servizio:', err.message);
        console.log(err);
        process.exit(1);
      }
    
})();

// Funzione per leggere i parametri di configurazione da DBManager
async function loadSettings() {
  const keys = [
    'ALPACA-LIVE-MARKET',
    'ALPACA-HISTORICAL-FEED',
    'TF-DEFAULT',
    'ALPACA-API-TIMEOUT'
  ];

  const settings = {};
  for (const key of keys) {
    try {
      const res = await axios.get(`${dbManagerBaseUrl}/getSetting/${key}`);
      settings[key] = res.data.value;
      logger.trace(`[loadSetting] Setting variavile ${key} : ${settings[key]}`);
    } catch (err) {
        console.error(`[SETTINGS] Errore nel recupero della chiave '${key}': ${err.message}`);
      throw err;
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    logger.trace(`Environment variable ${key}=${value}`);
  }
  return settings;
}

// Endpoint REST per il test del servizio
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'cacheManager' , uptime: process.uptime()});
});

// Endpoint informazioni sul modulo
app.get('/info', (req, res) => {
    res.status(200).json(cacheManager.getInfo());
});

// Endpoint per ottenere candele dal simbolo e range
app.get('/candles', async (req, res) => {
  const { symbol, startDate, endDate } = req.query;

  if (!symbol || !startDate || !endDate) {
    return res.status(400).json({ error: 'Parametri richiesti: symbol, startDate, endDate' });
  }

  try {
    const candles = await cacheManager.retrieveCandles(symbol, startDate, endDate);
    res.json(candles);
  } catch (err) {
    console.error(`[CACHE] Errore nel recupero candele: ${err.message}`);
    res.status(500).json({ error: 'Errore nel recupero delle candele' });
  }
});

