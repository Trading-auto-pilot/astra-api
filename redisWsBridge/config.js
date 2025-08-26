require('dotenv').config();
function parseList(s) { return (s||'').split(',').map(x=>x.trim()).filter(Boolean); }

function loadConfig() {
  const env = process.env.ENV || 'DEV';
  return {
    env,
    port: Number(process.env.PORT || 3030),
    corsOrigins: (origin, cb) => {
      const list = parseList(process.env.CORS_ORIGIN || 'http://localhost:5173');
      if (!origin || list.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379/0',
    // pattern da ascoltare (solo INGRESSO)
    redisPatterns: parseList(process.env.REDIS_PATTERNS || `*`),
  };
}
module.exports = { loadConfig };
