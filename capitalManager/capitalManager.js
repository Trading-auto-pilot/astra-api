// capitalManager/CapitalManager.js
const axios = require('axios');
const createLogger = require('../shared/logger');

const MODULE_NAME = 'capitalManager';
const MODULE_VERSION = '1.0';
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
          'APCA-API-KEY-ID': this.key,
          'APCA-API-SECRET-KEY': this.secret
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
    logger.log(`[getStrategyDetaisl] Recupero dettagli della strategia : ${this.dbManagerUrl}/getStrategyCapitalAndOrders/${strategyId}`);
    try {
      const res = await axios.get(`${this.dbManagerUrl}/getStrategyCapitalAndOrders/${strategyId}`);
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
    const available = await this.getAvailableCapital();
    const strategyDetails = await this.getStrategyDetaisl(strategyId);
    const totalAllocated =   strategyDetails.TotalCommitted; //await this.getTotalAllocatedCapital(strategyId);
    

    const cash = parseFloat(available) - parseFloat(totalAllocated);
    const capitaleTotale = parseFloat(available) + parseFloat(totalAllocated);
    const share = parseFloat(strategyDetails.share);
    const capitaleDisponibilePerStrategia = capitaleTotale * share;
    const capitaleInvestito = parseFloat(strategyDetails.CapitaleInvestito);
    const openOrders = parseFloat(strategyDetails.OpenOrders);

    const remaining = capitaleDisponibilePerStrategia - capitaleInvestito - openOrders;
    logger.log(`[evaluateAllocation] available ${available} cash ${cash} totalAllocated ${totalAllocated} strategyDetails ${JSON.stringify(strategyDetails)} capitaleTotale ${capitaleTotale} share ${share} capitaleDisponibilePerStrategia ${capitaleDisponibilePerStrategia} capitaleInvestito ${capitaleInvestito} openOrders ${openOrders} remaining ${remaining}`)

    if (remaining <= 0) {
      return {
        approved: false,
        reason: 'Insufficient allocation margin'
      };
    }

    if( !Number.isFinite(remaining)) {
      return {
        approved: false,
        reason: 'Capitale rimanente non correttamente calcolato'
      };
    }

    const toInvest = Math.min(remaining, cash);
    if(remaining > toInvest) {
      logger.info(`[evaluateAllocation] Approvato ${remaining} ma capitale rimanente ${toInvest} utilizzo il capitale a disposizione`);
      return {
        approved: true,
        grantedAmount: Math.round(toInvest * 100) / 100
      };
    }

    return {
      approved: true,
      grantedAmount: Math.round(remaining * 100) / 100
    };
  }
}

module.exports = CapitalManager;
