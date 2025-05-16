// strategy-utils/server.js

const express = require('express');
const StrategyUtils = require('./strategyUtils');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3007;
const strategyUtils = new StrategyUtils();

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'strategyUtils',
    uptime: process.uptime()
  });
});

// Info
app.get('/info', (req, res) => {
  res.json(strategyUtils.getInfo());
});

// Calcolo annualized profit
app.post('/getAnnualizedProfit', (req, res) => {
  const { startDate, endDate, profit } = req.body;
  if (!startDate || !endDate || profit === undefined) {
    return res.status(400).json({ error: 'Parametri richiesti: startDate, endDate, profit' });
  }

  try {
    const result = strategyUtils.getAnnualizedProfit(startDate, endDate, profit);
    res.json({ annualizedProfit: result });
  } catch (err) {
    console.error(`[getAnnualizedProfit] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Calcolo media mobile
app.post('/calcMediaMobile', async (req, res) => {

  try {
    const media = await strategyUtils.calcMediaMobile(req.body);
    res.status(200).json({ movingAverage: media });
  } catch (err) {
    console.error(`[calcMediaMobile] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
    console.log(`[strategyUtils] Server avviato sulla porta ${port}`);
});  
