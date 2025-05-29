// routes/transactions.js
const express = require('express');
const router = express.Router();

module.exports = (dbManager) => {
  router.get('/:orderId', async (req, res) => {
    try {
      const result = await dbManager.getTransaction(req.params.orderId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Errore nel recupero della transazione' });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const result = await dbManager.insertTransazione(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Errore nell\'inserimento della transazione' });
    }
  });

  router.put('/', async (req, res) => {
    try {
      const result = await dbManager.updateTransaction(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Errore nell\'inserimento della transazione' });
    }
  });

  router.post('/buy', async (req, res) => {
    try {
      const result = await dbManager.insertBuyTransaction(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Errore durante aggiornamento transazione' });
    }
  });

  router.post('/sell', async (req, res) => {
    try {
      const result = await dbManager.insertSellTransaction(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Errore nel conteggio delle transazioni' });
    }
  });

  // router.get('/countByStrategyAndOrder/:strategy_id', async (req, res) => {
  //   try {
  //     const result = await dbManager.getStrategyCapitalAndOrders(req.params.strategy_id, req.body.orderIds);
  //     res.json(result);
  //   } catch (err) {
  //     res.status(500).json({ error: 'Errore durante il recupero delle strategie' });
  //   }
  // });

  router.post('/countByStrategyAndOrder', async (req, res) => {
    try {
      const result = await dbManager.countTransactionsByStrategyAndOrders(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Errore durante il recupero delle scenario id' });
    }
  });

  router.get('/ScenarioIdByOrderId/:order_id', async (req, res) => {
    try {
      const result = await dbManager.getScenarioIdByOrderId(req.params.order_id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Errore durante il recupero delle scenario id' });
    }
  });

  return router;
};
