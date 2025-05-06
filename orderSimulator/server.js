const express = require('express');
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
    simulator.sendPayload(payload);
    res.status(200).json({ message: 'Payload inviato' });
  } catch (err) {
    logger.error('Errore in /send', err.message);
    res.status(500).json({ error: err.message });
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
server.listen(PORT, () => {
  simulator.loadSettings();
  logger.info(`Server OrderSimulator avviato sulla porta ${PORT}`);
});
