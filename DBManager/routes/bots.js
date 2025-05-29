// /route/bots.js

const express = require('express');
const router = express.Router();

module.exports = (dbManager) => {
  // 🔹 Recupera tutti i bot attivi
  router.get('/', async (req, res) => {
    try {
      const result = await dbManager.getActiveBots();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante la lettura dei bot' });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const result = await dbManager.insertOrUpdateBotByNameVer(req.body.name, req.body.ver);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante la lettura dei bot' });
    }
  });

  return router;
};
