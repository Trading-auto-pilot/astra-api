const express = require('express');
const axios = require('axios');
const redis = require('redis');
const cors = require ('cors');
const CacheManager = require('./cacheManager');
const createLogger = require('../shared/logger');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3006;
const MICROSERVICE='cacheManager'
const MODULE_NAME = 'RESTServer';
const MODULE_VERSION = '2.0';

app.use(cors({
  origin: 'http://localhost:5173', // indirizzo frontend
  credentials: true // se usi cookie o auth
}));
app.use(express.json());


const dbManagerBaseUrl = process.env.DBMANAGER_URL || 'http://dbmanager:3002'; // URL del microservizio DBManager
let cacheManager = null;
let logLevel = process.env.LOG_LEVEL || 'info';
const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, logLevel);

function getLogLevel() {
  return logLevel;
}

function setLogLevel(level) {
  logLevel = level;
  logger.setLevel(logLevel);
}
// Configurazione REDIS
// Redis Pub/Sub Integration
(async () => {

  cacheManager = new CacheManager();
  cacheManager.init();

  // Avvio del server REST
  try {
    app.listen(port, () => {
      logger.log(`[cacheManager] Server avviato sulla porta ${port}`);
    });
  } catch (err) {
    logger.error('[STARTUP] Errore nell\'inizializzazione del servizio:', err.message);
    logger.log(err);
    process.exit(1);
  }  
})();


// Endpoint REST per il test del servizio
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'cacheManager' , uptime: process.uptime()});
});

// Endpoint informazioni sul modulo
app.get('/info', (req, res) => {
  res.status(200).json(cacheManager.getInfo());
});


app.get('/stats/L2', async (req, res) => {
  const result = await cacheManager.getDirStatsL2();
  res.status(200).json({success:true, params: result});
});

app.delete('/stats/L2', async (req, res) => {
  await cacheManager.deleteAllCacheL2(req.params.symbol);
  const result = await cacheManager.getDirStatsL2();
  res.status(200).json({success:true, params: result});
});

app.get('/stats/L2/:symbol', async (req, res) => {
  const result = await cacheManager.listFilesL2(req.params.symbol);
  res.status(200).json({success:true, params: result});
});

app.delete('/stats/L2/:symbol', async (req, res) => {
  const body = {Anno:req.query.Anno, Mese:req.query.Mese, TF:req.query.TF};
  console.log(body);
  await cacheManager.deleteMatchingFiles(req.params.symbol, body );
  const result = await cacheManager.getDirStatsL2(req.params.symbol);
  res.status(200).json({success:true, params: result});
});

app.get('/stats/L1', async (req, res) => {
  const result = await cacheManager.getStatL1();
  res.status(200).json({success:true, params: result});
});

app.delete('/stats/L1', async (req, res) => {
  await cacheManager.deleteCandlesKeysL1({symbol:req.query.symbol, tf:req.query.tf, week:req.query.week, year:req.query.year});
  res.status(200).json({success:true, params: cacheManager.getStatL1()});
});

app.get('/stats/L1/info', async (req, res) => {
  const result = await cacheManager.getRedisInfo();
  res.status(200).json({success:true, params: result});
});

// Endpoint informazioni sul modulo
app.get('/logLevel', (req, res) => {
    res.status(200).json({cacheManager:cacheManager.getLogLevel(), RESTServer: getLogLevel()});
});
// Endpoint informazioni sul modulo
app.put('/logLevel/:module', (req, res) => {
  let success = true;
  switch(req.params.module) {
    case 'cacheManager' : cacheManager.setLogLevel(req.body.logLevel); break;
    case 'RESTServer' : setLogLevel(req.body.logLevel); break;
    default : success = false; rc = {success:false, modulo: 'PUT [/logLevel/'+req.params.module+']', error : "Modulo "+req.params.module+" non esistente"}
  }
  if(success)
    res.status(200).json({success:success, logLevel : {cacheManager:cacheManager.getLogLevel(), RESTServer: getLogLevel()}});
  else
    res.status(200).json(rc);
});

app.get('/paramsSetting', (req, res) => {
  const result = cacheManager.getParams();
  res.status(200).json({success:true, params: result});
});

app.post('/paramsSetting/:paramName', async (req, res) => {
  await cacheManager.setParamSetting(req.params.paramName);
  res.status(200).json({success:true, params: cacheManager.getParams()});
});

app.get('/cacheHits', (req, res) => {
  const result = cacheManager.getCacheHits();
  res.status(200).json({success:true, Hits: result});
});

app.put('/cacheHits', (req, res) => {
  const result = cacheManager.resetCacheHits();
  res.status(200).json({success:true, Hits: cacheManager.getCacheHits()});
});


// Endpoint per ottenere candele dal simbolo e range
app.get('/candles', async (req, res) => {
  const { symbol, startDate, endDate, tf } = req.query;

  if (!symbol || !startDate || !endDate) {
    return res.status(400).json({ error: 'Parametri richiesti: symbol, startDate, endDate' });
  }

  try {
    const candles = await cacheManager.retrieveCandlesFromL1(symbol, startDate, endDate, tf);
    res.json(candles);
  } catch (err) {
    logger.error(`[CACHE] Errore nel recupero candele: ${err.message}`);
    res.status(500).json({ error: 'Errore nel recupero delle candele' });
  }
});

