const WebSocket = require('ws');
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const OrderListener = require('./orderListner');
const createLogger = require('../shared/logger');
require('dotenv').config();

const MODULE_NAME = 'LiveMarketListener RESTServer';
const MODULE_VERSION = '1.0';
const app = express();
const port = process.env.PORT || 3005;
const logger = createLogger(MODULE_NAME);

app.use(cors({
  origin: 'http://localhost:5173', // indirizzo frontend
  credentials: true // se usi cookie o auth
}));

let settings = {};
let ws = null;
let isPaper = process.env.ENVIRONMENT === 'PAPER';

const dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';

// --- AVVIO ---
(async () => {
    try {
        orderlistner = new OrderListener();
        await orderlistner.loadSettings();
        orderlistner.init();
        app.listen(port, () => {
            logger.info(`Server REST listening on port ${port}`);
        });
        } catch (err) {
        logger.error(`Startup error: ${err.message}`);
        process.exit(1);
    }
})();


// --- REST ---

app.get('/health', (req, res) => { 
  res.json({ status: 'OK', service: 'orderEventListener', uptime: process.uptime() });
});

app.get('/info', (req, res) => {
  res.json(orderlistner.getInfo());
});


