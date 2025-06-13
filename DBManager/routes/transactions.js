// routes/transactions.js
const express = require('express');
const router = express.Router();

module.exports = (dbManager) => {
  router.get('/:orderId', async (req, res) => {
    try {
      const result = await dbManager.getTransaction(req.params.orderId);
      res.json(result);
    } catch (err) {
      console.error('[GET /transactions] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore nel recupero della transazione '+ err.message, module:"[GET /transactions]" });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const result = await dbManager.insertTransazione(req.body);
      res.json(result);
    } catch (err) {
      console.error('[POST /transactions] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore nell\'inserimento della transazione '+ err.message, module:"[POST /transactions]" });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const result = await dbManager.updateTransaction(req.params.id,req.body);
      res.json(result);
    } catch (err) {
      console.error('[PUT /transactions/:id] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore nell\'inserimento della transazione '+ err.message, module:"[PUT /transactions/:id]" });
    }
  });


  router.post('/buy', async (req, res) => {
    try {
      const result = await dbManager.insertBuyTransaction(req.body);
      res.json(result);
    } catch (err) {
      console.error('[POST /transactions/buy] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore durante aggiornamento transazione '+ err.message, module:"[POST /transactions/buy]" });
    }
  });

  router.post('/sell', async (req, res) => {
    try {
      const result = await dbManager.insertSellTransaction(req.body);
      res.json(result);
    } catch (err) {
      console.error('[POST /transactions/sell] Errore: '+ err.message);
      res.status(500).json({ error: 'Errore nel conteggio delle transazioni '+ err.message, module:"[POST /transactions/sell]" });
    }
  });


  router.post('/countByStrategyAndOrder', async (req, res) => {
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

  router.delete('/all', async (req, res) => {
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
