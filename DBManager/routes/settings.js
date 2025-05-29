// routes/settings.js
const express = require('express');

module.exports = (dbManager) => {
  const router = express.Router();

  // 🔹 GET /settings/:key
  router.get('/:key', async (req, res) => {
    try {
      const setting = await dbManager.getSettingValue(req.params.key);
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
