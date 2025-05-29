// server.js
const express = require('express');
const dotenv = require('dotenv');
const redis = require('redis');
const LiveMarketListener = require('./LiveMarketListener');

dotenv.config();
const app = express();
app.use(express.json());

const port = process.env.PORT || 3012;
let marketListener;

const commands = {
  getActiveBots: () => marketListener.getActiveBots(),
  loadActiveStrategies: () =>  marketListener.loadActiveOrders(),
  loadSettings: () => marketListener.loadSettings()
};


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

  // Avvio e sottoscrizione REDIS
  const subscriber = redis.createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' });
  subscriber.on('error', (err) => console.error('❌ Redis error:', err));

  await subscriber.connect();
  console.log('✅ Connesso a Redis per Pub/Sub');

  await subscriber.subscribe('commands', async (message) => {
    console.log(`📩 Ricevuto su 'commands':`, message);
    try {
      const parsed = JSON.parse(message);
        if (typeof commands[parsed.action] === 'function') {
          await commands[parsed.action]();
          console.log('✔️  Elaborazione completata', parsed.action);
        } else {
          console.error('❌ Comando non valido o mancante:', parsed.action);
        }
    } catch (err) {
      console.error('❌ Errore nel parsing o nell’esecuzione:', err.message);
    }
  });


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

app.post('/addOrdertoOrderTable', (req, res) => {
  marketListener.addOrdertoOrderTable(req.body);
  res.json({ status: 'resumed' });
});

app.put('/orderActive/remove', (req, res) => {
  const { symbol } = req.body;

  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ error: 'Fornire un simbolo valido' });
  }

  try {
    marketListener.updateOrderActive([symbol]); // lo convertiamo internamente in array
    res.json({ success: true, removed: symbol });
  } catch (err) {
    console.error('[PUT /orderActive/remove]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});




app.listen(port, () => {
  console.log(`[LiveMarketListener] Server REST attivo su porta ${port}`);
});

// 👇 Aggiungi questo blocco
process.on('SIGTERM', () => {
  logger.info('[server] Terminazione ricevuta. Chiusura server...');
  server.close(() => {
    logger.info('[server] Server chiuso correttamente.');
    process.exit(0);
  });
});