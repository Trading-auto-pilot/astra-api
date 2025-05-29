// routes/strategies.js

const express = require('express');
const router = express.Router();

module.exports = (dbManager) => {
  // 📊 GET tutte le strategie
  router.get('/', async (req, res) => {
    try {
      const result = await dbManager.getActiveStrategies();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero delle strategie' });
    }
  });

  router.get('/:strategy_id', async (req, res) => {
    try {
      const result = await dbManager.getActiveStrategies(req.params.strategy_id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero delle strategie' });
    }
  });

  // ➕ POST nuova strategia
  router.post('/', async (req, res) => {
    try {
      const result = await dbManager.insertStrategy(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante l\'inserimento della strategia' });
    }
  });

  // 🔄 PUT aggiorna strategia
  router.put('/', async (req, res) => {
    try {
      const result = await dbManager.updateStrategies(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante l\'aggiornamento della strategia' });
    }
  });


  router.get('/capitalAndOrder/:strategy_id', async (req, res) => {
    try {
      const result = await dbManager.getStrategyCapitalAndOrders(req.params.strategy_id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante l\'aggiornamento della strategia' });
    }
  });

  router.put('/capitalAndOrder', async (req, res) => {
    try {
      const result = await dbManager.updateStrategyCapitalAndOrders(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante l\'aggiornamento della strategia' });
    }
  });



  return router;
};
