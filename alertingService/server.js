// server.js
const express = require('express');
const redis = require('redis');
const AlertingService = require('./alertingService');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3008;

app.use(express.json());

const alerting = new AlertingService();


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
        alerting.loadSettings();
        console.log('✔️  Eseguito comando:', parsed.action);
      }
    } catch (err) {
      console.error('❌ Errore nel parsing o nell’esecuzione:', err.message);
    }
  });
})();




// Endpoint salute
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'alerting-service', uptime: process.uptime() });
});

// Info modulo
app.get('/info', (req, res) => {
  res.json(alerting.getInfo());
});

// Info Mode backTest
app.get('/backTestMode', (req, res) => {
  res.status(200).json({status:alerting.getBackTestMode()});
});

app.put('/backTestMode', async (req, res) => {
  const { status } = req.body;
  if (!req.body.hasOwnProperty('status')) {
    return res.status(400).json({ error: 'Parametri richiesti: status' });
  }
  alerting.setBackTestMode(status)
  res.status(200).json({status:alerting.getBackTestMode()});
});

// Invio email
app.post('/email/send', async (req, res) => {
  const { to, subject, body } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Parametri richiesti: to, subject, body' });
  }

  try {
    const result = await alerting.sendEmail(req.body);
    res.json({ status: 'inviato', result: JSON.stringify(result) });
  } catch (err) {
    res.status(500).json({ error: 'Errore invio email', message: err.message });
  }
});

// Avvio server
(async () => {
  try {
    await alerting.loadSettings();
    app.listen(port, () => {
      console.log(`[alerting-service] Server avviato sulla porta ${port}`);
    });
  } catch (err) {
    console.error(`[alerting-service][startup] Errore avvio: ${err.message}`);
    process.exit(1);
  }
})();
