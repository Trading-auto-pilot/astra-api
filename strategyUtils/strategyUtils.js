// strategy-utils/StrategyUtils.js
const axios = require('axios');

const MODULE_NAME = 'StrategyUtils';
const MODULE_VERSION = '1.0';

class StrategyUtils {
  constructor() {
    console.log(`[${MODULE_NAME}] initialized - version ${MODULE_VERSION}`);
  }

  // Calcola il profitto annualizzato dato un periodo e un profitto totale
  getAnnualizedProfit(startDateStr, endDateStr, profit) {
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);

    let yearsDiff = end.getFullYear() - start.getFullYear();
    let monthsDiff = end.getMonth() - start.getMonth();
    let totalMonths = yearsDiff * 12 + monthsDiff;

    if (end.getDate() < start.getDate()) {
      totalMonths--;
    }

    if (totalMonths <= 0) {
      throw new Error(`[${MODULE_NAME}][getAnnualizedProfit] Date range must span at least one full month.`);
    }

    const monthlyAverageProfit = profit / totalMonths;
    return monthlyAverageProfit * 12;
  }

  // Calcola la media mobile partendo da un array di candele già filtrate e ordinate
  async calcMediaMobile(params) {
    const { symbol, periodDays, currentDate, tf } = params;
  
    if (!symbol || !periodDays || !currentDate || !tf) {
        throw new Error(`Parametri richiesti: symbol, periodDays, currentDate, tf`);
    }
  
    const endDate = new Date(currentDate);
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - periodDays);
  
    const cacheManagerURL = process.env.CACHEMANAGER_URL || 'http://cachemanager:3006';
  
    try {
        console.log(`[${MODULE_NAME}] [calcMediaMobile] Connessione a ${cacheManagerURL}/candles?symbol=${symbol}&startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}&tf=${tf}`);
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
        return response.status(404).json({ error: 'Nessuna candela trovata per il periodo richiesto' });
      }
  
      const filteredCandles = candles.filter(c => new Date(c.t).getTime() < new Date(currentDate).getTime());
  
      if (filteredCandles.length === 0) {
        return response.status(400).json({ error: 'Nessuna candela precedente a currentDate disponibile' });
      }
  
      const sum = filteredCandles.reduce((acc, c) => acc + c.c, 0);
      const average = sum / filteredCandles.length;

      console.log(`[${MODULE_NAME}] [calcMediaMobile] average : ${average}`);
      return(average);
  
    } catch (err) {
      console.error('[strategy-utils][calcMediaMobile] Errore:', err.message);
    }
  }
  

  getInfo() {
    return {
      module: MODULE_NAME,
      version: MODULE_VERSION,
      status: 'OK'
    };
  }
}

module.exports = StrategyUtils;
