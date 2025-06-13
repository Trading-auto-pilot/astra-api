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
      console.error('[GET /settings/:key] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore nel recupero della configurazione '+err.message, module:"[GET /settings/:key]" });
    }
  });

  router.get('/', async (req, res) => {
    const cacheKey = `settings:all`;
    let data = await cache.get(cacheKey);
    if (data) return res.json(data);

    try {
      const setting = await dbManager.getAllSetting();
      await cache.set(cacheKey, data);
      res.json(setting);
    } catch (err) {
      console.error('[GET /settings] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore nel recupero della configurazione '+err.message, module:"[GET /settings]" });
    }
  });

  // 🔹 POST /settings
  router.post('/', async (req, res) => {
    try {
      const result = await dbManager.setSetting(req.body.key, req.body.value);
       await cache.del('settings:all');
      res.json(result);
    } catch (err) {
      console.error('[POST /settings] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore nell\'aggiornamento della configurazione '+err.message, module:"[POST /settings]" });
    }
  });

  return router;
};
