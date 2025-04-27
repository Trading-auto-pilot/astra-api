// strategies/sma/index.js

const { runBacktest } = require('../../shared/runner');
const StrategyUtils = require('../../shared/utils');
const CacheManager = require('../../shared/cacheManager');
const processCandle = require('./processCandle');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
require('dotenv').config();

const symbol = process.env.SYMBOL;
//const id = process.env.SCENARIO_ID;
const startDate = new Date(process.env.START_DATE);
const endDate = new Date(process.env.END_DATE);
const capitale = parseFloat(process.env.CAPITALE);
const period = parseInt(process.env.MA); // Media mobile
const SL = parseFloat(process.env.SL);
const TP = parseFloat(process.env.TP);

async function run() {

  const cacheManager = new CacheManager(path.resolve(__dirname, '../../cache'));
  const Strategia = "SMA";
  const Ver = "1.0";

  const id = crypto.createHash('sha256').update(`${Strategia}:${Ver}:${symbol}:${period}:${SL}:${TP}:${capitale}:${startDate.toISOString()}:${endDate.toISOString()}`).digest('hex').slice(0, 50);

  console.log(`[${id}] Inizio strategia ${Strategia} per simbolo ${symbol} dal ${startDate.toISOString()} al ${endDate.toISOString()}`);

  //const dataset = await StrategyUtils.loadDatasetFromCache(symbol, startDate, endDate, cacheManager);
  const dataset = await StrategyUtils.backTest(symbol, startDate, endDate, process.env.APCA_API_KEY_ID, process.env.APCA_API_SECRET_KEY);

  const initialState = {
    capitaleLibero: capitale,
    capitaleInvestito: 0,
    comprato: 0,
    lastOp: null,
    daysFree: 0,
    daysInvested: 0,
    minDay: 9999999,
    maxDay: 0,
    numOp: 0
  };

  const strategyParams = {
    id,
    symbol,
    startDate,
    endDate,
    capitaleIniziale: capitale,
    period,
    SL,
    TP
  };

  await runBacktest(dataset, initialState, strategyParams, processCandle, cacheManager, id, Strategia);

  console.log(`[${id}] Strategia completata`);
}

run().catch(err => {
  console.error(`Errore durante l'esecuzione:`, err);
  process.exit(1);
});
