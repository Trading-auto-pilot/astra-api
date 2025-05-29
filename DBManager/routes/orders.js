const express = require('express');
const router = express.Router();

module.exports = (dbManager) => {

  router.put('/', async (req, res) => {
    try {
      const result = await dbManager.updateOrder(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante la lettura degli ordini' });
    }
  });

  router.get('/:order_id', async (req, res) => {
    try {
      const result = await dbManager.getOrder(req.params.order_id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante la lettura degli ordini' });
    }
  });

  router.get('/getAllOrders', async (req, res) => {
    try {
      const result = await dbManager.getAllOrdersAsJson();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante la lettura degli ordini' });
    }
  });

  return router;
};
