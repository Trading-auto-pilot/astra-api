// routes/symbols.js

// routes/symbols.js
const express = require('express');
const cache = require('../../shared/cache');

module.exports = (dbManager) => {
  const router = express.Router();

  router.get("/alpaca/assets/:symbol", async (req, res) => {
    const sym = req.params.symbol;
    const r = await fetch(`https://paper-api.alpaca.markets/v2/assets/${encodeURIComponent(sym)}`, {
      headers: {
        "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID,
        "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY
      }
    });
    if (r.status === 404) return res.status(404).json(null);
    const data = await r.json();
    res.status(r.ok ? 200 : r.status).json(data);
  });

  router.get("/poligon/assets/:symbol", async (req, res) => {
    const sym = req.params.symbol;
    const POLIGON_API = process.env.POLIGON_API;
    const r = await fetch(`https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(sym)}?apiKey=${POLIGON_API}`);
    if (r.status === 404) return res.status(404).json(null);
    const data = await r.json();
    res.status(r.ok ? 200 : r.status).json(data);
  });


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
      console.error('[GET /symbols] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero dei simboli '+ error.message, module:"[GET /symbols]" });
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
      console.error('[GET /symbols/:symbol] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero del simbolo '+ error.message, module:"[GET /symbols/:symbol]" });
    }
  });

  


  // 🔹 POST /symbols
  router.post('/', async (req, res) => {
    try {
      const result = await dbManager.insertSymbol(req.body);
      await cache.del('symbols:all');
      res.json(result);
    } catch (error) {
      console.error('[POST /symbols] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'inserimento del simbolo '+ error.message, module:"[POST /symbols]" });
    }
  });

  // 🔹 PUT /symbols
  router.put('/', async (req, res) => {
    try {
      const result = await dbManager.updateSymbol(req.body);
      await cache.del('symbols:all');
      res.json(result);
    } catch (error) {
      console.error('[PUT /symbols] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'aggiornamento del simbolo '+ error.message, module:"[PUT /symbols]" });
    }
  });

  return router;
};
