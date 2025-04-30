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

  static async calcMediaMobileFromCache(symbol, currentDate, periodDays, cacheManager, tf='15Min') {
    let candles = [];
    let monthToLoad = new Date(currentDate);

    // 1 giorno = 6.5 ore di borsa USA (390 minuti)
    const minutesPerDayTrading = 390;

    // Estrai quanti minuti ha ogni candela dal TF dinamico
    const minutesPerCandle = parseInt(tf.replace('Min', '').replace('H', '') || 15);

    let candlesPerDay;
    if (tf.includes('Min')) {
        candlesPerDay = Math.floor(minutesPerDayTrading / minutesPerCandle);
    } else if (tf.includes('H')) {
        const hours = parseInt(tf.replace('H', ''));
        candlesPerDay = Math.floor(6.5 / hours);
    } else {
        throw new Error(`[ERROR] Timeframe non gestito: ${tf}`);
    }

    const candlesNeeded = periodDays * candlesPerDay;
    //console.log(`[CACHE] Servono circa ${candlesNeeded} candele (${periodDays} giorni, TF=${tf})`);

    while (candles.length < candlesNeeded) {
        const monthlyData = await cacheManager.getData(symbol, monthToLoad);

        if (monthlyData && monthlyData.length > 0) {
            const filtered = monthlyData.filter(c => new Date(c.t).getTime() < currentDate.getTime());
            candles = [...filtered, ...candles];
        } else {
            console.warn(`[CACHE] Nessun dato disponibile per ${monthToLoad.toISOString()}`);
        }

        monthToLoad.setMonth(monthToLoad.getMonth() - 1);

        if (monthToLoad.getFullYear() < 2000) {
            console.error("[CACHE] Troppo indietro nel tempo, dati insufficienti");
            return null;
        }
    }

    const lastCandles = candles.slice(-candlesNeeded);

    if (lastCandles.length < candlesNeeded) {
        console.warn(`[CACHE] Ancora dati insufficienti (${lastCandles.length}/${candlesNeeded})`);
        return null;
    }

    const sum = lastCandles.reduce((acc, c) => acc + c.c, 0);
    return sum / lastCandles.length;
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
    const params_json = {TF : strategyParams.tf, MA : strategyParams.period, SL : strategyParams.SL, TP:strategyParams.TP}
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

  static async writeBuy(scenarioId, element, state, result, operation='BUY') {
    const connection = await this.getDbConnection(); // apre qui!
    await connection.query(`INSERT INTO transazioni 
      (ScenarioID, operation, operationDate, Price, capitale, days, MA)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [scenarioId, operation, this.formatDateForMySQL(element.t), result.prezzo, state.capitaleInvestito, result.days, result.MA]);
      await connection.end();
  }

  static async getStrategy(symbol) {
    const connection = await this.getDbConnection(); // usa la tua funzione esistente di connessione
  
    try {
      const [rows] = await connection.query(`SELECT * FROM vstrategies WHERE status = 'active' AND symbol = ?`, [symbol]);
      return rows;
    } catch (error) {
      console.error('[DB ERROR] Errore durante il recupero delle strategie:', error.message);
      throw error;
    } finally {
      await connection.end(); // chiusura connessione in ogni caso
    }
  }

  static async getSymbolsList() {
    const connection = await this.getDbConnection(); // usa la tua funzione esistente di connessione
  
    try {
      const [rows] = await connection.query('SELECT name FROM Symbols');
      const symbols = rows.map(row => row.name);
      return symbols;
    } catch (error) {
      console.error('[DB ERROR] Errore durante il recupero dei simboli:', error.message);
      throw error;
    } finally {
      await connection.end(); // chiusura connessione in ogni caso
    }
  }

  static async writeSell(scenarioId, element, state, result) {
    const connection = await this.getDbConnection(); // apre qui!
    await connection.query(`INSERT INTO transazioni 
      (ScenarioID, operationDate, operation, Price, capitale, exit_reason, profitLoss, days)
      VALUES (?, ?, 'SELL', ?, ?, ?, ?, ?)`,
      [scenarioId, this.formatDateForMySQL(element.t), result.prezzo, state.capitaleLibero, result.motivo, result.profitLoss, result.days]);
      await connection.end();
  }

  static async insertOrder(orderData) {
    const connection = await this.getDbConnection(); // Assumo che esista già getDbConnection()

    const query = `
      INSERT INTO orders (
        id, client_order_id, created_at, updated_at, submitted_at, filled_at, expired_at, 
        canceled_at, failed_at, replaced_at, replaced_by, replaces, asset_id, symbol, 
        asset_class, notional, qty, filled_qty, filled_avg_price, order_class, 
        order_type, type, side, position_intent, time_in_force, limit_price, 
        stop_price, status, extended_hours, legs, trail_percent, trail_price, 
        hwm, subtag, source, expires_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `;

    const values = [
      orderData.id,
      orderData.client_order_id,
      orderData.created_at ? new Date(orderData.created_at) : null,
      orderData.updated_at ? new Date(orderData.updated_at) : null,
      orderData.submitted_at ? new Date(orderData.submitted_at) : null,
      orderData.filled_at ? new Date(orderData.filled_at) : null,
      orderData.expired_at ? new Date(orderData.expired_at) : null,
      orderData.canceled_at ? new Date(orderData.canceled_at) : null,
      orderData.failed_at ? new Date(orderData.failed_at) : null,
      orderData.replaced_at ? new Date(orderData.replaced_at) : null,
      orderData.replaced_by,
      orderData.replaces,
      orderData.asset_id,
      orderData.symbol,
      orderData.asset_class,
      orderData.notional,
      orderData.qty,
      orderData.filled_qty,
      orderData.filled_avg_price,
      orderData.order_class,
      orderData.order_type,
      orderData.type,
      orderData.side,
      orderData.position_intent,
      orderData.time_in_force,
      orderData.limit_price,
      orderData.stop_price,
      orderData.status,
      orderData.extended_hours ? 1 : 0, // booleano in MySQL
      orderData.legs ? JSON.stringify(orderData.legs) : null,
      orderData.trail_percent,
      orderData.trail_price,
      orderData.hwm,
      orderData.subtag,
      orderData.source,
      orderData.expires_at ? new Date(orderData.expires_at) : null
    ];

    try {
      await connection.query(query, values);
    } catch (err) {
      console.error(`[DB ERROR] Inserimento ordine fallito: ${err.message}`);
      console.error(err);
      throw err;
    } finally {
      await connection.end();
    }
  }

}

module.exports = StrategyUtils;