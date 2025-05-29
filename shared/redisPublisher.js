const { createClient } = require('redis');

const publisher = createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' });

publisher.on('error', (err) => console.error('[Redis Publisher] ❌', err.message));

let isConnected = false;

async function connectPublisher() {
  if (!isConnected) {
    await publisher.connect();
    isConnected = true;
    console.log('[Redis Publisher] ✅ Connesso');
  }
}

async function publishCommand(message, channel = 'commands') {
  await connectPublisher();

  const payload = JSON.stringify(message);
  await publisher.publish(channel, payload);
  console.log(`[Redis Publisher] 📤 Inviato su '${channel}':`, payload);
}

module.exports = { publishCommand };
