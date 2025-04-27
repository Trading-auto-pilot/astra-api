// shared/cacheManager.js
const fs = require('fs');
const path = require('path');

class CacheManager {
  constructor(cacheBasePath) {
    this.cacheBasePath = cacheBasePath;
    this.loadedData = {}; // cache in memoria { "MSFT-2024-01": [...] }
  }

  _getCacheFilePath(symbol, year, month) {
    return path.join(this.cacheBasePath, symbol, `${year}-${month.toString().padStart(2, '0')}_15Min.json`);
  }

  async loadMonth(symbol, year, month) {
    //const key = `${symbol}-${year}-${month}`;
    const key = `${symbol}-${year}-${month.toString().padStart(2, '0')}`; 
    if (this.loadedData[key]) {
      return this.loadedData[key];
    }

    const filePath = this._getCacheFilePath(symbol, year, month);

    if (!fs.existsSync(filePath)) {
      console.warn(`[CACHE] File non trovato: ${filePath}`);
      return [];
    }

    const fileContent = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(fileContent);
    this.loadedData[key] = parsed;
    console.log(`[CACHE] Caricato ${filePath} (${parsed.length} records)`);
    return parsed;
  }

  async getData(symbol, date) {
    const year = date.getFullYear();
    //const month = date.getMonth() + 1; // JS months = 0-11
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return await this.loadMonth(symbol, year, month);
  }

  static async writeMonthly(symbol, tf, bars) {
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
      const filePath = this.getMonthlyCachePath(symbol, year, month, tf);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(grouped[key]));
      console.log(`[CACHE] Salvato: ${filePath}`);
    }
  }

  static async readRange(symbol, startDate, endDate, tf) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const bars = [];
    const missing = [];

    let current = new Date(end);
    current.setDate(1); // primo del mese

    while (current >= start) {
      const year = current.getFullYear();
      const month = current.getMonth() + 1;
      const cached = await this.read(symbol, year, month, tf);
      if (cached && Array.isArray(cached)) {
        bars.push(...cached);
      } else {
        missing.unshift({ year, month });
      }
      current.setMonth(current.getMonth() - 1);
    }

    bars.sort((a, b) => new Date(a.t) - new Date(b.t));
    return { bars, missing };
  }

  static getMonthlyCachePath(symbol, year, month, tf) {
    const dir = path.join(__dirname, '../cache', symbol);
    const file = `${year}-${String(month).padStart(2, '0')}_${tf}.json`;
    return path.join(dir, file);
  }


  static async read(symbol, year, month, tf) {
    const filePath = this.getMonthlyCachePath(symbol, year, month, tf);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      console.log(`[CACHE] Lettura da: ${filePath}`);
      return JSON.parse(content);
    }
    return null;
  }

}

module.exports = CacheManager;
