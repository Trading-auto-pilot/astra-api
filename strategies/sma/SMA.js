const axios = require('axios');
const createLogger = require('../../shared/logger');
const StrategyUtils = require('../../shared/strategyUtils');

const MODULE_NAME = 'SMA';
const MODULE_VERSION = '1.0';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL);
const utils = new StrategyUtils();

class SMA {
  constructor() {
    this.lastOp = null;
    this.comprato = null;
    this.capitaleInvestito = 0;
    //this.strategyUtilsURL = process.env.STRATEGYUTIL_URL || 'http://strategy-utils:3007';
    this.dbManagerURL = process.env.DBMANAGER_URL || 'http://dbmanager:3002';

    this.registerBot();
  }

getSMAInfo() {
  return {
      module: MODULE_NAME,
      version: MODULE_VERSION,
      status: 'OK',
      logLevel: process.env.LOG_LEVEL || 'info',
      strategyUtil : utils.getInfo()
  };
}

  // 🔁 Registra il bot nel DB se non esiste, altrimenti aggiorna la data
async registerBot() {
    try {
      await axios.post(`${this.dbManagerURL}/bot/registra`, {
        name: MODULE_NAME,
        ver: MODULE_VERSION
      });
      logger.info(`[registerBot] Bot registrato`);
    } catch (err) {
        logger.error(`[registerBot][registerBot] Errore: ${err.message}`);
    }
  }

async getMediaMobile(symbol, periodDays, currentDate, tf) {
    logger.log(`[getMediaMobile] Richiamata con parametri : ${symbol} ${periodDays} ${currentDate} ${tf}`);
    try {

        const mediaMobile = await utils.calcMediaMobile({
          symbol,
          periodDays,
          currentDate,
          tf
        });
      

      logger.info('[getMediaMobile] Media Mobile ricevuta : '+mediaMobile);

    } catch (err) {
        logger.error('[SMA][getMediaMobile] Errore durante la richiesta:', err.message);
      return null;
    }
}


  // 📥 Recupera ultima transazione dal DB per inizializzare lo stato interno
async loadLastPosition(scenarioId) {
    try {
        logger.log(`[loadLastPosition] Richiamo ${this.dbManagerURL}/lastTransaction/${scenarioId}`);
        const response = await axios.get(`${this.dbManagerURL}/lastTransaction/${scenarioId}`);
        

        const last = response.data;
        logger.log(`[loadLastPosition]Recuperata posizione ${JSON.stringify(last)}`);

        if (last) {
          this.lastOp = new Date(last.operationDate);
          if (last.operation === 'BUY') {
            this.comprato = parseFloat(last.Price);
            this.capitaleInvestito = parseFloat(last.capitale);
          } else {
            this.comprato = null;
            this.capitaleInvestito = 0;
          }
        }
      } catch (err) {
        logger.error(`[loadLastPosition] Errore: ${err.message}`);
      }
  }

  /*
  async getSymbol(strategyId) {
    logger.log(`[getSymbol] Richiamo ${this.dbManagerURL}/getStrategyCapitalAndOrders/${strategyId}`);
      try {
        const res = await axios.get(`${this.dbManagerURL}/getStrategyCapitalAndOrders/${strategyId}`);
        logger.log(`[getSymbol] Recuperato ${res.data[0]}`);
        return (res.data[0]);
      } catch (err) {
          logger.error(`[getSymbol] Errore DBManager:`, err.message);
        throw err;
      }
  }
*/

  // ⚙️ Elabora una candela e genera un segnale BUY / SELL / HOLD
  async processCandle(candle, scenarioId, symbol, params) {

    logger.log(`[processCandle] Funzione richiamata con parametri : ${JSON.stringify(candle)} ${scenarioId} ${symbol}`);
    const {SL, TP, MA, TF} = params;
    let mediaMobile , prezzo;
    

    try {
        prezzo = parseFloat(candle.c);
        await this.loadLastPosition(scenarioId);
    } 
    catch (err) {
        logger.error(`[processCandle] Errore nel recupero loadLastPosition:`, err.message);
        throw err;
    }

    try {
        mediaMobile = await this.getMediaMobile(symbol, MA, candle.t, TF);
    }
    catch (err) {
        logger.error(`[processCandle] Errore nel recupero della Media Mobile:`, err.message);
        throw err;
    }

    // BUY se prezzo > media mobile e non ho già acquistato
    if (mediaMobile != null && prezzo > mediaMobile) {
      return {
        action: 'BUY',
        prezzo,
        mediaMobile,
        motivo: 'Prezzo sopra media mobile'
      };
    }

    // SELL per Stop Loss o Take Profit
    if (this.comprato) {
      const profit = (prezzo - this.comprato) / this.comprato;

      if (profit <= -SL) {
        return {
          action: 'SELL',
          prezzo,
          mediaMobile,
          motivo: 'SL',
          profitLoss: profit
        };
      }

      if (profit >= TP) {
        return {
          action: 'SELL',
          prezzo,
          mediaMobile,
          motivo: 'TP',
          profitLoss: profit
        };
      }
    }

    // Altrimenti HOLD
    return {
      action: 'HOLD',
      prezzo,
      mediaMobile
    };
  }
}

module.exports = SMA;
