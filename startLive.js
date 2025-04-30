// startLive.js

require('dotenv').config(); // <-- carica il .env
const { runLive } = require('./shared/liveRunner');

const strategyParams = {
  id: process.env.SCENARIO_ID, // Usa quello generato o crea uno nuovo
  symbol: process.env.SYMBOL,  // Es: "MSFT"
  startDate: new Date(),       // Live
  endDate: null,               // Non serve in live
  capitaleIniziale: parseFloat(process.env.CAPITALE) || 100, 
  period: parseInt(process.env.PERIOD) || 25, 
  SL: parseFloat(process.env.SL) || 0.04,  
  TP: parseFloat(process.env.TP) || 0.08  
};

runLive(strategyParams.symbol, strategyParams);
