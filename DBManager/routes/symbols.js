// routes/symbols.js

// routes/symbols.js
const express = require('express');

module.exports = (dbManager) => {
  const router = express.Router();

  // 🔹 GET /symbols
  router.get('/', async (req, res) => {
    try {
      const result = await dbManager.getSymbolsList();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero dei simboli' });
    }
  });

  // 🔹 GET /symbols/:symbol
  router.get('/:symbol', async (req, res) => {
    try {
      const result = await dbManager.getSymbolByName(req.params.symbol);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero del simbolo' });
    }
  });

  // 🔹 POST /symbols
  router.post('/', async (req, res) => {
    try {
      const result = await dbManager.insertSymbol(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante l\'inserimento del simbolo' });
    }
  });

  // 🔹 PUT /symbols
  router.put('/', async (req, res) => {
    try {
      const result = await dbManager.updateSymbol(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante l\'aggiornamento del simbolo' });
    }
  });

  return router;
};
