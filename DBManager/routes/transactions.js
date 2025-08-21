// routes/transactions.js
const express = require('express');
const cache = require('../../shared/cache');
const router = express.Router();

module.exports = (dbManager) => {


  router.get('/:id', async (req, res) => {
    const cacheKey = 'transactions:all';
    const id = req.params.id;

    try {
      let data = await cache.get(cacheKey);
      if (!data) {
        const data = await dbManager.getTransaction(req.params.id);
        await cache.set(cacheKey, data);
      }
      const result = data.find(s => s.id === req.params.id);
      if (!result) return res.status(404).json({ error: 'Transaction not found' });
      res.json(result);
    } catch (err) {
      console.error('[GET /transactions/:id] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore nel recupero della transazione '+ err.message, module:"[GET /transactions/:id]" });
    }
  });

  router.delete('/:id', async (req, res) => {
    const id = req.params.id;
    const redisKey = `transactions:all:all`;

    try {
      // 🔸 1. Cancella dal DB usando funzione esistente
      const dbDeleted = await dbManager.deleteTransaction(id);

      if (!dbDeleted) {
        console.log(`[DELETE /${id}] Nessuna transazione trovata nel DB`);
        return res.status(404).json({ message: `Transazione ${id} non trovata nel DB` });
      }

      // 🔸 2. Invalida la cache Redis
      await cache.del('transactions:all');
      await cache.del('transactions:open');
      

      return res.status(200).json({
        message: `Transazione ${id} eliminata`
      });

    } catch (err) {
      console.error(`[DELETE /${id}] Errore: ${err.message}`);
      return res.status(500).json({ error: 'Errore interno' });
    }
  });



  router.get('/', async (req, res) => {
    const cacheKey = 'transactions:all';

    try {
      let data = await cache.get(cacheKey);
      if (!data) {
        const data = await dbManager.getTransaction();
        await cache.set(cacheKey, data);
      }
      const result = data;
      if (!result) return res.status(404).json({ error: 'Transaction not found' });
      res.json(result);
    } catch (err) {
      console.error('[GET /transactions] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore nel recupero della transazione '+ err.message, module:"[GET /transactions]" });
    }
  });


  router.post('/', async (req, res) => {
    await cache.del('transactions:all');
    await cache.del('transactions:open');
    try {
      const result = await dbManager.insertTransazione(req.body);
      res.json(result);
    } catch (err) {
      console.error('[POST /transactions] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore nell\'inserimento della transazione '+ err.message, module:"[POST /transactions]" });
    }
  });

  router.put('/:id', async (req, res) => {
    await cache.del('transactions:all');
    await cache.del('transactions:open');
    try {
      const result = await dbManager.updateTransaction(req.params.id,req.body);
      res.json(result);
    } catch (err) {
      console.error('[PUT /transactions/:id] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore nell\'inserimento della transazione '+ err.message, module:"[PUT /transactions/:id]" });
    }
  });


  router.post('/buy', async (req, res) => {
    await cache.del('transactions:all');
    await cache.del('transactions:open');
    try {
      const result = await dbManager.insertBuyTransaction(req.body);
      res.json(result);
    } catch (err) {
      console.error('[POST /transactions/buy] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore durante aggiornamento transazione '+ err.message, module:"[POST /transactions/buy]" });
    }
  });

  router.post('/sell', async (req, res) => {
    await cache.del('transactions:all');
    await cache.del('transactions:open');
    try {
      const result = await dbManager.insertSellTransaction(req.body);
      res.json(result);
    } catch (err) {
      console.error('[POST /transactions/sell] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore nel conteggio delle transazioni '+ err.message, module:"[POST /transactions/sell]" });
    }
  });


  router.post('/countByStrategyAndOrder', async (req, res) => {
    await cache.del('transactions:all');
    await cache.del('transactions:open');
    try {
      const result = await dbManager.countTransactionsByStrategyAndOrders(req.body);
      res.json(result);
    } catch (err) {
      console.error('[POST /transactions/countByStrategyAndOrder] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore durante il recupero delle scenario id '+ err.message, module:"[POST /transactions/countByStrategyAndOrder]" });
    }
  });

  router.get('/ScenarioIdByOrderId/:order_id', async (req, res) => {
    try {
      const result = await dbManager.getScenarioIdByOrderId(req.params.order_id);
      res.json(result);
    } catch (err) {
      console.error('[GET /transactions/ScenarioIdByOrderId/:order_id] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore durante il recupero delle scenario id '+ err.message, module:"[GET /transactions/ScenarioIdByOrderId/:order_id]" });
    }
  });

  router.get('/open/:scenario_id', async (req, res) => {
    const cacheKey = 'transactions:open';
    const id = req.params.scenario_id;

    try {
      let data = await cache.get(cacheKey);
      if (!data) {
        const data = await dbManager.getOpenTransactions();
        await cache.set(cacheKey, data);
      }
      if(!data) return res.status(200).json({ open: 0 });
      const result = data.find(s => s.ScenarioID === id);
      if (!result) return res.status(200).json({ open: 0 });

      res.status(200).json({ open: 1 });
    } catch (err) {
      console.error('[GET /transactions/open/:scenario_id] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore durante il recupero delle transazioni aperte per scenario id '+ err.message, module:"[GET /transactions/open/:scenario_id]" });
    }
  });

  router.delete('/all', async (req, res) => {
    await cache.del('transactions:all');
    await cache.del('transactions:open');
    try {
      const result = await dbManager.deleteAllTransactions();
      res.json(result.data);
    } catch (err) {
      console.error('[DELETE /transactions] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore durante l\'eliminazione di tutte le transazioni '+ err.message, module:"[DELETE /transactions/all]" });
    }
  });

  return router;
};
