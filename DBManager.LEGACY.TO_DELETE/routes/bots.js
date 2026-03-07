// /route/bots.js

const express = require('express');
const cache = require('../../shared/cache');
const router = express.Router();

module.exports = (dbManager) => {
  // 🔹 Recupera tutti i bot attivi
  router.get('/', async (req, res) => {
    const cacheKey = 'bots:all';
    let data = await cache.get(cacheKey);
    if (data) return res.json(data);

    try {
      const result = await dbManager.getActiveBots();
      await cache.set(cacheKey, data);
      res.json(result);
    } catch (error) {
      console.error('[GET /bots] Errore:', err.message);
      res.status(500).json({ error: 'Errore durante la lettura dei bot', module:'[GET /bots]' });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const result = await dbManager.insertOrUpdateBotByNameVer(req.body.name, req.body.ver);
      await cache.del('bots:all');
      res.json(result);
    } catch (error) {
      console.error('[POST /bots] Errore:', err.message);
      res.status(500).json({ error: 'Errore durante la registrazione dei bot', module:'[POST /bots]' });
    }
  });

  return router;
};
