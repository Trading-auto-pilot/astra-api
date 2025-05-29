// /route/simul.js
// Questo file contiene tutti gli endpoint usati dal simulatore OrderSimul e MarketSimul
const express = require('express');
const cache = require('../cache');

module.exports = (dbManager) => {
  const router = express.Router();

  // 📊 ACCOUNT
  router.get('/account', async (req, res) => {
    const cacheKey = 'simul_account:all';
    let data = await cache.get(cacheKey);
    if (data) return res.json(data);

    try {
      const data = await dbManager.getAccountAsJson();
      await cache.set(cacheKey, data);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore nel recupero dell\'account' });
    }
  });

  router.put('/account', async (req, res) => {
    try {
      const data = await dbManager.updateAccount(req.body);
      await cache.del('simul_account:all');
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore nell\'aggiornamento dell\'account' });
    }
  });

  // 📈 POSITIONS
  router.get('/positions', async (req, res) => {
    const cacheKey = 'simul_position:all';
    let data = await cache.get(cacheKey);
    if (data) return res.json(data);
    try {
      const data = await dbManager.getAllPositionsAsJson();
      await cache.set(cacheKey, data);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero delle posizioni' });
    }
  });

  router.get('/positions/:symbol', async (req, res) => {
    const cacheKey = 'simul_position:all';
    const symbol = req.params.symbol;

    try {
      let data = await cache.get(cacheKey);
      if (!data) {
        data = await dbManager.getAllPositionsAsJson();
        await cache.set(cacheKey, data);
      }

      const position = data.find(p => p.symbol === symbol);
      if (!position) return res.status(404).json({ error: 'Symbol not found' });

      res.json(position);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero della posizione' });
    }
  });


  router.post('/positions', async (req, res) => {
    try {
      const data = await dbManager.insertPosition(req.body);
      await cache.del('simul_position:all');
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante l\'inserimento della posizione' });
    }
  });

  router.put('/positions', async (req, res) => {
    try {
      const data = await dbManager.updatePosition(req.body);
      await cache.del('simul_position:all');
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante l\'aggiornamento della posizione' });
    }
  });

  router.delete('/positions/:symbol', async (req, res) => {
    try {
      const data = await dbManager.closePosition(req.params.symbol);
      await cache.del('simul_position:all');
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante la chiusura della posizione' });
    }
  });


  // 📈 ORDERS
  router.get('/orders', async (req, res) => {
    const cacheKey = 'orders:all';
    let data = await cache.get(cacheKey);
    if (data) return res.json(data);

    try {
      const data = await dbManager.getAllOrdersAsJson();
      await cache.set(cacheKey, data);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero delle posizioni' });
    }
  });

  router.put('/orders', async (req, res) => {
    try {
      const data = await dbManager.updateSimulOrder(req.body);
      await cache.del('orders:all');
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero delle posizioni' });
    }
  });

  router.post('/orders', async (req, res) => {
    try {
      const data = await dbManager.insertSimulatedOrder(req.body);
      await cache.del('orders:all');
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante il recupero delle posizioni' });
    }
  });

  return router;
};


