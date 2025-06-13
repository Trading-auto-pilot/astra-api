const express = require('express');
const cache = require('../cache');
const router = express.Router();

module.exports = (dbManager) => {

  // POST /orders - Inserisce un nuovo ordine nella tabella ordini
  router.post('/', async (req, res) => {
    try {
      const result = await dbManager.insertPositions(req.body);
      await cache.del('positions:all');
      res.json(result);
    } catch (err) {
      console.error('[POST /positions] Errore: ', err.message);
      res.status(500).json({ error: 'Errore durante l\'inserimento dell\'ordine '+err.message, module:"[POST /positions]" });
    }
  });

  // PUT /orders/:id - Aggiorna un ordine esistente
  router.put('/:id', async (req, res) => {
    try {
      //const orderUpdate = { ...req.body, id: req.params.id };
      const result = await dbManager.updatePosition(req.params.id, req.body);
      await cache.del('positions:all');
      res.json(result);
    } catch (err) {
      console.error('[PUT /positions/:id] Errore:', err.message);
      res.status(500).json({ error: 'Errore durante l\'aggiornamento dell\'ordine '+err.message, module:"[PUT /positions/:id]" });
    }
  });

  // GET /orders/:id - Recupera un ordine specifico
  router.get('/:id', async (req, res) => {
    const cacheKey = 'positions:all';
    const id = req.params.id;

    try {
      let data = await cache.get(cacheKey);
      if (!data) {
        data = await dbManager.getAllPositions(); // deve restituire tutte
        await cache.set(cacheKey, data);
      }

      const result = data.find(s => s.id === id);
      if (!result) return res.status(404).json({ error: 'Order not found' });

      res.json(result);
    } catch (error) {
      console.error('[GET /positions/:id] Errore:', error.message);
      res.status(500).json({ error: 'Errore durante il recupero dell\'ordine '+error.message, module:"[GET /positions/:id] " });
    }
  });

  router.get('/', async (req, res) => {
    const cacheKey = 'positions:all';
    let data = await cache.get(cacheKey);
    if (data) return res.json(data);

    try {
      const result = await dbManager.getAllPositions();
      await cache.set(cacheKey, data);
      res.json(result);
    } catch (err) {
      console.error('[GET /positions] Errore:', err.message);
      res.status(500).json({ error: 'Errore durante il recupero dell\'ordine '+err.message, module:"[GET /positions]" });
    }
  });

  router.delete('/all', async (req, res) => {
    try {
      //const orderUpdate = { ...req.body, id: req.params.id };
      const result = await dbManager.deleteAllPosizioni();
      await cache.del('positions:all');
      res.json(result);
    } catch (err) {
      console.error('[DELETE /positions/all] Errore:', err.message);
      res.status(500).json({ error: 'Errore durante l\'eliminazione dei record della tabella posizioni '+err.message, module:"[DELETE /positions/all]" });
    }
  });

  return router;
};
