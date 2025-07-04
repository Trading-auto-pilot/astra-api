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
  setp: async (key, value) => {
    await client.set(key, JSON.stringify(value));
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
  },
  hmset: async (key, dataObj) => {
    await client.hSet(key, dataObj); // hSet accetta oggetto key-value
  },
  hgetall: async (key) => {
    return await client.hGetAll(key); // restituisce oggetto con tutti i campi dell'hash
  },
  lPush: async (key, ...values) => {
    return await client.lPush(key, ...values);
  },
  lTrim: async (key, start, stop) => {
    return await client.lTrim(key, start, stop);
  },
  lRange: async (key, start, stop) => {
    return await client.lRange(key, start, stop);
  },
  client
};
