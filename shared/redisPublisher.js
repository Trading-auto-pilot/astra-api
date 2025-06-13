const { createClient } = require('redis');
const createLogger = require('./logger');

const MICROSERVICE = 'Shared';
const MODULE_NAME = 'redisPublisher';
const MODULE_VERSION = '1.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');


const publisher = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });

publisher.on('error', (err) => logger.error('[Redis Publisher] ❌', err.message));

let isConnected = false;

async function connectPublisher() {
  if (!isConnected) {
    await publisher.connect();
    isConnected = true;
    logger.info('[Redis Publisher] ✅ Connesso');
  }
}

async function publishCommand(message, channel = 'commands') {
  await connectPublisher();

  const payload = JSON.stringify(message);
  await publisher.publish(channel, payload);
  logger.log(`[Redis Publisher] 📤 Inviato su '${channel}':`, payload);
}

module.exports = { publishCommand };
