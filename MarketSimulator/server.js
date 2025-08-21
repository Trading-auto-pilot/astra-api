const express = require('express');
const http = require('http');
const redis = require('redis');
const dotenv = require('dotenv');
const cors = require('cors');
const MarketSimulator = require('./marketSimulator');
const createLogger = require('../shared/logger');

dotenv.config();

const MICROSERVICE = 'MarketSimulator';
const MODULE_NAME = 'MarketSimulator RESTServer';
const MODULE_VERSION='1.2';
const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

const app = express();

app.use(cors({
  origin: 'http://localhost:5173', // indirizzo frontend
  credentials: true // se usi cookie o auth
}));
app.use(express.json());

const port = process.env.PORT || 3003;
const marketSimulator = new MarketSimulator();
const server = http.createServer(app);

// WebSocket binding
marketSimulator.attachWebSocketServer(server);

app.get('/candle', async (req, res) => {
  const { symbol, startDate, endDate } = req.query;
  

  if (!symbol || !startDate || !endDate) {
    console.log("Qui manca qualcosa!");
    return res.status(400).json({
      success: false,
      message: 'Missing required query parameters: symbol, startDate, endDate',
    });
  }

  try {
    const candle = await marketSimulator.getCandles(req.query);
    res.json({ success: true, candle });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// Endpoint: Avvia la simulazione
app.post('/start', async (req, res) => {
  const { startDate, endDate, tf, stopCandles } = req.body;
  if ( !startDate || !endDate) {
    return res.status(400).json({ error: 'startDate e endDate sono richiesti' });
  }

  try {
    await marketSimulator.startSimulation(startDate, endDate, tf, stopCandles);
    res.json({ status: 'Simulazione avviata' });
  } catch (err) {
    logger.error(`[start] Errore: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Ferma la simulazione
app.post('/stop', (req, res) => {
  marketSimulator.stopSimulation();
  res.json({ status: 'Simulazione fermata' });
});

app.post('/pause', (req, res) => {
  marketSimulator.pauseSimulation();
  res.json({ status: 'Simulazione fermata' });
});

app.post('/reset', (req, res) => {
  marketSimulator.resetSimulation();
  res.json({ status: 'Reset eseguito' });
});

app.post('/restart', (req, res) => {
  const { startDate, endDate, tf, stopCandles } = req.body;

  lastDate = marketSimulator.restartSimulation(startDate, endDate, tf, stopCandles);
  res.json({ status: 'Simulazione Riavviata da data '+lastDate });
});

app.post('/send', (req, res) => {
  const payload = req.body;

  if (!payload) {
    return res.status(400).json({ error: 'Payload mancante' });
  }

  marketSimulator.broadcastMessage(payload);
  res.status(200).json({ status: 'inviato', payload });
});

app.get('/loglevel', (req, res) => {
  res.json({ 
    marketSimulator : marketSimulator.getLogLevel()
  });
});

app.put('/loglevel/:module', (req, res) => {

  const moduleMap = {
    marketSimulator
  };

  const targetModule = moduleMap[req.params.module];

  if (!targetModule || typeof targetModule.setLogLevel !== 'function') {
    return res.status(400).json({ success: false, error: `Modulo ${req.params.module} non esistente` });
  }

  targetModule.setLogLevel(req.body.logLevel);
  res.status(200).json({ success: true, logLevel : {marketSimulator : marketSimulator.getLogLevel()} });
});


  app.get('/params', (req, res) => {
    res.json(marketSimulator.getParams());
  });

  app.delete('/connect/:clientId', (req, res) => {
    res.json(marketSimulator.disconnect(req.params.clientId));
  });

  // Endpoint: Info modulo
  app.get('/info', (req, res) => {
    res.json(marketSimulator.getInfo());
  });

// Endpoint: Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'OK', module: MODULE_NAME, uptime: process.uptime() });
});

// Avvia il server
server.listen(port, () => {
  logger.info(`[server] Server avviato sulla porta ${port}`);
});

// Configurazione REDIS
// Redis Pub/Sub Integration
(async () => {
  const subscriber = redis.createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' });
  subscriber.on('error', (err) => logger.error('❌ Redis error:', err));

  await subscriber.connect();
  logger.info('✅ Connesso a Redis per Pub/Sub');

  await subscriber.subscribe('commands', async (message) => {
    logger.log(`📩 Ricevuto su 'commands':`, message);
    try {
      const parsed = JSON.parse(message);
      if (parsed.action === 'loadSettings') {
        marketSimulator.loadSettings();
        logger.log('✔️  Eseguito comando:', parsed.action);
      }
    } catch (err) { 
      logger.error('❌ Errore nel parsing o nell’esecuzione:', err.message);
    }
  });
})();