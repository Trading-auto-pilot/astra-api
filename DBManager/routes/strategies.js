// routes/strategies.js

const express = require('express');
const cache = require('../cache');
const router = express.Router();

module.exports = (dbManager) => {
  // 📊 GET tutte le strategie
  router.get('/', async (req, res) => {
    const cacheKey = 'strategies:all';
    let data = await cache.get(cacheKey);
    if (data) return res.json(data);
    try {
      const result = await dbManager.getActiveStrategies();
      await cache.set(cacheKey, data);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero delle strategie' });
    }
  });

  router.get('/:strategy_id', async (req, res) => {
    const cacheKey = 'strategies:all';
    const strategyId = req.params.strategy_id;

    try {
      let data = await cache.get(cacheKey);
      if (!data) {
        data = await dbManager.getActiveStrategies(); // deve restituire tutte
        await cache.set(cacheKey, data);
      }

      const result = data.find(s => s.strategy_id === strategyId);
      if (!result) return res.status(404).json({ error: 'Strategy not found' });

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero della strategia' });
    }
  });


  // ➕ POST nuova strategia
  router.post('/', async (req, res) => {
    try {
      const result = await dbManager.insertStrategy(req.body);
      await cache.del('strategies:all');
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante l\'inserimento della strategia' });
    }
  });

  // 🔄 PUT aggiorna strategia
  router.put('/', async (req, res) => {
    try {
      const result = await dbManager.updateStrategies(req.body);
      await cache.del('strategies:all');
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
