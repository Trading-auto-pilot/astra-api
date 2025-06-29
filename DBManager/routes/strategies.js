// routes/strategies.js

const express = require('express');
const cache = require('../../shared/cache');
const router = express.Router();

module.exports = (dbManager) => {


   // Capital cache (tutti e uno specifico)
  router.get('/capital', async (req, res) => {

    try {
      const result = await dbManager.getStrategiesCapital();
      if (!result) return res.status(404).json({ error: 'Error retriving Capital' });
      res.json(result);
    } catch (error) {
      console.error('[GET /strategies/capital] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero della cache capitale '+ error.message, module:"[GET /strategies/capital]" });
    }
  });

     // Capital cache (tutti e uno specifico)
  router.put('/capital', async (req, res) => {

    try {
      const result = await dbManager.setStrategiesCapital(req.body);
      if (!result) return res.status(404).json({ error: 'Error retriving Capital' });
      res.json(result);
    } catch (error) {
      console.error('[PUT /capital] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l aggiornamento del DB con valori cache '+ error.message, module:"[PUT /capital]" });
    }
  });

  // Capital + Orders per strategy
  router.get('/capitalAndOrder/:strategy_id(\\d+)', async (req, res) => {
    try {
      const result = await dbManager.getStrategyCapitalAndOrders(req.params.strategy_id);
      res.json(result);
    } catch (error) {
      console.error('[GET /strategies/capitalAndOrder/:strategy_id] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'aggiornamento della strategia '+ error.message, module:"[GET /strategies/capitalAndOrder/:strategy_id]" });
    }
  });

  router.put('/capitalAndOrder', async (req, res) => {
    try {
      const result = await dbManager.updateStrategyCapitalAndOrders(req.body);
      res.json(result);
    } catch (error) {
      console.error('[PUT /strategies/capitalAndOrder] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'aggiornamento della strategia '+ error.message, module:"[PUT /strategies/capitalAndOrder]" });
    }
  });

  // Runs (storico esecuzioni strategia)
  router.get('/runs/strategy', async (req, res) => {
    const cacheKey = 'strategy_runs:all';

    try {
      let data = await cache.get(cacheKey);
      if (!data) {
        data = await dbManager.getStrategiesRun(); // deve restituire tutte
        await cache.set(cacheKey, data);
      }

      res.json(data);
    } catch (error) {
      console.error('[GET /strategies/strategy_runs] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero della strategy_run '+ error.message, module:"[GET /strategies/strategy_runs]" });
    }
  });

  router.get('/runs/strategy/:strategy_runs_id', async (req, res) => {
    const cacheKey = 'strategy_runs:all';
    const strategy_runs_id = req.params.strategy_runs_id;

    try {
      let data = await cache.get(cacheKey);
      if (!data) {
        data = await dbManager.getStrategiesRun(); // deve restituire tutte
        await cache.set(cacheKey, data);
      }

      const result = data.find(s => s.strategy_runs_id === strategy_runs_id);
      if (!result) return res.status(404).json({ error: 'Strategy_run not found' });

      res.json(result);
    } catch (error) {
      console.error('[GET /strategies/strategy_runs/:strategy_runs_id] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero della strategy_run '+ error.message, module:"[GET /strategies/strategy_runs/:strategy_runs_id]" });
    }
  });

  router.post('/runs/strategy', async (req, res) => {
    try {
      const result = await dbManager.insertStrategyRun(req.body);
      await cache.del('strategy_runs:all');
      res.json(result);
    } catch (error) {
      console.error('[POST /strategies/strategy_runs] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'inserimento della strategy_runs '+ error.message, module:"[POST /strategies/strategy_runs]" });
    }
  });

  router.put('/runs/strategy/:strategy_runs_id', async (req, res) => {
    const strategy_runs_id = req.params.strategy_runs_id;

    try {
      const result = await dbManager.updateStrategyRun(strategy_runs_id, req.body);
      res.json(result);
    } catch (error) {
      console.error('[PUT /strategies/strategy_runs/:strategy_runs_id] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'aggiornamento della strategy_runs '+ error.message, module:"[PUT/strategies/strategy_runs/:strategy_runs_id]" });
    }
  });

  // Ricerca per symbol
  router.get('/symbol/:symbol', async (req, res) => {
    const cacheKey = 'strategies:all';
    let data = await cache.get(cacheKey);
    if (data) return res.json(data);
    try {
      const result = await dbManager.getActiveStrategies(req.params.symbol);
      await cache.set(cacheKey, data);
      res.json(result);
    } catch (error) {
      console.error('[GET /strategies] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero delle strategie '+ error.message, module:"[GET /strategies]" });
    }
  });

  // Strategy base (all, one, insert, update)
  router.get('/', async (req, res) => {
    const cacheKey = 'strategies:all';
    let data = await cache.get(cacheKey);
    if (data) return res.json(data);
    try {
      const result = await dbManager.getActiveStrategies();
      await cache.set(cacheKey, data);
      res.json(result);
    } catch (error) {
      console.error('[GET /strategies] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero delle strategie '+ error.message, module:"[GET /strategies]" });
    }
  });

  router.get('/:strategy_id(\\d+)', async (req, res) => {
    const cacheKey = 'strategies:all';
    const strategyId = req.params.strategy_id;
    let data = await cache.get(cacheKey);
    if (!data) //return res.json(data);
    {

      try {
        data = await dbManager.getActiveStrategies(); // deve restituire tutte
        await cache.set(cacheKey, data);

      } catch (error) {
        console.error('[GET /strategies/:strategy_id] Errore: '+ error.message);
        res.status(500).json({ error: 'Errore durante il recupero della strategia '+ error.message, module:"[GET /strategies/:strategy_id]" });
      }  
    }

    const result = data.find(s => Number(s.id) === Number(strategyId));
    if (!result) return res.status(404).json({ error: 'Strategy not found' });

    res.json(result);
  });


  // ➕ POST nuova strategia
  router.post('/', async (req, res) => {
    try {
      const result = await dbManager.insertStrategy(req.body);
      await cache.del('strategies:all');
      res.json(result);
    } catch (error) {
      console.error('[POST /strategies] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'inserimento della strategia '+ error.message, module:"[POST /strategies]" });
    }
  });

  // 🔄 PUT aggiorna strategia
  router.put('/:strategy_id(\\d+)', async (req, res) => {
    try {
      const result = await dbManager.updateStrategies(req.params.strategy_id, req.body);
      await cache.del('strategies:all');
      res.json(result);
    } catch (error) {
      console.error('[PUT /strategies/:strategy_id] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'aggiornamento della strategia '+ error.message, module:"[PUT /strategies/:strategy_id]" });
    }
  });

  return router;
};
