// routes/settings.js
const express = require('express');
const cache = require('../cache');

module.exports = (dbManager) => {
  const router = express.Router();

  // 🔹 GET /settings/:key
  router.get('/:key', async (req, res) => {
    const { key } = req.params;
    const cacheKey = `settings:${key}`;
    let data = await cache.get(cacheKey);
    if (data) return res.json(data);

    try {
      const setting = await dbManager.getSettingValue(req.params.key);
      await cache.set(cacheKey, data);
      res.json(setting);
    } catch (err) {
      res.status(500).json({ error: 'Errore nel recupero della configurazione' });
    }
  });

  // 🔹 POST /settings
  router.post('/', async (req, res) => {
    try {
      const result = await dbManager.setSetting(req.body.key, req.body.value);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Errore nell\'aggiornamento della configurazione' });
    }
  });

  return router;
};
