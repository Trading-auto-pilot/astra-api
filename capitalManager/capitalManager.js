// capitalManager/CapitalManager.js
const axios = require('axios');
const createLogger = require('../shared/logger');
const { initializeSettings, getSetting } = require('../shared/loadSettings');
const Alpaca = require('../shared/Alpaca');
const alloc = require('./allocCapital');

const MICROSERVICE = "CapitalManager";
const MODULE_NAME = 'Core'; 
const MODULE_VERSION = '1.2';
 
class CapitalManager {

  constructor(config) {
    this.env=null;
    this.dbManagerUrl =process.env.DBMANAGER_URL || 'http://localhost:3002'
    this.AlpacaApi = new Alpaca();
    this.logLevel = process.env.LOG_LEVEL;
    this.logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, this.logLevel || 'info');
  }

  async init(){
    await initializeSettings(this.dbManagerUrl);
    await this.AlpacaApi.init();
    this.env = getSetting(['ALPACA-'+process.env.ENV_ORDERS+'-BASE']);

    await new Promise(resolve => setTimeout(resolve, 1500));
    alloc.initCapitalManager();
  }

  getLogLevel(){
    return this.logLevel;
  }

  setLogLevel(level) {
    this.logLevel=level;
    this.logger.setLevel(level);
  }

  getInfo() {
    return {
      module: MODULE_NAME,
      version: MODULE_VERSION,
      logLevel: "Call /loglevel",
      env_orders : process.env.ENV_ORDERS,
      status: 'OK'
    };
  }


  async getStrategyDetaisl(strategyId) {
    this.logger.log(`[getStrategyDetaisl] Recupero dettagli della strategia : ${this.dbManagerUrl}/strategies/capitalAndOrder/${strategyId}`);
    try {
      const res = await axios.get(`${this.dbManagerUrl}/strategies/capitalAndOrder/${strategyId}`);
      this.logger.log(`[getStrategyDetaisl] Recuperato  : ${JSON.stringify(res.data)}`);
      return (res.data[0]);
    } catch (err) {
      this.logger.error(`[getAllocatedCapital] Errore DBManager:`, err.message);
      throw err;
    }
  }





}

module.exports = CapitalManager;
