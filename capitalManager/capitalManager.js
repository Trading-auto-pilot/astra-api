// capitalManager/CapitalManager.js
const axios = require('axios');
const createLogger = require('../shared/logger');

const MICROSERVICE = "capitalManager";
const MODULE_NAME = 'capitalManager';
const MODULE_VERSION = '1.2';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

class CapitalManager {
  constructor(config) {
    this.key = config.key,
    this.secret=config.secret,
    this.env=config.env
    this.dbManagerUrl =process.env.DBMANAGER_URL || 'http://localhost:3002'

    // Log delle variabili definite nell'istanza
    for (const key of Object.keys(this)) {
        // Esclude i metodi (funzioni)
        if (typeof this[key] !== 'function') {
        logger.trace(`[init] Variabile ${key} =`, this[key]);  
      }
    }
  }


  getInfo() {
    return {
      module: MODULE_NAME,
      version: MODULE_VERSION,
      logLevel: process.env.LOG_LEVEL,
      status: 'OK'
    };
  }

  async getAvailableCapital() {
    logger.log(`[getAvailableCapital] Recupero capitale disponibile da Alpaca : ${this.env}/v2/account`);
    
    try {
      const res = await axios.get(this.env+'/v2/account', {
        headers: {
          'APCA-API-KEY-ID': process.env.APCA_API_KEY_ID,
          'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET_KEY
        }
      });
      logger.log(`[getAvailableCapital] Recuperato capitale ${res.data.cash}`);
      return(parseFloat(res.data.cash));
    } catch (err) {
      logger.error(`[getAvailableCapital] Errore Alpaca:`, err.message);
      throw err;
    }
  }

  async getStrategyDetaisl(strategyId) {
    logger.log(`[getStrategyDetaisl] Recupero dettagli della strategia : ${this.dbManagerUrl}/strategies/capitalAndOrder/${strategyId}`);
    try {
      const res = await axios.get(`${this.dbManagerUrl}/strategies/capitalAndOrder/${strategyId}`);
      logger.log(`[getStrategyDetaisl] Recuperato  : ${JSON.stringify(res.data)}`);
      return (res.data[0]);
    } catch (err) {
      logger.error(`[getAllocatedCapital] Errore DBManager:`, err.message);
      throw err;
    }
  }

  async getTotalAllocatedCapital() {
    logger.log(`[getTotalAllocatedCapital] Recupero capitale allocato totale : ${this.dbManagerUrl}/getTotalActiveCapital`);
    try {
      const res = await axios.get(`${this.dbManagerUrl}/getTotalActiveCapital`);
      logger.log(`[getTotalAllocatedCapital] Recuperato : ${res.data.allocated || 0}`);
      return parseFloat(res.data.allocated || 0);
    } catch (err) {
      logger.error(`[getAllocatedCapital] Errore DBManager:`, err.message);
      throw err;
    }
  }



async evaluateAllocation(strategyId) {
  logger.trace(`[evaluateAllocation] Valutazione capitale per strategyId ${strategyId}`);

  const cache = parseFloat(await this.getAvailableCapital());
  if (!Number.isFinite(cache) || cache <= 0) {
    logger.warning(`[evaluateAllocation] Cache non valido o negativo: ${cache}`);
    return {
      approved: false,
      reason: 'Cache non disponibile o negativo'
    };
  }

  const strategyDetails = await this.getStrategyDetaisl(strategyId);
  const share = parseFloat(strategyDetails?.share ?? 0);
  const capOrdiniInvestito = parseFloat(strategyDetails?.TotalCommitted ?? 0);
  const capitaleInvestito = parseFloat(strategyDetails?.CapitaleInvestito ?? 0);
  const openOrders = parseFloat(strategyDetails?.OpenOrders ?? 0);
  const usatoPerStrategia = capitaleInvestito + openOrders;

  if (!Number.isFinite(share) || share <= 0 || share > 1) {
    logger.warning(`[evaluateAllocation] Share non valido per strategyId ${strategyId}: ${share}`);
    return {
      approved: false,
      reason: 'Share non valido'
    };
  }

  const capitaleOriginale = cache + capOrdiniInvestito;
  const assegnatoStrategia = capitaleOriginale * share;
  const rimanenteStrategia = assegnatoStrategia - usatoPerStrategia;

  logger.trace(`[evaluateAllocation] ➤ Cache disponibile: ${cache}`);
  logger.trace(`[evaluateAllocation] ➤ Share strategia: ${share}`);
  logger.trace(`[evaluateAllocation] ➤ Capitale usato: ${usatoPerStrategia}`);
  logger.trace(`[evaluateAllocation] ➤ Capitale originale: ${capitaleOriginale}`);
  logger.trace(`[evaluateAllocation] ➤ Capitale assegnato strategia: ${assegnatoStrategia}`);
  logger.trace(`[evaluateAllocation] ➤ Rimanente da allocare: ${rimanenteStrategia}`);

  if (!Number.isFinite(rimanenteStrategia) || rimanenteStrategia <= 0) {
    return {
      approved: false,
      reason: 'Capitale non allocabile'
    };
  }

  const toInvest = Math.min(rimanenteStrategia, cache);
  const granted = Math.round(toInvest * 100) / 100;

  return {
    approved: true,
    grantedAmount: granted
  };
}


}

module.exports = CapitalManager;
