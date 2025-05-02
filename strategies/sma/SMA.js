const axios = require('axios');

const MODULE_NAME = 'SMA';
const MODULE_VERSION = '1.0';

class SMA {
  constructor() {
    this.lastOp = null;
    this.comprato = null;
    this.capitaleInvestito = 0;
    this.strategyUtilsURL = process.env.STRATEGYUTIL_URL || 'http://strategy-utils:3007';
    this.dbManagerURL = process.env.DBMANAGER_URL || 'http://dbmanager:3002';

    this.registerBot();
  }

  // 🔁 Registra il bot nel DB se non esiste, altrimenti aggiorna la data
async registerBot() {
    try {
      await axios.post(`${this.dbManagerURL}/bot/registra`, {
        name: MODULE_NAME,
        ver: MODULE_VERSION
      });
      console.log(`[${MODULE_NAME}] Bot registrato`);
    } catch (err) {
      console.error(`[${MODULE_NAME}][registerBot] Errore: ${err.message}`);
    }
  }

async getMediaMobile(symbol, periodDays, currentDate, tf) {
    try {
      const url = `${this.strategyUtilsURL}/calcMediaMobile`;
      //console.log(`[SMA][getMediaMobile] Chiamata a ${url} con`, {symbol, periodDays,currentDate, tf});

      const response = await axios.post(url, {
        symbol,
        periodDays,
        currentDate,
        tf
      });

      console.log('[SMA][getMediaMobile] Media Mobile ricevuta : '+response.data.movingAverage);
      if (response.data && response.data.movingAverage != null) {
        return response.data.movingAverage;
      } else {
        console.warn('[SMA][getMediaMobile] Nessun valore di media mobile ricevuto');
        return null;
      }
    } catch (err) {
      console.error('[SMA][getMediaMobile] Errore durante la richiesta:', err.message);
      return null;
    }
}


  // 📥 Recupera ultima transazione dal DB per inizializzare lo stato interno
async loadLastPosition(scenarioId) {
    try {
      const response = await axios.get(`${this.dbManagerURL}/lastTransaction/${scenarioId}`);
      
      const last = response.data;

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
      console.error(`[${MODULE_NAME}][loadLastPosition] Errore: ${err.message}`);
    }
  }

    async getSymbol(strategyId) {
      try {
        const res = await axios.get(`${this.dbManagerURL}/getStrategyCapitalAndOrders/${strategyId}`);
        return (res.data[0]);
      } catch (err) {
        console.error(`[${MODULE_NAME}][getAllocatedCapital] Errore DBManager:`, err.message);
        throw err;
      }
    }


  // ⚙️ Elabora una candela e genera un segnale BUY / SELL / HOLD
  async processCandle(candle, scenarioId) {

    let params, symbol;
    let SL, TP, MA, TF;
    let mediaMobile , prezzo;
    

    try {
        prezzo = parseFloat(candle.c);
        await this.loadLastPosition(scenarioId);
    } 
    catch (err) {
        console.error(`[${MODULE_NAME}][processCandle] Errore nel recupero loadLastPosition:`, err.message);
        throw err;
    }


    try {
        ({symbol,params} = await this.getSymbol(scenarioId));
        ({ SL, TP, MA, TF } = params);
    } 
    catch (err) {
        console.error(`[${MODULE_NAME}][processCandle] Errore nel recupero parametri:`, err.message);
        throw err;
    }

    try {
        mediaMobile = await this.getMediaMobile(symbol, MA, candle.t, TF);
    }
    catch (err) {
        console.error(`[${MODULE_NAME}][processCandle] Errore nel recupero della Media Mobile:`, err.message);
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
