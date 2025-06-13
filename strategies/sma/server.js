const express = require('express');
const redis = require('redis');
const SMA = require('./SMA');
require('dotenv').config();

const REDIS_POSITIONS_KEY = 'alpaca:positions';

const app = express();
const port = process.env.PORT || 3010;

const strategy = new SMA();

app.use(express.json());

// Configurazione REDIS
// Redis Pub/Sub Integration
(async () => {
  const subscriber = redis.createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' });
  subscriber.on('error', (err) => console.error('❌ Redis error:', err));

  await subscriber.connect();
  console.log('✅ Connesso a Redis per Pub/Sub');

  // await subscriber.subscribe('commands', async (message) => {
  //   console.log(`📩 Ricevuto su 'commands':`, message);
  //   try {
  //     const parsed = JSON.parse(message);
  //     if (parsed.action === 'registerBot') {
  //       strategy.registerBot();
  //       console.log('✔️  Eseguito comando:', parsed.action);
  //     }
  //   } catch (err) {
  //     console.error('❌ Errore nel parsing o nell’esecuzione:', err.message);
  //   }
  // });

  await subscriber.subscribe(REDIS_POSITIONS_KEY, async (message) => {
    console.log(`📩 Ricevuto su ${REDIS_POSITIONS_KEY}: `, message);
    try {
      const parsed = JSON.parse(message);
        if (parsed.type === 'positions') {
          sltp.setPositions(parsed.positions);
        } else {
          sltp.getPositions();
        }
    } catch (err) {
      console.error('❌ Errore nel parsing o nell’esecuzione:', err.message);
    }
  });

})();




// Configurazione REST
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
    return res.status(400).json({ error: 'Parametri richiesti: candle, strategyParams' });
  }

  try {

    const result = await strategy.processCandle(candle, strategyParams.id, strategyParams.idSymbol, strategyParams.params);
    res.json(result);
  } catch (err) {
    console.error('[SMA][processCandle][REST Server] Errore:', err.message);
    res.status(500).json({ error: 'Errore interno' });
  }
});

app.listen(port, () => {
  console.log(`[SMA] Server avviato sulla porta ${port}`);
});
