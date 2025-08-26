const { createClient } = require('redis');

function makeRedisBridge({ cfg, onMessage }) {
  const sub = createClient({ url: cfg.redisUrl });
  const state = { patterns: [], connected: false, received: 0, lastTs: null };

  async function start() {
    await sub.connect();
    state.connected = true;
    for (const p of cfg.redisPatterns) {
      await sub.pSubscribe(p, (raw, channel) => {
        state.received++; state.lastTs = Date.now();
        try {
          const msg = JSON.parse(raw);
          // normalizza: includi il canale sorgente
          msg.__channel = channel;
          onMessage(msg);
        } catch (e) {
          // messaggi non-JSON: li puoi incapsulare
          onMessage({ __channel: channel, type: 'raw', payload: raw });
        }
      });
      state.patterns.push(p);
    }
  }
  start().catch(err => console.error('[redisBridge] start error:', err));

  function getSubscriptions() {
    return {
      connected: state.connected,
      patterns: state.patterns,
      received: state.received,
      lastTs: state.lastTs
    };
  }
  return { getSubscriptions };
}

module.exports = { makeRedisBridge };
