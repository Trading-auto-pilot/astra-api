// capitalManager/CapitalManager.js
const axios = require('axios');
const createLogger = require('../shared/logger');

const MODULE_NAME = 'capitalManager';
const MODULE_VERSION = '1.1';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL || 'info');

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
    const cache = await this.getAvailableCapital();        
    
    const strategyDetails = await this.getStrategyDetaisl(strategyId);

    const share = parseFloat(strategyDetails.share);
    const CapOrdiniInvestito = parseFloat(strategyDetails.TotalCommitted);
    const UsatoPerStrategia = parseFloat(strategyDetails.CapitaleInvestito) + parseFloat(strategyDetails.OpenOrders);

      // Il cash rimanente piu tutto cio che ho impagnato e' ilmmio capitale originale
    const CapitaleOriginale = cache + CapOrdiniInvestito;        
      // Questo e' il capitale assegnato a questa strategia
    const AssegnatoStrategia = CapitaleOriginale * share;
      // Questo e' il capitale che rimane da investire per questa strategia
    const rimanenteStrategia = AssegnatoStrategia - UsatoPerStrategia

    logger.trace(`[evaluateAllocation] Cash rimanente da ALPACA ${cache}`);
    logger.trace(`[evaluateAllocation] Share di questa strategia ${share}`);
    logger.trace(`[evaluateAllocation] Totale capitale impegnato Tutto investito + Tutto ordini attivi ${CapOrdiniInvestito}`);
    logger.trace(`[evaluateAllocation] Capitale originale ${CapitaleOriginale}`);
    logger.trace(`[evaluateAllocation] Assegnato per questa strategia ${AssegnatoStrategia}`);
    logger.trace(`[evaluateAllocation] Rimanente per Questa strategia ${rimanenteStrategia}`);

    if (rimanenteStrategia <= 0) {
      return {
        approved: false,
        reason: 'Insufficient allocation margin'
      };
    }

    if( !Number.isFinite(rimanenteStrategia)) {
      return {
        approved: false,
        reason: 'Capitale rimanente non correttamente calcolato'
      };
    }

      // Prendo la cifra minima tra il rimanente per questa strategia e il cache rimanente
    const toInvest = Math.min(rimanenteStrategia, cache);

    if(rimanenteStrategia > toInvest) {
      logger.info(`[evaluateAllocation] Approvato ${rimanenteStrategia} ma capitale rimanente ${toInvest} utilizzo il capitale a disposizione`);
      return {
        approved: true,
        grantedAmount: Math.round(toInvest * 100) / 100
      };
    }

    return {
      approved: true,
      grantedAmount: Math.round(rimanenteStrategia * 100) / 100
    };
        
  }

}

module.exports = CapitalManager;
