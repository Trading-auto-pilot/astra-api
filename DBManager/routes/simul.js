// /route/simul.js
// Questo file contiene tutti gli endpoint usati dal simulatore OrderSimul e MarketSimul
const express = require('express');
const cache = require('../../shared/cache');
const createLogger = require('../../shared/logger');

const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'RESTServer simul';
const MODULE_VERSION = '2.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

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
    try {
      const data = await dbManager.simul_getAccountAsJson();
      res.json(data);
    } catch (error) {
      logger.error('[GET /simul/account] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore nel recupero dell\'account '+ error.message, module:"[GET /simul/account]" });
    }
  });

  router.put('/account', async (req, res) => {
    try {
      const data = await dbManager.simul_updateAccount(req.body);
      res.json(data);
    } catch (error) {
      logger.error('[PUT /simul/account] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore nell\'aggiornamento dell\'account '+ error.message, module:"[PUT /simul/account]" });
    }
  });

  router.post('/account', async (req, res) => {
    try {
      const data = await dbManager.syncAccountFromAlpaca(req.body);
      res.json(data);
    } catch (error) {
      logger.error('[POST /simul/account] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore nel sync dell\'account '+ error.message, module:"[POST /simul/account]" });
    }
  });

  router.delete('/account', async (req, res) => {
    try {
      const data = await dbManager.deleteAccountCache();
      res.json(data);
    } catch (error) {
      logger.error('[DELETE /simul/account] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore nella cancellazione dell\'account '+ error.message, module:"[DELETE /simul/account]" });
    }
  });

  // 📈 POSITIONS

  router.post('/positions/start', async (req, res) => {
    try {
      const rc = await dbManager.startSyncRedisToMySQL();
      res.json(rc);
    } catch (error) {
      logger.error('[POST /simul/positions/start] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore avvio sincronizzazione '+error.message, module:"[POST /simul/positions/start]" });
    }
  });

  router.post('/positions/stop', async (req, res) => {
    try {
      const rc = await dbManager.stopSyncRedisToMySQL();
      res.json(rc);
    } catch (error) {
      logger.error('[POST /simul/positions/stop] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore interruzione sincronizzazione '+error.message, module:"[POST /simul/positions/stop]" });
    }
  });

  router.post('/positions/once', async (req, res) => {
    try {
      const rc = await dbManager.syncRedisToMySQLOnce();
      res.json(rc);
    } catch (error) {
      logger.error('[POST /simul/positions/once] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore sincronizzazione '+error.message, module:"[POST /simul/positions/once]" });
    }
  });


  router.get('/positions', async (req, res) => {
    try {
      const data = await dbManager.simul_getAllPositionsAsJson();
      res.json(data);
    } catch (error) {
      logger.error('[GET /simul/positions] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero delle posizioni '+ error.message, module:"[GET /simul/positions]" });
    }
  });

  router.get('/positions/:symbol', async (req, res) => {
    const symbol = req.params.symbol;

    try {
      data = await dbManager.simul_getAllPositionsAsJson();
      const position = data.find(p => p.symbol === symbol);
      if (!position) return res.status(404).json({ error: 'Symbol not found' });

      res.json(position);
    } catch (error) {
      logger.error('[GET /simul/positions/:symbol] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero della posizione '+ error.message, module:"[GET /simul/positions/:symbol]" });
    }
  });


  router.post('/positions', async (req, res) => {
    try {
      const data = await dbManager.simul_insertPosition(req.body);
      res.json(data);
    } catch (error) {
      logger.error('[POST /simul/positions] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'inserimento della posizione '+error.message, module:"[POST /simul/positions]" });
    }
  });

  router.put('/positions', async (req, res) => {
    try {
      const rc = await dbManager.simul_updatePosition(req.body);
      res.json(rc);
    } catch (error) {
      logger.error('[PUT /simul/positions] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'aggiornamento della posizione '+error.message, module:"[PUT /simul/positions]" });
    }
  });

  router.delete('/positions/:symbol', async (req, res) => {
    try {
      const data = await dbManager.simul_closePosition(req.params.symbol);
      res.json(data);
    } catch (error) {
      logger.error('[DELETE /simul/positions/:symbol] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante la chiusura della posizione '+ error.message, module:"[DELETE /simul/positions/:symbol]" });
    }
  });

    router.delete('/positions', async (req, res) => {
    try {
      const rc = await dbManager.simul_deleteAllPositions();
      res.json(rc);
    } catch (error) {
      logger.error('[DELETE /simul/positions] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'eliminazione delle posizioni '+error.message, module:"[DELETE /simul/positions]" });
    }
  });


  // 📈 ORDERS
    router.get('/orders/openBySymbol/:symbol', async (req, res) => {
    try {
      const data = await dbManager.getOpenOrdersBySymbol(req.params.symbol);
      res.json({count : data});
    } catch (error) {
      logger.error('[GET /orders/openBySymbol/:symbol] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero degli ordini aperti'+ error.message, module:"[GET /orders/openBySymbol/:symbol]" });
    }
  });

  router.post('/orders/start', async (req, res) => {
    try {
      const data = await dbManager.startSyncOrders();
      res.json(data);
    } catch (error) {
      logger.error('[POST /simul/orders/start] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore avvio sincronizzazione con DB '+ error.message, module:"[POST /simul/orders/start]" });
    }
  });

  router.post('/orders/stop', async (req, res) => {
    try {
      const data = await dbManager.stopSyncOrders();
      res.json(data);
    } catch (error) {
      logger.error('[POST /simul/orders/stop] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore interruzione sincronizzazione con DB '+ error.message, module:"[POST /simul/orders/stop]" });
    }
  });

  router.post('/orders/once', async (req, res) => {
    try {
      const data = await dbManager.syncOrdersOnce();
      res.json(data);
    } catch (error) {
      logger.error('[POST /simul/orders/once] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore  sincronizzazione con DB '+ error.message, module:"[POST /simul/orders/once]" });
    }
  });

  router.get('/orders', async (req, res) => {
    try {
      const data = await dbManager.simul_getAllOrdersAsJson();
      res.json(data);
    } catch (error) {
      logger.error('[GET /simul/orders] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero delle posizioni '+ error.message, module:"[GET /simul/orders]" });
    }
  });

  router.put('/orders', async (req, res) => {
    try {
      const data = await dbManager.simul_updateOrder(req.body);
      res.json(data);
    } catch (error) {
      logger.error('[PUT /simul/orders] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero delle posizioni '+ error.message, module:"[PUT /simul/orders]" });
    }
  });

  router.post('/orders', async (req, res) => {
    try {
      const data = await dbManager.simul_insertOrder(req.body);
      res.json(data);
    } catch (error) {
      logger.error('[POST /simul/orders] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero delle posizioni '+ error.message, module:"[POST /simul/orders]" });
    }
  });

  router.delete('/orders/:orderId', async (req, res) => {
    try {
      const data = await dbManager.simul_deleteOrderById(req.params.orderId);
      res.json(data);
    } catch (error) {
      logger.error('[DELETE /simul/orders/:orderId] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'eliminazione degli ordini '+ error.message, module:"[DELETE /simul/orders/:orderId]" });
    }
  });

  router.delete('/orders', async (req, res) => {
    try {
      const data = await dbManager.simul_deleteAllOrders();
      res.json(data);
    } catch (error) {
      logger.error('[DELETE /simul/orders] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante l\'eliminazione degli ordini '+ error.message, module:"[DELETE /simul/orders]" });
    }
  });

  return router;
};


