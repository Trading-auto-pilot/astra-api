// server.js
const express = require('express');
const AlertingService = require('./alertingService');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3008;

app.use(express.json());

const alerting = new AlertingService();

// Endpoint salute
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'alerting-service', uptime: process.uptime() });
});

// Info modulo
app.get('/info', (req, res) => {
  res.json(alerting.getInfo());
});

// Invio email
app.post('/email/send', async (req, res) => {
  const { to, subject, body } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Parametri richiesti: to, subject, body' });
  }

  try {
    const result = await alerting.sendEmail({ to, subject, body });
    res.json({ status: 'inviato', id: result.messageId });
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
