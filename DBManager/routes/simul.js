// /route/simul.js
// Questo file contiene tutti gli endpoint usati dal simulatore OrderSimul e MarketSimul
const express = require('express');

module.exports = (dbManager) => {
  const router = express.Router();

  // 📊 ACCOUNT
  router.get('/account', async (req, res) => {
    try {
      const data = await dbManager.getAccountAsJson();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore nel recupero dell\'account' });
    }
  });

  router.put('/account', async (req, res) => {
    try {
      const data = await dbManager.updateAccount(req.body);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore nell\'aggiornamento dell\'account' });
    }
  });

  // 📈 POSITIONS
  router.get('/positions', async (req, res) => {
    try {
      const data = await dbManager.getAllPositionsAsJson();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero delle posizioni' });
    }
  });

  router.get('/positions/:symbol', async (req, res) => {
    try {
      const data = await dbManager.getPositionBySymbol(req.params.symbol);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero della posizione' });
    }
  });

  router.post('/positions', async (req, res) => {
    try {
      const data = await dbManager.insertPosition(req.body);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante l\'inserimento della posizione' });
    }
  });

  router.put('/positions', async (req, res) => {
    try {
      const data = await dbManager.updatePosition(req.body);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante l\'aggiornamento della posizione' });
    }
  });

  router.delete('/positions/:symbol', async (req, res) => {
    try {
      const data = await dbManager.closePosition(req.params.symbol);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante la chiusura della posizione' });
    }
  });


  // 📈 ORDERS
  router.get('/orders', async (req, res) => {
    try {
      const data = await dbManager.getAllOrdersAsJson();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero delle posizioni' });
    }
  });

  router.put('/orders', async (req, res) => {
    try {
      const data = await dbManager.updateSimulOrder(req.body);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero delle posizioni' });
    }
  });

  router.post('/orders', async (req, res) => {
    try {
      const data = await dbManager.insertSimulatedOrder(req.body);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero delle posizioni' });
    }
  });

  return router;
};


