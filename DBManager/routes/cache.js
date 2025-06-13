// routes/cache.js
const express = require('express');
const router = express.Router();
const cache = require('../cache');

module.exports = () => {
    //Reset del tempo cache
  router.post('/ttl', async (req, res) => {
    const { key, ttl } = req.body;
    if (!key || !ttl) return res.status(400).json({ error: 'key e ttl richiesti' });

    try {
      await cache.expire(key, parseInt(ttl));
      res.json({ success: true, key, ttl });
    } catch (err) {
      console.error('[POST /cache/ttl] Errore: ', err.message);
      res.status(500).json({ error: err.message, module : '[POST /cache/ttl]' });
    }
  });

  // 🔁 Forza invalidazione cache
  router.post('/invalidate', async (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Parametro key richiesto' });

    try {
      await cache.del(key);
      res.json({ success: true, invalidated: key });
    } catch (err) {
      console.error('[POST /cache/invalidate] Errore: ', err.message);
      res.status(500).json({ error: err.message, module: '[POST /cache/invalidate]' });
    }
  });

  router.get('/', async (req, res) => {
    const { pattern = '*' } = req.query;
    try {
      const keys = await cache.keys(pattern);
      const preview = await Promise.all(
        keys.map(async key => {
          const value = await cache.getRaw(key);
          return {
            key,
            length: value?.length || 0,
            preview: value?.substring(0, 100)
          };
        })
      );
      res.json({ keys: preview });
    } catch (err) {
      console.error('[GET /cache] Errore: ', err.message);
      res.status(500).json({ error: err.message, module:'[GET /cache]' });
    }
  });

  return router;
};
