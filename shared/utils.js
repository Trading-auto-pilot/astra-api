const mysql = require('mysql2/promise');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const CacheManager = require('./cacheManager.js');

class StrategyUtils {

  static async getDbConnection() {
    return await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'Trading'
    });
  }

  static async loadDatasetFromCache(symbol, startDate, endDate, cacheManager) {

    const result = [];
    const cachePath = path.join(cacheManager.cacheBasePath, symbol);

    if (!fs.existsSync(cachePath)) {
      throw new Error(`Cartella cache non trovata per ${symbol} in ${cachePath}`);
    }

    const files = fs.readdirSync(cachePath)
      .filter(f => f.endsWith('_15Min.json'))
      .sort(); // Ordinamento per data crescente

    for (const file of files) {
      const fileYearMonth = file.split('-')[0] + '-' + file.split('-')[1];
      const cleanYearMonth = file.split('_')[0]; // Prende solo "YYYY-MM"
      const fileStartDate = new Date(`${cleanYearMonth}-01T00:00:00Z`);

      if (fileStartDate > endDate) {
        console.log('Uscita oltre periodo');
        // Siamo oltre il periodo
        break;
      }

      if (fileStartDate < startDate || fileStartDate <= endDate) {
        const monthData = await cacheManager.read(symbol, cleanYearMonth, '15Min');
        for (const candle of monthData) {
          const candleDate = new Date(candle.t);
          if (candleDate >= startDate && candleDate <= endDate) {
            result.push(candle);
          }
        }
      }
    }

    console.log(`[CACHE] Caricate ${result.length} candele dal ${startDate.toISOString()} al ${endDate.toISOString()}`);
    return result;
  }

  static getAnnualizedProfit(startDateStr, endDateStr, profit) {
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);

    let yearsDiff = end.getFullYear() - start.getFullYear();
    let monthsDiff = end.getMonth() - start.getMonth();
    let totalMonths = yearsDiff * 12 + monthsDiff;

    if (end.getDate() < start.getDate()) {
      totalMonths--;
    }


    if (totalMonths <= 0) {
      throw new Error("Date range must span at least one full month.");
    }

    const monthlyAverageProfit = profit / totalMonths;
    return monthlyAverageProfit * 12;
  }

    // shared/calcMediaMobileFromCache.js
  static async calcMediaMobileFromCache(symbol, currentDate, period, cacheManager) {
    let sum = 0;
    let count = 0;

    // Dati recenti
    let currentData = await cacheManager.getData(symbol, currentDate);
    if (!currentData) {
      console.warn(`[CACHE] Nessun dato per mese di ${currentDate.toISOString()}`);
      return null;
    }

    // Trova l'indice corrente nel mese
    const currentTimestamp = currentDate.getTime();
    const currentIndex = currentData.findIndex(d => new Date(d.t).getTime() >= currentTimestamp);

    if (currentIndex < period) {
      // Bisogna prendere dati anche dal mese precedente
      const prevDate = new Date(currentDate);
      prevDate.setMonth(prevDate.getMonth() - 1);
      const prevData = await cacheManager.getData(symbol, prevDate);

      const neededFromPrev = period - currentIndex;

      const prevSlice = prevData.slice(-neededFromPrev);
      const currentSlice = currentData.slice(0, currentIndex);

      const allCandles = [...prevSlice, ...currentSlice];

      if (allCandles.length < period) {
        return null; // Non abbiamo abbastanza dati
      }

      sum = allCandles.reduce((acc, candle) => acc + candle.c, 0);
      count = allCandles.length;
    } else {
      // Abbiamo abbastanza dati solo in questo mese
      const slice = currentData.slice(currentIndex - period, currentIndex);
      sum = slice.reduce((acc, candle) => acc + candle.c, 0);
      count = slice.length;
    }

    return sum / count;
  }

  static calcSMA(prices, period) {
    const result = [];
    let sum = 0;

    for (let i = 0; i < prices.length; i++) {
      sum += prices[i];
      if (i >= period) {
        sum -= prices[i - period];
        result[i] = sum / period;
      } else {
        result[i] = null;
      }
    }

    return result;
  }

  getMonthRange(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const months = [];
  
    let current = new Date(start);
    current.setDate(1);
  
    while (current <= end) {
      months.push({ year: current.getFullYear(), month: current.getMonth() + 1 });
      current.setMonth(current.getMonth() + 1);
    }
  
    return months;
  }
  
  static async backTest(symbol, startDate, endDate, key, secret) {
    const tf = '15Min';
  
    // 1. Leggi dalla cache, partendo dalla fine
    const { bars: cachedBars, missing } = await CacheManager.readRange(symbol, startDate, endDate, tf);
    let allBars = [...cachedBars || []];
  
    // 2. Recupera solo i mesi mancanti
    for (const { year, month } of missing) {
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const endObj = new Date(year, month, 0); // ultimo giorno del mese
      const end = endObj.toISOString().split('T')[0];
  
      let page_token = '';
      let monthBars = [];
  
      do {
        const url = `https://data.alpaca.markets/v2/stocks/bars?symbols=${symbol}&timeframe=${tf}&start=${start}&end=${end}&limit=5000&adjustment=raw&feed=sip&currency=USD&sort=asc`
          + (page_token ? `&page_token=${page_token}` : '');
  
        let res;
        try {
          res = await axios.get(url, {
            headers: {
              'APCA-API-KEY-ID': key,
              'APCA-API-SECRET-KEY': secret
            },
            timeout: 10000
          });
        } catch (error) {
          console.error(`[API ERROR] ${error.message}`);
          throw new Error(`[API ERROR] Fallita richiesta per ${year}-${month}`);
        }
  
        const bars = res.data.bars[symbol] || [];
        monthBars = monthBars.concat(bars);
        page_token = res.data.next_page_token;
      } while (page_token);
  
      await CacheManager.writeMonthly(symbol, tf, monthBars);
      allBars.push(...monthBars);
    }
  
    // 3. Ordina tutto per timestamp
    allBars.sort((a, b) => new Date(a.t) - new Date(b.t));
  
    return allBars;
  }


  static async initScenario(strategyParams, strategy) {
    const params_json = {MA : strategyParams.period, SL : strategyParams.SL, TP:strategyParams.TP}
    console.log(params_json);
    const connection = await this.getDbConnection();
    await connection.query(`
      INSERT INTO strategy_runs 
      (id, strategy, symbol, start_date, end_date, capital, status, started_at, params_json) 
      VALUES (?, ?, ?, ?, ?, ?, 'running', NOW(), ?)
    `, [strategyParams.id, strategy, strategyParams.symbol, strategyParams.startDate, strategyParams.endDate, strategyParams.capitaleIniziale, JSON.stringify(params_json)]);
    await connection.end();
  }
  
  static async writeFinalResult(strategyParams,  minDay, maxDay, capitaleFinale, profitto, efficienza) {

    const connection = await this.getDbConnection(); // apre qui!
    //const profit = (capitaleFinale / strategyParams.capitaleIniziale) - 1 || 0;
    const profittoAnnuo = StrategyUtils.getAnnualizedProfit(new Date(process.env.START_DATE), new Date(process.env.END_DATE), profitto) || 0;
    //const rapportoEfficienza = capitaleFinale === strategyParams.capitaleIniziale ? 0 : strategyParams.daysFree / (profitto * 100);
  
    await connection.query(`UPDATE strategy_runs
      SET 
        status = 'done',
        completed_at = NOW(),
        profit = ?,
        efficienza = ?,
        profittoAnnuo = ?,
        dayMin = ?,
        dayMax = ?
      WHERE id = ?`,
      [profitto, efficienza, profittoAnnuo, minDay, maxDay, strategyParams.id]);
      await connection.end();
  }
  
  static formatDateForMySQL(date) {
    const d = new Date(date);
  
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0'); // mesi da 0 a 11
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
  
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  static async writeBuy(scenarioId, element, state, result) {
    const connection = await this.getDbConnection(); // apre qui!
    await connection.query(`INSERT INTO transazioni 
      (ScenarioID, operationDate, operation, Price, capitale, days)
      VALUES (?, ?, 'BUY', ?, ?, ?)`,
      [scenarioId, this.formatDateForMySQL(element.t), result.prezzo, state.capitaleInvestito, result.days]);
      await connection.end();
  }

  static async writeSell(scenarioId, element, state, result) {
    const connection = await this.getDbConnection(); // apre qui!
    await connection.query(`INSERT INTO transazioni 
      (ScenarioID, operationDate, operation, Price, capitale, exit_reason, profitLoss, days)
      VALUES (?, ?, 'SELL', ?, ?, ?, ?, ?)`,
      [scenarioId, this.formatDateForMySQL(element.t), result.prezzo, state.capitaleLibero, result.motivo, result.profitLoss, result.days]);
      await connection.end();
  }
}

module.exports = StrategyUtils;