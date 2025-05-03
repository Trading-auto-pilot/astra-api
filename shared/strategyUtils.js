// strategy-utils/StrategyUtils.js
const axios = require('axios');
const createLogger = require('./logger');

const MODULE_NAME = 'StrategyUtils';
const MODULE_VERSION = '1.0';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL);

class StrategyUtils {
  constructor() {
    logger.info(`[constructor] initialized - version ${MODULE_VERSION}`);
  }

  // Calcola il profitto annualizzato dato un periodo e un profitto totale
  getAnnualizedProfit(startDateStr, endDateStr, profit) {
      logger.log(`[getAnnualizedProfit] initialized con parametri startDateStr ${startDateStr} endDateStr ${endDateStr} profit ${profit}`);
      const start = new Date(startDateStr);
      const end = new Date(endDateStr);

      let yearsDiff = end.getFullYear() - start.getFullYear();
      let monthsDiff = end.getMonth() - start.getMonth();
      let totalMonths = yearsDiff * 12 + monthsDiff;

      if (end.getDate() < start.getDate()) {
        totalMonths--;
      }

      if (totalMonths <= 0) {
        logger.warning(`[getAnnualizedProfit] Date range must span at least one full month.`);
        throw new Error(`[${MODULE_NAME}][getAnnualizedProfit] Date range must span at least one full month.`);
      }

      const monthlyAverageProfit = profit / totalMonths;
      return monthlyAverageProfit * 12;
  }

  // Calcola la media mobile partendo da un array di candele già filtrate e ordinate
  async calcMediaMobile(params) {
    const { symbol, periodDays, currentDate, tf } = params;
    logger.log(`[calcMediaMobile] initialized con parametri symbol ${symbol} periodDays ${periodDays} currentDate ${currentDate} tf ${tf}`);
  
    if (!symbol || !periodDays || !currentDate || !tf) {
        logger.error(`[getAnnualizedProfit] Parametri richiesti: symbol, periodDays, currentDate, tf`);
        throw new Error(`Parametri richiesti: symbol, periodDays, currentDate, tf`);
    }
  
    const endDate = new Date(currentDate);
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - periodDays);
  
    const cacheManagerURL = process.env.CACHEMANAGER_URL || 'http://cachemanager:3006';
  
    logger.log(`[calcMediaMobile] richiamo ${cacheManagerURL}/candles`);
    try {
        logger.info(`[${MODULE_NAME}] [calcMediaMobile] Connessione a ${cacheManagerURL}/candles?symbol=${symbol}&startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}&tf=${tf}`);
        const response = await axios.get(`${cacheManagerURL}/candles`, {
            params: {
            symbol:symbol,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            tf:tf
            }
        });
  
        const candles = response.data;
  
        if (!Array.isArray(candles) || candles.length === 0) {
          logger.warning(`[getAnnualizedProfit] Nessuna candela trovata per il periodo richiesto`);
          throw new Error(`Nessuna candela trovata per il periodo richiesto`);
        }
  
      const filteredCandles = candles.filter(c => new Date(c.t).getTime() < new Date(currentDate).getTime());
  
      if (filteredCandles.length === 0) {
        logger.warning(`[getAnnualizedProfit] Nessuna candela precedente a currentDate disponibile`);
        throw new Error(`Nessuna candela precedente a currentDate disponibile`);
      }
  
      const sum = filteredCandles.reduce((acc, c) => acc + c.c, 0);
      const average = sum / filteredCandles.length;

      logger.info(`[calcMediaMobile] average : ${average}`);
      return(average);
  
    } catch (err) {
      logger.error('[calcMediaMobile] Errore:', err.message);
    }
  }
  

  getInfo() {
    return {
      module: MODULE_NAME,
      version: MODULE_VERSION,
      status: 'OK',
      logLevel:process.env.LOG_LEVEL || 'info'
    };
  }
}

module.exports = StrategyUtils;
