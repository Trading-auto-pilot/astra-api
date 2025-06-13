// /route/simul.js
// Questo file contiene tutti gli endpoint usati dal simulatore OrderSimul e MarketSimul
const express = require('express');
const cache = require('../cache');

let totalReq = 0;
let cacheHit = 0;

module.exports = (dbManager) => {
  const router = express.Router();

  router.get('/stats', async (req, res) => {
    res.status(200).json({
      totalReq,
      cacheHit
    });
  });

  router.put('/stats', async (req, res) => {
    let totalReq = 0;
    let cacheHit = 0;
    res.status(200).json({
      totalReq,
      cacheHit
    });
  });

  // 📊 ACCOUNT
  router.get('/account', async (req, res) => {
    totalReq++;
    const cacheKey = 'simul_account:all';
    let data = await cache.get(cacheKey);
    if (data) {
      cacheHit++;
      return res.json(data);
    }

    try {
      const data = await dbManager.simul_getAccountAsJson();
      await cache.set(cacheKey, data);
      res.json(data);
    } catch (error) {
      console.error('[GET /simul/account] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore nel recupero dell\'account '+ error.message, module:"[GET /simul/account]" });
    }
  });

  router.put('/account', async (req, res) => {
    try {
      const data = await dbManager.simul_updateAccount(req.body);
      await cache.del('simul_account:all');
      res.json(data);
    } catch (error) {
      console.error('[PUT /simul/account] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore nell\'aggiornamento dell\'account '+ error.message, module:"[PUT /simul/account]" });
    }
  });

  // 📈 POSITIONS
  router.get('/positions', async (req, res) => {
    totalReq++;
    const cacheKey = 'simul_position:all';
    let data = await cache.get(cacheKey);
    if (data) {
      cacheHit++;
      return res.json(data);
    }
    try {
      const data = await dbManager.simul_getAllPositionsAsJson();
      await cache.set(cacheKey, data);
      res.json(data);
    } catch (error) {
      console.error('[GET /simul/positions] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero delle posizioni '+ error.message, module:"[GET /simul/positions]" });
    }
  });

  router.get('/positions/:symbol', async (req, res) => {
    totalReq++;
    const cacheKey = 'simul_position:all';
    const symbol = req.params.symbol;

    try {
      let data = await cache.get(cacheKey);
      if (!data) {
        data = await dbManager.simul_getAllPositionsAsJson();
        await cache.set(cacheKey, data);
      } else cacheHit++;

      const position = data.find(p => p.symbol === symbol);
      if (!position) return res.status(404).json({ error: 'Symbol not found' });

      res.json(position);
    } catch (error) {
      console.error('[GET /simul/positions/:symbol] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero della posizione '+ error.message, module:"[GET /simul/positions/:symbol]" });
    }
  });


  router.post('/positions', async (req, res) => {
    try {
      const data = await dbManager.simul_insertPosition(req.body);
      await cache.del('simul_position:all');
      res.json(data);
    } catch (error) {
      console.error('[POST /simul/positions] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'inserimento della posizione '+error.message, module:"[POST /simul/positions]" });
    }
  });

  router.put('/positions', async (req, res) => {
    try {
      const rc = await dbManager.simul_updatePosition(req.body);
      await cache.del('simul_position:all');
      res.json(rc.data);
    } catch (error) {
      console.error('[PUT /simul/positions] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'aggiornamento della posizione '+error.message, module:"[PUT /simul/positions]" });
    }
  });

  router.delete('/positions/:symbol', async (req, res) => {
    try {
      const data = await dbManager.simul_closePosition(req.params.symbol);
      await cache.del('simul_position:all');
      res.json(data);
    } catch (error) {
      console.error('[DELETE /simul/positions/:symbol] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante la chiusura della posizione '+ error.message, module:"[DELETE /simul/positions/:symbol]" });
    }
  });

    router.delete('/positions/all', async (req, res) => {
    try {
      const rc = await dbManager.simul_deleteAllPositions();
      await cache.del('simul_position:all');
      res.json(rc.data);
    } catch (error) {
      console.error('[DELETE /simul/positions] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'eliminazione delle posizioni '+error.message, module:"[DELETE /simul/positions]" });
    }
  });


  // 📈 ORDERS
  router.get('/orders', async (req, res) => {
    totalReq++;
    const cacheKey = 'orders:all';
    let data = await cache.get(cacheKey);
    if (data) {
      cacheHit++;
      return res.json(data);
    }

    try {
      const data = await dbManager.simul_getAllOrdersAsJson();
      await cache.set(cacheKey, data);
      res.json(data);
    } catch (error) {
      console.error('[GET /simul/orders] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero delle posizioni '+ error.message, module:"[GET /simul/orders]" });
    }
  });

  router.put('/orders', async (req, res) => {
    try {
      const data = await dbManager.simul_updateOrder(req.body);
      await cache.del('orders:all');
      res.json(data);
    } catch (error) {
      console.error('[PUT /simul/orders] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero delle posizioni '+ error.message, module:"[PUT /simul/orders]" });
    }
  });

  router.post('/orders', async (req, res) => {
    try {
      const data = await dbManager.simul_insertOrder(req.body);
      await cache.del('orders:all');
      res.json(data);
    } catch (error) {
      console.error('[POST /simul/orders] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero delle posizioni '+ error.message, module:"[POST /simul/orders]" });
    }
  });

  router.delete('/orders/all', async (req, res) => {
    try {
      const data = await dbManager.simul_deleteAllOrders(req.body);
      await cache.del('orders:all');
      res.json(data);
    } catch (error) {
      console.error('[DELETE /simul/orders] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'eliminazione degli ordini '+ error.message, module:"[DELETE /simul/orders]" });
    }
  });

  return router;
};


