const express = require('express');
const http = require('http');
const redis = require('redis');
const dotenv = require('dotenv');
const MarketSimulator = require('./marketSimulator');
const createLogger = require('../shared/logger');

dotenv.config();

const MODULE_NAME = 'MarketSimulator RESTServer';
const MODULE_VERSION='1.2';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL || 'log');

const app = express();
app.use(express.json());

const port = process.env.PORT || 3003;
const simulator = new MarketSimulator();
const server = http.createServer(app);

// WebSocket binding
simulator.attachWebSocketServer(server);

// Endpoint: Avvia la simulazione
app.post('/start', async (req, res) => {
  const { symbol, startDate, endDate, tf } = req.body;
  if ( !startDate || !endDate) {
    return res.status(400).json({ error: 'startDate e endDate sono richiesti' });
  }

  try {
    await simulator.startSimulation(startDate, endDate, tf);
    res.json({ status: 'Simulazione avviata' });
  } catch (err) {
    logger.error(`[start] Errore: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Ferma la simulazione
app.post('/stop', (req, res) => {
  simulator.stopSimulation();
  res.json({ status: 'Simulazione fermata' });
});

app.post('/send', (req, res) => {
  const payload = req.body;

  if (!payload) {
    return res.status(400).json({ error: 'Payload mancante' });
  }

  simulator.broadcastMessage(payload);
  res.status(200).json({ status: 'inviato', payload });
});


// Endpoint: Info modulo
app.get('/info', (req, res) => {
  res.json(simulator.getInfo());
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
  subscriber.on('error', (err) => console.error('❌ Redis error:', err));

  await subscriber.connect();
  console.log('✅ Connesso a Redis per Pub/Sub');

  await subscriber.subscribe('commands', async (message) => {
    console.log(`📩 Ricevuto su 'commands':`, message);
    try {
      const parsed = JSON.parse(message);
      if (parsed.action === 'loadSettings') {
        simulator.loadSettings();
        console.log('✔️  Eseguito comando:', parsed.action);
      }
    } catch (err) { 
      console.error('❌ Errore nel parsing o nell’esecuzione:', err.message);
    }
  });
})();