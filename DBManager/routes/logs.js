// /route/bots.js

const express = require('express');
const cache = require('../../shared/cache');
const router = express.Router();

module.exports = (dbManager) => {
  // 🔹 Recupera tutti i bot attivi
  router.get('/', async (req, res) => {
    const cacheKey = 'logs:all';
    let data = await cache.get(cacheKey);
    if (data) return res.json(data);

    try {
      const result = await dbManager.getAllLogs();
      await cache.set(cacheKey, data);
      res.json(result);
    } catch (error) {
      console.error('[GET /logs] Errore: ', err.message);
      res.status(500).json({ error: 'Errore durante la lettura dei logs '+error.message, module: "[GET /logs]" });
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
