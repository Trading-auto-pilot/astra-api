module.exports = async function createApp({ bus, logger }) {

  const express = require('express');
  const cors = require('cors');
  const fs = require('fs');
  const path = require('path');
  const { mountRoutesFrom } = require("../shared/routes-loader");
  require('dotenv').config({ path: '../.env' });

  const log = logger.forModule(__filename);
  const MICROSERVICE = 'DBManager';
  const MODULE_NAME = 'endpoints';
  const MODULE_VERSION = '1.0';
  
  const dbManager = require('./modules');
    const app = express();
    const port = process.env.PORT || 3002;


    // 🌍 Costanti di modulo
    //const log = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

    //const bus = new RedisBus({ env: process.env.APP_ENV, name: 'strategies-cache', log });
    await bus.connect();
    app.set('bus', bus);

    app.use(cors({
      origin: 'http://localhost:5173', // indirizzo frontend
      credentials: true // se usi cookie o auth
    }));

    app.use(express.json());

    // 🔁 Healthcheck
    app.get('/health', (req, res) => {
      res.json({ status: 'OK', module: MODULE_NAME, version: MODULE_VERSION });
    });

    // ℹ️ Info endpoint
    app.get('/info', (req, res) => {
      res.json({
        microservice:MICROSERVICE,
        module: MODULE_NAME,
        version: MODULE_VERSION,
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
      });
    });

  // GET /release → ritorna release.json
  app.get("/release", async (req, res) => {
    try {
      const data = await dbManager.getReleaseInfo();
      return res.json(data);
    } catch (err) {
      logger.error("[GET /release] Errore:", err.message);
      return res.status(500).json({ error: "Impossibile leggere release.json" });
    }
  });

    // middleware/withTimeout.js
    function withTimeout(ms = 8000) {
      return (req, res, next) => {
        const t = setTimeout(() => {
          if (!res.headersSent) {
            log.warning(`Time out richiesta endpoint `);
            res.status(504).json({ error: `timeout ${ms}ms` });
          }
        }, ms)
        res.on("finish", () => clearTimeout(t))
        next()
      }
    }

    app.use("/api", withTimeout(8000))

    // vecchie /routes (flat)
    
  // ROUTES ROOT
  mountRoutesFrom(app, {
    routesDir   : path.join(__dirname, "routes"),
    baseUrl     : "/",
    factoryArgs : [dbManager],
    logger
  });

  // ROUTES API
  mountRoutesFrom(app, {
    routesDir   : path.join(__dirname, "api"),
    baseUrl     : "/api",
    factoryArgs : [dbManager, bus, { logger }],
    logger,
  });


    return app;

}
