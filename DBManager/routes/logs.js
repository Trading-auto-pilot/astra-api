// /route/bots.js

const express = require('express');
const cache = require('../../shared/cache');
const router = express.Router();

module.exports = (dbManager) => {
// GET /logs?limit=123
router.get('/', async (req, res) => {
  // 1) valida/parsa limit
  const n = Number(req.query.limit);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1000) : 100;

  const cacheKey = `logs:all:limit:${limit}`;

  try {
    // 2) prova cache
    let cached = await cache.get(cacheKey);
    if (cached) {
      try { cached = typeof cached === 'string' ? JSON.parse(cached) : cached; } catch {}
      return res.json(cached);
    }

    // 3) DB
    const result = await dbManager.getAllLogs(limit);

    // 4) metti in cache (puoi aggiungere TTL se supportato)
    try { await cache.set(cacheKey, JSON.stringify(result)); } catch {}

    return res.json(result);
  } catch (error) {
    console.error('[GET /logs] Errore: ', error);
    return res
      .status(500)
      .json({ error: 'Errore durante la lettura dei logs ' + (error?.message || String(error)), module: '[GET /logs]' });
  }
});


  router.post('/', async (req, res) => {
    try {
      const result = await dbManager.insertLogs(req.body);
      await cache.del('logs:all');
      res.json(result);
    } catch (error) {
      console.error('[POST /logs] Errore: ', error.message);
      res.status(500).json({ error: 'Errore durante la scrittura dei logs '+error.message, module:"[POST /logs]" });
    }
  });

  return router;
};
