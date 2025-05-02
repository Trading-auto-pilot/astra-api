// strategies/sma/server.js

const express = require('express');
const processCandle = require('./processCandle');
const CacheManager = require('../../shared/cacheManager');
require('dotenv').config({ path: '../../.env' });

const app = express();
const port = process.env.SMA_PORT || 3001;

app.use(express.json());

// Stato locale della strategia
const state = {
  capitaleLibero: parseFloat(process.env.CAPITALE) || 10000,
  capitaleInvestito: 0,
  comprato: 0,
  lastOp: null,
  daysFree: 0,
  daysInvested: 0,
  minDay: 9999999,
  maxDay: 0,
  numOp: 0
};

const cacheManager = new CacheManager('../../cache');

// Endpoint di HealthCheck
app.get('/health', (req, res) => {
    res.json({ status: 'ok', strategy: 'SMA', uptime: process.uptime() });
});

// Endpoint per ricevere le candele
app.post('/processCandle', async (req, res) => {
  try {
    const { candle, strategyParams } = req.body;

    if (!candle || !strategyParams) {
      return res.status(400).json({ error: 'Missing candle or strategyParams' });
    }

    const result = await processCandle(candle, state, strategyParams, cacheManager);
    res.json(result);

  } catch (error) {
    console.error('[SMA Server] Errore nel processing:', error);
    res.status(500).json({ error: error.message });
  }
});

// Avvio server
app.listen(port, () => {
  console.log(`[SMA Server] In ascolto sulla porta ${port}`);
});
