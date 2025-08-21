const axios = require('axios');
const createLogger = require('../../shared/logger');
const StrategyUtils = require('../../shared/strategyUtils');
const Alpaca = require('../../shared/Alpaca');


const MICROSERVICE = 'STRATEGY SMA';
const MODULE_NAME = 'SMA';
const MODULE_VERSION = '2.0';

const utils = new StrategyUtils();

class SMA {
  constructor() {
    this.lastOp = null;
    this.comprato = null;
    this.capitaleInvestito = 0;
    this.dbManagerURL = process.env.DBMANAGER_URL || 'http://dbmanager:3002';
    this.AlpacaApi = new Alpaca();
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, this.logLevel);

    this.registerBot();
  }

getSMAInfo() {
  return {
      microservice:MICROSERVICE,
      module: MODULE_NAME,
      version: MODULE_VERSION,
      status: 'OK',
      logLevel: this.logLevel,
      strategyUtil : utils.getInfo()
  };
}

  getLogLevel() {
    return this.logLevel;
  }

  setLogLevel(level) {
      this.logLevel=level;
      this.logger.setLevel(level);
  }


  // 🔁 Registra il bot nel DB se non esiste, altrimenti aggiorna la data
async registerBot() {
    try {
      await axios.post(`${this.dbManagerURL}/bots`, {
        name: MODULE_NAME,
        ver: MODULE_VERSION
      });
      this.logger.info(`[registerBot] Bot registrato`);
    } catch (err) {
        this.logger.error(`[registerBot] Errore: ${err.message}`);
    }
  }

async getMediaMobile(symbol, periodDays, currentDate, tf) {
    this.logger.log(`[getMediaMobile] Richiamata con parametri : ${symbol} ${periodDays} ${currentDate} ${tf}`);
    try {

        const mediaMobile = await utils.calcMediaMobile({
          symbol,
          periodDays,
          currentDate,
          tf
        });
      

      this.logger.info('[getMediaMobile] Media Mobile ricevuta : '+mediaMobile);
      return mediaMobile;
    } catch (err) {
        this.logger.error('[SMA][getMediaMobile] Errore durante la richiesta:', err.message);
      return null;
    }
}


  // 📥 Recupera ultima transazione dal DB per inizializzare lo stato interno 
async loadLastPosition(scenarioId) {
    try {
        this.logger.log(`[loadLastPosition] Richiamo ${this.dbManagerURL}/lastTransaction/${scenarioId}`);
        const response = await axios.get(`${this.dbManagerURL}/lastTransaction/${scenarioId}`);
        

        const last = response.data;
        this.logger.log(`[loadLastPosition]Recuperata posizione ${JSON.stringify(last)}`);

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
        this.logger.error(`[loadLastPosition] Errore: ${err.message}`);
      }
  }


  // ⚙️ Elabora una candela e genera un segnale BUY / SELL / HOLD
  async processCandle(candle, scenarioId, symbol, params) {

    this.logger.log(`[processCandle] Funzione richiamata con parametri : ${JSON.stringify(candle)} ${scenarioId} ${symbol}`);
    const {SL, TP, MA, TF} = params;
    let mediaMobile , prezzo;
     

    try {
        prezzo = parseFloat(candle.c);
        //await this.loadLastPosition(scenarioId);
    } 
    catch (err) {
        this.logger.error(`[processCandle] Errore nel recupero loadLastPosition:`, err.message);
        throw err;
    }

    try {
        mediaMobile = await this.getMediaMobile(symbol, MA, candle.t, TF);
    }
    catch (err) {
        this.logger.error(`[processCandle] Errore nel recupero della Media Mobile:`, err.message);
        throw err;
    }

    this.logger.log(`[processCandle] mediaMobile : ${mediaMobile}  prezzo : ${prezzo}`);
    // BUY se prezzo > media mobile e non ho già acquistato
    if (mediaMobile != null && prezzo > mediaMobile) {
      return {
        action: 'BUY',
        prezzo,
        mediaMobile,
        bot: MODULE_NAME,
        symbol:candle.S,
        motivo: 'Prezzo sopra media mobile'
      };
    }

    // SELL per Stop Loss o Take Profit
    if (this.comprato) {
      const profit = (prezzo - this.comprato) / this.comprato;

      if (profit >= TP) {
        return {
          action: 'SELL',
          prezzo,
          mediaMobile,
          motivo: 'TP',
          bot: MODULE_NAME,
          symbol:candle.S,
          profitLoss: profit
        };
      }
    }

    // Altrimenti HOLD
    return {
      action: 'HOLD',
      prezzo,
      bot: MODULE_NAME,
      symbol:candle.S,
      mediaMobile
    };
  }
}

module.exports = SMA;
