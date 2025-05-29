// routes/symbols.js

// routes/symbols.js
const express = require('express');
const cache = require('../cache');

module.exports = (dbManager) => {
  const router = express.Router();

  // 🔹 GET /symbols
  router.get('/', async (req, res) => {
    const cacheKey = 'symbols:all';
    let data = await cache.get(cacheKey);
    if (data) return res.json(data);
    try {
      const result = await dbManager.getSymbolsList();
      await cache.set(cacheKey, data);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero dei simboli' });
    }
  });

  // 🔹 GET /symbols/:symbol
  router.get('/:symbol', async (req, res) => {
    const cacheKey = 'symbols:all';
    const symbolName = req.params.symbol;

    try {
      let data = await cache.get(cacheKey);
      if (!data) {
        data = await dbManager.getSymbolsList(); // deve restituire tutti
        await cache.set(cacheKey, data);
      }

      const result = data.find(s => s.symbol === symbolName);
      if (!result) return res.status(404).json({ error: 'Symbol not found' });

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero del simbolo' });
    }
  });


  // 🔹 POST /symbols
  router.post('/', async (req, res) => {
    try {
      const result = await dbManager.insertSymbol(req.body);
      await cache.del('symbols:all');
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante l\'inserimento del simbolo' });
    }
  });

  // 🔹 PUT /symbols
  router.put('/', async (req, res) => {
    try {
      const result = await dbManager.updateSymbol(req.body);
      await cache.del('symbols:all');
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante l\'aggiornamento del simbolo' });
    }
  });

  return router;
};
