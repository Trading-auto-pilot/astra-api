// modules/locks.js — lock per simbolo
async function withSymbolLock({ redis, env, symbol, ttlMs = 5000 }, fn) {
const key = `${env}.lock.trade-executor.${symbol}`;
const ok = await redis.set(key, '1', { NX: true, PX: ttlMs });
if (!ok) return; // lock conteso
try { return await fn(); }
finally { await redis.del(key).catch(() => {}); }
}


module.exports = { withSymbolLock };