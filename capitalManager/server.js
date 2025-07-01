const express = require('express');
const CapitalManager = require('./capitalManager');
const allocCapital = require('./allocCapital');
const createLogger = require('../shared/logger');
require('dotenv').config();

const MICROSERVICE = "CapitalManager";
const MODULE_NAME = 'RESTServer';
const MODULE_VERSION = '2.0';
const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');
let capitalManager;
const app = express();
const port = process.env.PORT || 3009;
app.use(express.json());

const dbManagerBaseUrl = process.env.DBMANAGER_URL || 'http://dbmanager:3002';

  // Init capitale e cache
  app.put('/initCapitalManager', async (req, res) => {

    try {
      const result = await allocCapital.initCapitalManager();
      if (!result) return res.status(404).json({ error: 'initCapitalManager error' });
      res.json(result);
    } catch (error) {
      console.error('[GET /initCapitalManager] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante inizzializzazione di initCapitalManager '+ error.message, module:"[GET /initCapitalManager]" });
    }
  });

   // Capital cache (tutti e uno specifico)
  app.get('/capital', async (req, res) => {

    try {
      const result = await allocCapital.getCapital();
      if (!result) return res.status(404).json({ error: 'Error retriving Capital' });
      res.json(result);
    } catch (error) {
      console.error('[GET /capital] Errore: '+ error.message);
      res.status(500).json({ error: 'Errore durante il recupero della cache capitale '+ error.message, module:"[GET /capital]" });
    }
  });

  app.put('/capital/calcolaAlloc', async (req, res) => {

    const { data, alpacaCache, freeUp } = req.body; 
    if (!data || !alpacaCache) {
      return res.status(400).json({ error: 'Invalid input: data and alpacaChace required' });
    }

    try {
      const result = await allocCapital.calcolaAlloc(data, alpacaCache, freeUp);
      if (!result.success) return res.status(404).json({ error: 'Error running calcolaAlloc |'+JSON.stringify(result.data) });
      res.json(result);
    } catch (error) {
      console.error('[PUT /capital/calcolaAlloc] Errore: '+ error.message);
      res.status(500).json({ error: `Errore calcolaAlloc : ${error.message}`, module:"[PUT /capital/calcolaAlloc]" });
    }
  });

  app.get('/capital/:strategy_id(\\d+)', async (req, res) => {

    try {
      const result = await allocCapital.reserveCapitalForStrategy(req.params.strategy_id, req.query.closed);
      if (!result) return res.status(404).json({ error: 'Strategy not found' });
      res.json(result);
    } catch (error) {
      console.error('[GET /capital/:strategy_id] Errore: '+ error.message);
      res.status(500).json({ error: `Retrive capital failed: ${error.message} for strategy_id ${req.params.strategy_id}`, module:"[GET /capital/:strategy_id]" });
    }
  });

  app.post('/capital/:strategy_id(\\d+)', async (req, res) => {

    if (isNaN(req.body.requested) || isNaN(req.body.approved)) {
      return res.status(400).json({ error: 'Invalid input: requested and approved must be numbers' });
    }

    try {
      const result = await allocCapital.setStrategyCapitalInsertOrder(req.params.strategy_id, req.body.requested, req.body.approved);
      if (!result) return res.status(404).json({ error: 'Error setting strategy_id into CapitalCache' });
      res.json(result);
    } catch (error) {
      console.error('[POST /capital/:strategy_id] Errore: '+ error.message);
      res.status(500).json({ error:  `Order insert failed: ${error.message} for strategy_id ${req.params.strategy_id}`, module:"[POST /capital/:strategy_id]" });
    }
  });

  app.put('/capital/:strategy_id(\\d+)', async (req, res) => {
    console.log(`[HTTP] ${req.method} ${req.originalUrl} at ${Date.now()}`);

    if (isNaN(req.body.approved) || isNaN(req.body.used)) {
      return res.status(400).json({ error: 'Invalid input: approved and used must be numbers' });
    }

    try {
      const result = await allocCapital.setStrategyCapitalAcceptedOrder(req.params.strategy_id, req.body.approved, req.body.used);
      if (!result) return res.status(404).json({ error: 'Error setting strategy_id into CapitalCache' });
      res.json(result);
    } catch (error) {
      console.error('[PUT /capital/:strategy_id] Errore: '+ error.message);
      res.status(500).json({ error: `Order acceptance failed: ${error.message} for strategy_id ${req.params.strategy_id}`, module:"[PUT /capital/:strategy_id]" });
    }
  });

  app.delete('/capital/:strategy_id(\\d+)', async (req, res) => {

    try {
      const result = await allocCapital.freeupCapital(req.params.strategy_id, req.query.CapitaleInvestito=0);
      if (!result) return res.status(404).json({ error: 'Error setting strategy_id into CapitalCache' });
      res.json(result);
    } catch (error) {
      console.error('[DELETE /capital/:strategy_id] Errore: '+ error.message);
      res.status(500).json({ error: `Free up capital failed: ${error.message} for strategy_id ${req.params.strategy_id}`, module:"[DELETE /capital/:strategy_id]" });
    }
  });



    // Endpoint: health check
    app.get('/health', (req, res) => {
      res.json({ status: 'OK', module: MODULE_NAME, uptime: process.uptime() });
    });

    // Endpoint: get module info
    // Info modulo
    app.get('/info', (req, res) => {
      res.json(capitalManager.getInfo());
    });
  
    app.get('/loglevel', (req, res) => {
      res.json({ 
        allocCapital : allocCapital.getLogLevel(), 
        capitalManager : capitalManager.getLogLevel()
      });
    });

    app.put('/loglevel/:module', (req, res) => {

      const moduleMap = {
        allocCapital,
        capitalManager
      };

      const targetModule = moduleMap[req.params.module];

      if (!targetModule || typeof targetModule.setLogLevel !== 'function') {
        return res.status(400).json({ success: false, error: `Modulo ${req.params.module} non esistente` });
      }

      targetModule.setLogLevel(req.body.logLevel);
      res.status(200).json({ success: true, msg: `Nuovo livello ${req.body.logLevel} log per modulo ${req.params.module}` });
    });


// Avvio server
(async () => {
    try {
      capitalManager = new CapitalManager ();
      capitalManager.init();
      
      app.listen(port, () => {
        logger.info(`[capital-manager] Server avviato sulla porta ${port}`);
      });

    } catch (err) {
      logger.error(`[capital-manager][startup] Errore avvio: ${err.message}`);
      process.exit(1);
    }
  })();