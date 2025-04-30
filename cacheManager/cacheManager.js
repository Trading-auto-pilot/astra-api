const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Costanti globali di modulo
const MODULE_NAME = 'CacheManager';
const MODULE_VERSION = '1.0';

class CacheManager {
  constructor(options) {
    this.cacheBasePath = options.cacheBasePath || './cache';
    this.tf = options.tf || '15Min';
    this.feed = options.feed || 'sip';
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.restUrl = options.restUrl || 'https://data.alpaca.markets';
    this.timeout = parseInt(options.timeout) || 10000;
  }

  // Ritorna le informazioni del modulo
  getInfo() {
    return {
      module: MODULE_NAME,
      version: MODULE_VERSION,
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
      console.log(`[CACHE][READ] ${filePath}`);
      return JSON.parse(content);
    } else {
      console.warn(`[CACHE][MISS] ${filePath}`);
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
      console.log(`[CACHE][WRITE] ${filePath}`);
    }
  }

  async retrieveCandles(symbol, startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    let allBars = [];
    let missing = [];

    let current = new Date(end);
    current.setDate(1);

    while (current >= start) {
      const year = current.getFullYear();
      const month = current.getMonth() + 1;
      const cached = await this._read(symbol, year, month);
      if (cached && Array.isArray(cached)) {
        allBars.push(...cached);
      } else {
        missing.unshift({ year, month });
      }
      current.setMonth(current.getMonth() - 1);
    }

    for (const { year, month } of missing) {
      const rangeStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).toISOString().split('T')[0];
      let page_token = '';
      let monthBars = [];

      do {
        const url = `${this.restUrl}/v2/stocks/bars?symbols=${symbol}&timeframe=${this.tf}&start=${rangeStart}&end=${lastDay}&limit=5000&adjustment=raw&feed=${this.feed}&currency=USD&sort=asc${page_token ? `&page_token=${page_token}` : ''}`;

        let res;
        try {
          res = await axios.get(url, {
            headers: {
              'APCA-API-KEY-ID': this.apiKey,
              'APCA-API-SECRET-KEY': this.apiSecret
            },
            timeout: this.timeout
          });
        } catch (error) {
          console.error(`[API][${year}-${month}] ${error.message}`);
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
    return allBars.filter(bar => new Date(bar.t) >= start && new Date(bar.t) <= end);
  }
}

module.exports = CacheManager;
