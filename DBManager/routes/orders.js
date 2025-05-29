const express = require('express');
const cache = require('../cache');
const router = express.Router();

module.exports = (dbManager) => {

  router.put('/', async (req, res) => {
    try {
      const result = await dbManager.updateOrder(req.body);
      await cache.del('orders:all');
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante la lettura degli ordini' });
    }
  });

  router.get('/:order_id', async (req, res) => {
    const { order_id } = req.params;
    const cacheKey = `orders:${id}`;
    let data = await cache.get(cacheKey);
    if (data) return res.json(data);

    try {
      const result = await dbManager.getOrder(req.params.order_id);
      await cache.set(cacheKey, data);

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante la lettura degli ordini' });
    }
  });

  // Se cambio id specifico invalido la cache con await cache.del(`orders:${id}`);

  router.get('/getAllOrders', async (req, res) => {
    const cacheKey = 'orders:all';
    let data = await cache.get(cacheKey);
    if (data) return res.json(data);

    try {
      const result = await dbManager.getAllOrdersAsJson();
      await cache.set(cacheKey, data);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante la lettura degli ordini' });
    }
  });

  return router;
};
