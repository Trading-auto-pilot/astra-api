const express = require('express');
const cache = require('../../shared/cache');
const router = express.Router();

module.exports = (dbManager) => {

  // POST /orders - Inserisce un nuovo ordine nella tabella ordini
  router.post('/', async (req, res) => {
    try {
      const result = await dbManager.insertOrder(req.body);
      await cache.del('orders:all');
      res.json(result);
    } catch (err) {
      console.error('[POST /orders] Errore:', err.message);
      res.status(500).json({ error: 'Errore durante l\'inserimento dell\'ordine '+err.message, module:"[POST /orders]"  });
    }
  });

  // PUT /orders/:id - Aggiorna un ordine esistente
  router.put('/:id', async (req, res) => {
    try {
      //const orderUpdate = { ...req.body, id: req.params.id };
      const result = await dbManager.updateOrder(req.params.id, req.body);
      await cache.del('orders:all');
      res.json(result);
    } catch (err) {
      console.error('[PUT /orders/:id] Errore: ', err.message);
      res.status(500).json({ error: 'Errore durante l\'aggiornamento dell\'ordine '+err.message, module:"[PUT /orders/:id]" });
    }
  });

  // GET /orders/:id - Recupera un ordine specifico
  router.get('/:id', async (req, res) => {
    const cacheKey = 'orders:all';
    const id = req.params.id;

    try {
      let data = await cache.get(cacheKey);
      if (!data) {
        data = await dbManager.getAllOrders(); // deve restituire tutte
        await cache.set(cacheKey, data);
      }

      const result = data.find(s => s.id === id);
      if (!result) return res.status(404).json({ error: 'Order not found' });

      res.json(result);
    } catch (error) {
      console.error('[GET /orders/:id] Errore: ', err.message);
      res.status(500).json({ error: 'Errore durante il recupero dell\'ordine '+error.message, module: "[GET /orders/:id]"});
    }
  });

  router.get('/', async (req, res) => {
    const cacheKey = 'orders:all';
    let data = await cache.get(cacheKey);
    if (data) return res.json(data);

    try {
      const result = await dbManager.getAllOrders();
      await cache.set(cacheKey, data);
      res.json(result);
    } catch (err) {
      console.error('[GET /orders] Errore: ', err.message);
      res.status(500).json({ error: 'Errore durante il recupero dell\'ordine '+err.message, module:"[GET /orders]" });
    }
  });

    router.delete('/all', async (req, res) => {
    try {
      //const orderUpdate = { ...req.body, id: req.params.id };
      const result = await dbManager.deleteAllOrdini();
      await cache.del('orders:all');
      res.json(result);
    } catch (err) {
      console.error('[DELETE /orders/all] Errore: ', err.message);
      res.status(500).json({ error: 'Errore durante l\'eliminazione di tutti i record dell\'ordine '+err.message, module:"[DELETE /orders/all]" });
    }
  });

  return router;
};
