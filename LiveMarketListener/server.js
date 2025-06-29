// server.js
const express = require('express');
const dotenv = require('dotenv');
const LiveMarketListener = require('./modules/main');
const createLogger = require('../shared/logger');


const MICROSERVICE = 'LiveMarketListener';
const MODULE_NAME = 'REST Server';
const MODULE_VERSION = '2.0';

let logLevel = process.env.LOG_LEVEL || 'info' ;
 
const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, logLevel );

dotenv.config();
const app = express();
app.use(express.json());

const port = process.env.PORT || 3012;
let liveMarketListner;

(async () => {
  try {
    liveMarketListner = new LiveMarketListener();
    await liveMarketListner.init();
    logger.info('LiveMarketListener avviato con successo');
  } catch (err) {
    logger.error(`Errore durante l'inizializzazione: ${err.message}`);
    process.exit(1);
  }
})();

app.get('/loglevel', (req, res) => {
  res.json({ 
    liveMarketListner : liveMarketListner.getLogLevel(),
    processCandles : liveMarketListner.getLogLevel('processCandles'),
    redisPubSubManager : liveMarketListner.getLogLevel('redisPubSubManager'),
    alpacaSocket : liveMarketListner.getLogLevel('alpacaSocket'),
    tradeExecutor : liveMarketListner.getLogLevel('tradeExecutor'),
    RESTServer : logLevel

  });
});

app.put('/loglevel/:module', (req, res) => {


  if(req.params.module === "RESTServer") 
    logLevel = req.body.logLevel;
  else
    liveMarketListner.setLogLevel(req.body.logLevel, req.params.module);

  res.status(200).json({ success: true, msg: `Nuovo livello ${req.body.logLevel} log per modulo ${req.params.module}` });
});


// REST API
app.get('/health', (req, res) => {
  res.json({ status: 'OK', uptime: process.uptime() });
});

app.get('/info', (req, res) => {
  res.json(liveMarketListner.getInfo());
});

app.post('/pause', (req, res) => {
  liveMarketListner.pause();
  res.json({ status: 'paused' });
});

app.post('/resume', (req, res) => {
  liveMarketListner.resume();
  res.json({ status: 'resumed' });
});

app.post('/addOrdertoOrderTable', (req, res) => {
  liveMarketListner.addOrdertoOrderTable(req.body);
  res.json({ status: 'ok' });
});

app.put('/orderActive/remove', (req, res) => {
  const { symbol } = req.body;
  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ error: 'Fornire un simbolo valido' });
  }
 
  try {
    liveMarketListner.updateOrderActive([symbol]);
    res.json({ success: true, removed: symbol });
  } catch (err) {
    logger.error(`Errore rimozione ordine attivo: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  logger.info(`REST API attiva sulla porta ${port}`);
});
