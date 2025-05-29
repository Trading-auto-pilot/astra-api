const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const createLogger = require('../shared/logger');
require('dotenv').config({ path: '../.env' });

const DBManager = require('./dbManager');
const dbManager = new DBManager();

const app = express();
const port = process.env.PORT || 3002;

// 🌍 Costanti di modulo
const MODULE_NAME = 'DBManager_RESTServer';
const MODULE_VERSION = '1.0';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL || 'info');

app.use(cors());
app.use(express.json());

// 🔁 Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'OK', module: MODULE_NAME, version: MODULE_VERSION });
});

// ℹ️ Info endpoint
app.get('/info', (req, res) => {
  res.json({
    module: MODULE_NAME,
    version: MODULE_VERSION,
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// 📦 Caricamento dinamico delle route da /routes
const routesPath = path.join(__dirname, 'routes');
fs.readdirSync(routesPath).forEach(file => {
  if (file.endsWith('.js')) {
    const routeModule = require(path.join(routesPath, file));
    if (typeof routeModule === 'function') {
      const router = routeModule(dbManager); // chiama la factory con dbManager
      const routePath = '/' + path.basename(file, '.js'); // usa il nome del file come path
      app.use(routePath, router);
      logger.trace(`[server] Registrata route dinamica: ${routePath}`);
    }
  }
});



// app.listen(port, () => {
//   console.log(`[${MODULE_NAME}] Avviato sulla porta ${port}`);
// });


// alla fine di server.js
module.exports = app;