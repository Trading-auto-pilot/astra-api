const express = require('express');
const SMA = require('./SMA');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3010;

const strategy = new SMA();

app.use(express.json());

// 🔁 Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'SMA', uptime: process.uptime() });
});

// ℹ️ Info del modulo
app.get('/info', (req, res) => {
  res.json(strategy.getSMAInfo());
});

// ⚙️ Endpoint per ricevere segnali di trading
app.post('/processCandle', async (req, res) => {
  const { candle, strategyParams } = req.body;

  if (!candle || !strategyParams) {
    return res.status(400).json({ error: 'Parametri richiesti: candle, scenarioId' });
  }

  try {

    const result = await strategy.processCandle(candle, strategyParams.id, strategyParams.symbol, strategyParams.params);
    res.json(result);
  } catch (err) {
    console.error('[SMA][processCandle][REST Server] Errore:', err.message);
    res.status(500).json({ error: 'Errore interno' });
  }
});

app.listen(port, () => {
  console.log(`[SMA] Server avviato sulla porta ${port}`);
});
