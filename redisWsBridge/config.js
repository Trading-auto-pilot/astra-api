require('dotenv').config();
const { getConfigString, getConfigInt } = require('../shared/loadSettings');
function parseList(s) { return (s||'').split(',').map(x=>x.trim()).filter(Boolean); }

function loadConfig() {
  const env = getConfigString(['ENV', 'APP_ENV'], 'DEV');
  return {
    env,
    port: getConfigInt('PORT', 3030),
    corsOrigins: (origin, cb) => {
      const list = parseList(getConfigString('CORS_ORIGIN', 'http://localhost:5173'));
      if (!origin || list.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    redisUrl: getConfigString('REDIS_URL', 'redis://localhost:6379/0'),
    // pattern da ascoltare (solo INGRESSO)
    redisPatterns: parseList(getConfigString('REDIS_PATTERNS', '*')),
  };
}
module.exports = { loadConfig };
