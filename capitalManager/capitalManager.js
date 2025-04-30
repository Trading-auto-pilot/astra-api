// capitalManager/CapitalManager.js
const axios = require('axios');

const MODULE_NAME = 'capitalManager';
const MODULE_VERSION = '1.0';


class CapitalManager {
  constructor(config) {
    this.key = config.key,
    this.secret=config.secret,
    this.env=config.env
    this.dbManagerUrl =process.env.DBMANAGER_URL || 'http://localhost:3002'
  }


  getInfo() {
    return {
      module: MODULE_NAME,
      version: MODULE_VERSION,
      status: 'OK'
    };
  }

  async getAvailableCapital() {
    try {
      const res = await axios.get(this.env+'v2/account', {
        headers: {
          'APCA-API-KEY-ID': this.key,
          'APCA-API-SECRET-KEY': this.secret
        }
      });
      return(parseFloat(res.data.cash));
    } catch (err) {
      console.error(`[${MODULE_NAME}][getAvailableCapital] Errore Alpaca:`, err.message);
      throw err;
    }
  }

  async getStrategyDetaisl(strategyId) {
    try {
      const res = await axios.get(`${this.dbManagerUrl}/getStrategyCapitalAndOrders/${strategyId}`);
      return (res.data);
    } catch (err) {
      console.error(`[${MODULE_NAME}][getAllocatedCapital] Errore DBManager:`, err.message);
      throw err;
    }
  }

  async getTotalAllocatedCapital() {
    try {
      const res = await axios.get(`${this.dbManagerUrl}/getTotalActiveCapital`);
      return parseFloat(res.data.allocated || 0);
    } catch (err) {
      console.error(`[${MODULE_NAME}][getAllocatedCapital] Errore DBManager:`, err.message);
      throw err;
    }
  }



  async evaluateAllocation(strategyId) {
    const available = await this.getAvailableCapital();
    const totalAllocated = await this.getTotalAllocatedCapital(strategyId);
    const strategyDetails = await this.getStrategyDetaisl(strategyId);

    const capitaleTotale = parseFloat(available) + parseFloat(totalAllocated);
    const share = parseFloat(strategyDetails.share);
    const capitaleDisponibilePerStrategia = capitaleTotale * share;
    const capitaleInvestito = parseFloat(strategyDetails.capitaleInvestito);
    const openOrders = parseFloat(strategyDetails.OpenOrders);

    const remaining = capitaleDisponibilePerStrategia - capitaleInvestito - openOrders;

    if (remaining <= 0) {
      return {
        approved: false,
        reason: 'Insufficient allocation margin'
      };
    }

    return {
      approved: true,
      grantedAmount: Math.round(remaining * 100) / 100
    };
  }
}

module.exports = CapitalManager;
