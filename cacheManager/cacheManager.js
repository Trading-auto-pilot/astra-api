const fs = require('fs');
const path = require('path');
const axios = require('axios');
const createLogger = require('../shared/logger');

// Costanti globali di modulo
const MICROSERVICE = 'CacheManager';
const MODULE_NAME = 'CacheManager';
const MODULE_VERSION = '1.2';
const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');
 
class CacheManager {
  constructor(options) {
    this.cacheBasePath = options.cacheBasePath || './cache';
    this.tf = options.tf || '15Min';
    this.feed = options.feed || 'sip';
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.restUrl = options.restUrl || 'https://data.alpaca.markets';
    this.timeout = parseInt(options.timeout) || 10000;

    // Log delle variabili definite nell'istanza
    for (const key of Object.keys(this)) {
        // Esclude i metodi (funzioni)
        if (typeof this[key] !== 'function') {
        logger.trace(`[init] Variabile ${key} =`, this[key]);
        }
    }
  }

  // Ritorna le informazioni del modulo
  getInfo() {
    return {
      module: MODULE_NAME,
      version: MODULE_VERSION,
      logLevel: process.env.LOG_LEVEL,
      status: 'OK'
    };
  }
 
  _getCacheFilePath(symbol, year, month) {
    return path.join(this.cacheBasePath, symbol, `${year}-${String(month).padStart(2, '0')}_${this.tf}.json`);
  }

  async _read(symbol, year, month) {
    const filePath = this._getCacheFilePath(symbol, year, month);
    if (fs.existsSync(filePath)) {
      const content = await fs.promises.readFile(filePath, 'utf8');
      logger.log(`[CACHE][READ] ${filePath}`);
      return JSON.parse(content);
    } else {
      logger.warning(`[CACHE][MISS] ${filePath}`);
      return null;
    }
  }

  async _writeMonthly(symbol, bars) {
    const grouped = {};

    bars.forEach(bar => {
      const date = new Date(bar.t);
      const y = date.getFullYear();
      const m = date.getMonth() + 1;
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(bar);
    });

    for (const key in grouped) {
      const [year, month] = key.split('-');
      const filePath = this._getCacheFilePath(symbol, year, month);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await fs.promises.writeFile(filePath, JSON.stringify(grouped[key]));
      logger.log(`[CACHE][WRITE] ${filePath}`);
    }
  }

  async retrieveCandles(symbol, startDate, endDate, tf) {
    let start = new Date(startDate);
    let end = new Date(endDate);
    this.tf=tf;


    let allBars = [];
    let missing = [];

    let current = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);

    while (current <= endMonth) {
      const year = current.getFullYear();
      const month = current.getMonth() + 1;
      const cached = await this._read(symbol, year, month);
      if (cached && Array.isArray(cached)) {
        allBars.push(...cached);
      } else {
        missing.unshift({ year, month });
      }
      current.setMonth(current.getMonth() + 1);
    }

    for (const { year, month } of missing) {
      const rangeStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).toISOString().split('T')[0];
      let page_token = '';
      let monthBars = [];

      do {
        const url = `${this.restUrl}/v2/stocks/bars?symbols=${symbol}&timeframe=${this.tf}&start=${rangeStart}&end=${lastDay}&limit=5000&adjustment=raw&feed=${this.feed}&currency=USD&sort=asc${page_token ? `&page_token=${page_token}` : ''}`;
        let res;
        logger.trace(`Recupero dati mancanti da Alpaca : ${url}`);
        try {
          res = await axios.get(url, {
            headers: {
              'APCA-API-KEY-ID': this.apiKey,
              'APCA-API-SECRET-KEY': this.apiSecret
            },
            timeout: this.timeout
          });
        } catch (error) {
          logger.error(`[API][${year}-${month}] ${error.message}`);
          throw new Error(`[API ERROR] Fallita richiesta per ${symbol} - ${year}-${month}`);
        }

        const bars = res.data.bars?.[symbol] || [];
        monthBars = monthBars.concat(bars);
        page_token = res.data.next_page_token;
      } while (page_token);

      await this._writeMonthly(symbol, monthBars);
      allBars.push(...monthBars);
    }

    allBars.sort((a, b) => new Date(a.t) - new Date(b.t));

    
    
    const filtered = allBars.filter(bar => {
      const time = new Date(bar.t).getTime();
      return time >= start.getTime() && time <= end.getTime();
    });
    return filtered;
  }
}

module.exports = CacheManager;
