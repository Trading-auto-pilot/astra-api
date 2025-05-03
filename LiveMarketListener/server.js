// server.js
const express = require('express');
const dotenv = require('dotenv');
const LiveMarketListener = require('./LiveMarketListener');

dotenv.config();
const app = express();
app.use(express.json());

const port = process.env.PORT || 3001;

let marketListener;

// Avvio asincrono
(async () => {
  try {
    marketListener = new LiveMarketListener();
    await marketListener.init();
    console.log('[LiveMarketListener] Listener avviato');
  } catch (err) {
    console.error('[LiveMarketListener] Errore in fase di init:', err.message);
    process.exit(1);
  }
})();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', uptime: process.uptime() });
});

// Info
app.get('/info', (req, res) => {
  const info = marketListener.getInfo();
  res.json(info);
});

// Pausa
app.post('/pause', (req, res) => {
  marketListener.pause();
  res.json({ status: 'paused' });
});

// Resume
app.post('/resume', (req, res) => {
  marketListener.resume();
  res.json({ status: 'resumed' });
});

app.listen(port, () => {
  console.log(`[LiveMarketListener] Server REST attivo su porta ${port}`);
});
