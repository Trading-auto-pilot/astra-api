// routes/strategies.js

const express = require('express');
const router = express.Router();

module.exports = (dbManager) => {

  // Capital cache (tutti e uno specifico)
  router.get('/logLevel', async (req, res) => {
    const result = {success:true, logLevel:dbManager.getLogLevel() }
    res.json(result);
  });

  router.put('/logLevel/:value', async (req, res) => {
    dbManager.setLogLevel(req.params.value);
    const result = {success:true, logLevel:dbManager.getLogLevel() }
    res.json(result);
  });

  router.get('/flushDBSec', async (req, res) => {
    const result = {success:true, value:dbManager.getFlushDBSec()}
    res.json(result);
  });

  router.put('/flushDBSec/:value', async (req, res) => {
    dbManager.setFlushDBSec(req.params.value);
    const result = {success:true, value:Number(dbManager.getFlushDBSec())}
    res.json(result);
  });


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
  // router.get('/capitalAndOrder/:strategy_id(\\d+)', async (req, res) => {
  //   try {
  //     const result = await dbManager.getStrategyCapitalAndOrders(req.params.strategy_id);
  //     res.json(result);
  //   } catch (error) {
  //     console.error('[GET /strategies/capitalAndOrder/:strategy_id] Errore: '+ error.message);
  //     res.status(500).json({ error: 'Errore durante l\'aggiornamento della strategia '+ error.message, module:"[GET /strategies/capitalAndOrder/:strategy_id]" });
  //   }
  // });

  // router.put('/capitalAndOrder', async (req, res) => {
  //   try {
  //     const result = await dbManager.updateStrategyCapitalAndOrders(req.body);
  //     res.json(result);
  //   } catch (error) {
  //     console.error('[PUT /strategies/capitalAndOrder] Errore: '+ error.message);
  //     res.status(500).json({ error: 'Errore durante l\'aggiornamento della strategia '+ error.message, module:"[PUT /strategies/capitalAndOrder]" });
  //   }
  // });

  // Runs (storico esecuzioni strategia)
  router.get('/runs/strategy', async (req, res) => {

    try {
      data = await dbManager.getStrategiesRun(); // deve restituire tutte

      res.json(data);
    } catch (error) {
      console.error('[GET /strategies/strategy_runs] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero della strategy_run '+ error.message, module:"[GET /strategies/strategy_runs]" });
    }
  });

  router.get('/runs/strategy/:strategy_runs_id', async (req, res) => {
    const strategy_runs_id = req.params.strategy_runs_id;

    try {
      data = await dbManager.getStrategiesRun(); // deve restituire tutte

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
    try {
      const result = await dbManager.getActiveStrategies(req.params.symbol);
      res.json(result);
    } catch (error) {
      console.error('[GET /strategies] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero delle strategie '+ error.message, module:"[GET /strategies]" });
    }
  });

  // Strategy base (all, one, insert, update)
  router.get('/', async (req, res) => {
    try {
      const result = await dbManager.getActiveStrategies();
      res.json(result);
    } catch (error) {
      console.error('[GET /strategies] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero delle strategie '+ error.message, module:"[GET /strategies]" });
    }
  });

  router.delete('/', async (req, res) => {
    await dbManager.resetStrategiesCache();
    res.json({success:true});
  });

  router.get('/:strategy_id(\\d+)', async (req, res) => {
    try {
      data = await dbManager.getActiveStrategies(); // deve restituire tutte
    } catch (error) {
      console.error('[GET /strategies/:strategy_id] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero della strategia '+ error.message, module:"[GET /strategies/:strategy_id]" });
    }  

    const result = data.find(s => Number(s.id) === Number(req.params.strategy_id));
    if (!result) return res.status(404).json({ error: 'Strategy not found' });

    res.json(result);
  });


  // ➕ POST nuova strategia
  router.post('/', async (req, res) => {
    try {
      const result = await dbManager.insertStrategy(req.body);
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
      res.json(result);
    } catch (error) {
      console.error('[PUT /strategies/:strategy_id] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'aggiornamento della strategia '+ error.message, module:"[PUT /strategies/:strategy_id]" });
    }
  });

  router.put('/singlefield/:strategy_id(\\d+)', async (req, res) => {
    try {
      const result = await dbManager.updateSingleStrategyField(req.params.strategy_id, req.body.key, req.body.value);
      res.json(result);
    } catch (error) {
      console.error('[PUT /strategies/:strategy_id] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'aggiornamento della strategia '+ error.message, module:"[PUT /strategies/:strategy_id]" });
    }
  });

  return router;
};
