module.exports = async function createApp({ bus, logger }) {

  const express = require('express');
  const cors = require('cors');
  const fs = require('fs');
  const path = require('path');
  const { mountRoutesFrom } = require("../shared/routes-loader");
  require('dotenv').config({ path: '../.env' });

  const log = logger.forModule(__filename);
  
  const tradeExecutor = require('./modules')({ logger, bus });
    const app = express();
    const port = process.env.PORT || 3001;


    // 🌍 Costanti di modulo
    const MICROSERVICE = 'DBManager'
    const MODULE_NAME = 'RESTServer';
    const MODULE_VERSION = '2.0';
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
      res.json({ status: 'OK', microservice: MICROSERVICE, module: MODULE_NAME, version: MODULE_VERSION });
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

    mountRoutesFrom(app, {
      routesDir : path.join(__dirname, "routes/api"),
      baseUrl   : "/api",
      factoryArgs: [ tradeExecutor, bus, { logger }], // un solo argomento: l’oggetto deps
      logger,
    });


    return app;

}
