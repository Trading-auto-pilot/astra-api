// server.js
const express = require('express');
const redis = require('redis');
const dotenv = require('dotenv');
const SLTP = require('./sltp');

dotenv.config();
const app = express();
app.use(express.json());

const port = process.env.PORT || 3011;
const sltp = new SLTP();

const commands = {
  registerBot: () => sltp.registerBot(),
  loadActiveOrders: () =>  sltp.loadActiveOrders(),
  loadSettings: () => sltp.loadSettings(),
  loadActivePosition: () => sltp.loadActivePosition()
};
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




// Avvio asincrono
(async () => {
  try {
    await sltp.init();
    console.log('[SLTP RESTServer] Listener avviato');
  } catch (err) {
    console.error('[SLTP RESTServer] Errore in fase di init:', err.message);
    process.exit(1);
  }
})();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', uptime: process.uptime() });
});

// Info
app.get('/info', (req, res) => {
  const info = sltp.getInfo();
  res.json(info);
});

// Carica ordini attivi da Alpaca 
app.post('/loadActiveOrders', async (req, res) => {
  const positions = await sltp.loadActiveOrders();
  res.json({ positions: positions });
});

// Resume
app.post('/processCandle', async (req, res) => {

    const { candle, strategyParams } = req.body;

    if (!candle || !strategyParams) {
        return res.status(400).json({ error: 'Parametri richiesti: candle, scenarioId' });
    }


    try{
        const result = await sltp.processCandle(candle, strategyParams);
        res.status(200).json(result);
    } catch (error) {
        console.error('[SLTP][processCandle][REST Server] Errore:', error.message);
        res.status(500).json({ error: 'Errore interno '+JSON.stringify(error) });
    }
});

app.listen(port, () => {
  console.log(`[SLTP RESTServer] Server REST attivo su porta ${port}`);
});
