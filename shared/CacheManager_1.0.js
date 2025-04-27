const fs = require('fs');
const path = require('path');

class CacheManager {
  static getMonthlyCachePath(symbol, year, month, tf) {
    const dir = path.join(__dirname, '../cache', symbol);
    const file = `${year}-${String(month).padStart(2, '0')}_${tf}.json`;
    return path.join(dir, file);
  }

  static read(symbol, year, month, tf) {
    const filePath = this.getMonthlyCachePath(symbol, year, month, tf);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      console.log(`[CACHE] Lettura da: ${filePath}`);
      return JSON.parse(content);
    }
    return null;
  }

  static writeMonthly(symbol, tf, bars) {
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

  static readRange(symbol, startDate, endDate, tf) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const bars = [];
    const missing = [];

    let current = new Date(end);
    current.setDate(1); // primo del mese

    while (current >= start) {
      const year = current.getFullYear();
      const month = current.getMonth() + 1;
      const cached = this.read(symbol, year, month, tf);
      if (cached) {
        bars.push(...cached);
      } else {
        missing.unshift({ year, month });
      }
      current.setMonth(current.getMonth() - 1);
    }

    bars.sort((a, b) => new Date(a.t) - new Date(b.t));
    return { bars, missing };
  }
}

module.exports = CacheManager;
