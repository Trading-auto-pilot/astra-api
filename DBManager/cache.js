// utils/cache.js
const redis = require('redis');
const client = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });

const DEFAULT_TTL = 300; // 5 minuti

client.on('error', err => console.error('Redis Client Error', err));

(async () => await client.connect())();

module.exports = {
  get: async (key) => {
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  },
  set: async (key, value, ttl = DEFAULT_TTL) => {
    await client.set(key, JSON.stringify(value), { EX: ttl }); // TTL in secondi
  },
  del: async (key) => {
    await client.del(key);
  },
  expire: async (key, ttl) => {
    await client.expire(key, ttl);
  },
  keys: async (pattern = '*') => {
    return await client.keys(pattern);
  },
  getRaw: async (key) => {
    return await client.get(key); // stringa JSON grezza
  }
};
