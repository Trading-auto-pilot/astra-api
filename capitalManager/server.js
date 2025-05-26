const express = require('express');
const axios = require('axios');
const redis = require('redis');
const CapitalManager = require('./capitalManager');
const createLogger = require('../shared/logger');
require('dotenv').config();

const MODULE_NAME = 'capitalManager RESTServer';
const MODULE_VERSION = '1.0';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL || 'info');

const app = express();
const port = process.env.PORT || 3009;
app.use(express.json());

const dbManagerBaseUrl = process.env.DBMANAGER_URL || 'http://dbmanager:3002';


// Funzione per leggere i parametri di configurazione da DBManager
async function loadSettings() {
  const keys = [
    'ALPACA-'+process.env.ENV_ORDERS+'-BASE'
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


// Endpoint: health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', module: MODULE_NAME, uptime: process.uptime() });
});

// Endpoint: get module info
// Info modulo
app.get('/info', (req, res) => {
    res.json(capitalManager.getInfo());
  });
  

// Endpoint: recupera capitale disponibile da Alpaca
app.get('/getAvailableCapital', async (req, res) => {
    try {
        const account = await capitalManager.getAvailableCapital();
        console.log(account);
      
        res.json({
            cash: parseFloat(account.cash),
            buying_power: parseFloat(account.buying_power),
            portfolio_value: parseFloat(account.portfolio_value),
            currency: account.currency,
            timestamp: new Date().toISOString()
        });
        } catch (err) {
          console.error(`[${MODULE_NAME}][getAvailableCapital] Errore:`, err.message);
          res.status(500).json({ error: 'Errore nel recupero del capitale disponibile', message: err.message });
        }
});

  
// Endpoint per valutare se allocare capitale a una strategia
app.get('/evaluate/:strategyId', async (req, res) => {
  const { strategyId } = req.params;

  if (!strategyId) {
    return res.status(400).json({ error: 'Parametro strategyId richiesto' });
  }

  try {
    const result = await capitalManager.evaluateAllocation(strategyId);
    res.json(result);
  } catch (err) {
    console.error(`[capitalManager][evaluateAllocation] Errore:`, err.message);
    res.status(500).json({ error: 'Errore durante la valutazione allocazione', message: err.message });
  }
});

// Avvio server
(async () => {
    try {
        const settings = await loadSettings();
        capitalManager = new CapitalManager ({
            key:settings['APCA-API-KEY-ID'],
            secret:settings['APCA-API-SECRET-KEY'],
            env:settings['ALPACA-'+process.env.ENV_ORDERS+'-BASE']
      })

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
      
      app.listen(port, () => {
        console.log(`[capital-manager] Server avviato sulla porta ${port}`);
      });



    } catch (err) {
      console.error(`[capital-manager][startup] Errore avvio: ${err.message}`);
      process.exit(1);
    }
  })();