const express = require('express');
const redis = require('redis');
const http = require('http');
const OrderSimulator = require('./orderSimulator');
const createLogger = require('../shared/logger');

const app = express();
app.use(express.json());
const MODULE_NAME = 'OrderSimulator RESTServer';
const MODULE_VERSION = '1.0';

const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL);

const server = http.createServer(app);
const simulator = new OrderSimulator();
simulator.attachWebSocketServer(server);

// Endpoint per inizializzare la simulazione
app.post('/start', async (req, res) => {
  try {
    await simulator.startSimulation();
    res.status(200).json({ message: 'Simulazione avviata' });
  } catch (err) {
    logger.error('Errore in /start', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint per fermare la simulazione
app.post('/stop', (req, res) => {
  simulator.stopSimulation();
  res.status(200).json({ message: 'Simulazione interrotta' });
});

// Endpoint per inviare un payload custom via WebSocket
app.post('/send', (req, res) => {
  try {
    const payload = req.body;
    simulator.sendPayloadToClients(payload);
    res.status(200).json({ message: 'Payload inviato' });
  } catch (err) {
    logger.error('Errore in /send', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/v2/orders', async (req, res) => {
  try {
    const result = await simulator.getOrders();
    res.status(200).json(result.data);
  } catch (err) {
    logger.error(`[orders] ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

app.post('/v2/orders', async (req, res) => {
  try {
    const result = await simulator.acceptOrder(req.body);
    res.status(200).json(result);
  } catch (err) {
    logger.error(`[orders] ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

app.get('/v2/account', async (req, res) => {
  try {
    const result = await simulator.getAccount();
    res.status(200).json(result);
  } catch (err) {
    logger.error(`[orders] ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

app.get('/v2/positions', async (req, res) => {
  try {
    const result = await simulator.getPositions();
    res.status(200).json(result);
  } catch (err) {
    logger.error(`[orders] ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

// Endpoint di healthcheck
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    module: 'OrderSimulator',
    uptime: process.uptime()
  });
});

// Avvio server
const PORT = process.env.PORT || 3004;
server.listen(PORT, async () => {
  await simulator.loadSettings();
  // Mi connetto al websocket delle candele per sincronizzare orologio locale.
  simulator.connectToMarketWebSocketForClock();
  logger.info(`Server OrderSimulator avviato sulla porta ${PORT}`);
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
        await simulator.loadSettings();
        console.log('✔️  Eseguito comando:', parsed.action);
      }
    } catch (err) {
      console.error('❌ Errore nel parsing o nell’esecuzione:', err.message);
    }
  });
})();