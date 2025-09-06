// main.js — entrypoint
const express = require('express');
const { createClient } = require('redis');
const { RedisBus } = require('../shared/redisBus'); // riusa il tuo wrapper
const createLogger = require('../shared/logger');


const buildServerRouter = require('./server');
const buildStatusRouter = require('./status');


const { initState } = require('./modules/state');
const { handleCandleFactory } = require('./modules/executor');


// ---- CONFIG ----
const ENV = process.env.ENV || 'DEV';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const PORT = Number(process.env.PORT || 7010);
const CANDLE_PATTERN = process.env.CANDLE_PATTERN || `${ENV}.marketListener.candle*`;


const MICROSERVICE = 'trade-executor';
const MODULE = 'main';
const VERSION = '1.0';
const logger = createLogger(MICROSERVICE, MODULE, VERSION, process.env.LOG_LEVEL || 'info');


(async () => {
// Redis base + Bus
const redis = createClient({ url: REDIS_URL });
await redis.connect();


const bus = new RedisBus({ url: REDIS_URL, name: 'trade-executor-bus', json: true, channels: {} });
await bus.connect();


// Stato condiviso
const state = initState({ env: ENV, logger });


// Core handler con dipendenze iniettate
const handleCandle = handleCandleFactory({ redis, state, logger });


// Subscribe candele via Redis (pattern)
await bus.psubscribe(CANDLE_PATTERN, async (parsed, _raw, channel) => {
const items = Array.isArray(parsed) ? parsed : [parsed];
for (const c of items) await handleCandle(c);
});


// HTTP server
const app = express();
app.use(express.json({ limit: '1mb' }));


app.use('/', buildServerRouter({ redis, bus, state, handleCandle, logger }));
app.use('/status', buildStatusRouter({ redis, bus, state, logger }));


app.listen(PORT, () => logger.info(`[bootstrap] ${MICROSERVICE} up on :${PORT}`));
})();