const fs = require('fs');
const path = require('path');
const axios = require('axios');
const dayjs = require('dayjs');
const isoWeek = require('dayjs/plugin/isoWeek');
dayjs.extend(isoWeek);
const { initializeSettings, getSetting } = require('../shared/loadSettings');
const createLogger = require('../shared/logger');
const cache = require('../shared/cache');

// Costanti globali di modulo
const MICROSERVICE = 'CacheManager';
const MODULE_NAME = 'CacheManager';
const MODULE_VERSION = '2.0';

 
class CacheManager {
  constructor() {
    this.dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
    this.cacheBasePath = './cache';
    this.apiKey = process.env.APCA_API_KEY_ID;
    this.apiSecret = process.env.APCA_API_SECRET_KEY;
    this.logLevel = process.env.LOG_LEVEL || 'info'
    this.logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, this.logLevel);
    this.L1Hit=0;
    this.L2Hit=0;
    this.L3Hit=0;
  }

  async init() {
    this.logger.info('[init] Inizializzazione componenti...');
    // Inizzializzo la connessione con getSetting
    await initializeSettings(this.dbManagerUrl);

    this.tf = getSetting('TF-DEFAULT') || '15Min';
    this.feed = getSetting('ALPACA-HISTORICAL-FEED') || 'sip';
    this.restUrl = getSetting('ALPACA-LIVE-BASE') || 'https://data.alpaca.markets';
    this.timeout = parseInt(getSetting('ALPACA-API-TIMEOUT')) || 10000;
    this.maxWeek = Number(getSetting('ALPACA-API-TIMEOUT')) || 8;
  }

  async setParamSetting(paramKey, defaultValue = null) {
    await initializeSettings(this.dbManagerUrl);

    const paramMap = {
      'TF-DEFAULT': 'tf',
      'ALPACA-HISTORICAL-FEED': 'feed',
      'ALPACA-LIVE-BASE': 'restUrl',
      'ALPACA-API-TIMEOUT': 'timeout',
      'CACHE-L1-MAXWEEK': 'maxWeek'
    };

    try {
      const value = getSetting(paramKey);
      const propName = paramMap[paramKey];
      const finalValue = value !== null ? value : defaultValue;
      this[propName] = paramKey === 'ALPACA-API-TIMEOUT' ? parseInt(finalValue) : finalValue;
      this[propName] = paramKey === 'CACHE-L1-MAXWEEK' ? Number(finalValue) : finalValue;
      return finalValue;
    } catch (err) {
        this.logger.warning(`[getParamSetting] Errore su ${paramKey}: ${err.message}`);
        const propName = paramMap[paramKey];
        this[propName] = defaultValue;
        return defaultValue;
    }
  }

  getCacheHits() {
    return({
      L1 : this.L1Hit,
      L2 : this.L2Hit,
      L3 : this.L3Hit
    })
  }

  resetCacheHits() {
    this.L1Hit=0;
    this.L2Hit=0;
    this.L3Hit=0;
  }

  getParams() {
    return(
      {
        tf: this.tf,
        feed: this.feed,
        restUrl : this.restUrl,
        timeout: this.timeout,
        maxWeek: this.maxWeek
      }
    )
  }

  getLogLevel() { return this.logLevel; }
  setLogLevel(level) {
    this.logLevel = level;
    this.logger.setLevel(this.logLevel);
  }


  // Ritorna le informazioni del modulo
  getInfo() {
    return {
      microservice: MICROSERVICE,
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
      this.L2Hit++;
      const content = await fs.promises.readFile(filePath, 'utf8');
      this.logger.log(`[CACHE L2][HIT] ${filePath}`);
      return JSON.parse(content);
    } else {
      this.logger.warning(`[CACHE L2][MISS] ${filePath}`);
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
      this.logger.log(`[CACHE L2][WRITE] ${filePath}`);
    }
  }

  async retrieveCandlesFromL1(symbol, startDate, endDate, tf) {
    const start = dayjs(startDate).startOf('day');
    const end = dayjs(endDate).endOf('day');
    const allBars = [];
    const indexKey = `candles:index:${symbol}:${tf}`;


    const weeks = [];
    let current = start.startOf('isoWeek');
    while (current.isBefore(end)) {
      weeks.push({ 
        year: current.year(), 
        week: current.isoWeek(), 
        start: current.toDate(), 
        end: current.endOf('isoWeek').toDate() });
      current = current.add(1, 'week');
    }

    for (const { year, week, start: weekStart, end: weekEnd } of weeks) {
      const redisKey = `candles:${symbol}:${tf}:${week}.${year}`;
      const cached = await cache.get(redisKey);

      if (cached) {
        this.L1Hit++;
        this.logger.log(`[CACHE L1][HIT] ${redisKey}`);
        allBars.push(...JSON.parse(cached));
      } else {
        this.logger.log(`[CACHE L1][MISS] ${redisKey}, fallback su L2`);
        const bars = await this.retrieveCandlesFromL2(symbol, weekStart, weekEnd, tf);
          if (bars?.length) {
            allBars.push(...bars);
            this.logger.log(`[CACHE L1][WRITE] ${redisKey}`);
            await cache.setp(redisKey, JSON.stringify(bars));
            await cache.lPush(indexKey, redisKey);
            await cache.lTrim(indexKey, 0, Number(this.maxWeek) - 1);
            await cache.setp(redisKey, JSON.stringify(bars));

            // Elimina eventuali chiavi fuori limite
            const currentKeys = await cache.lRange(indexKey, Number(this.maxWeek), -1);
            for (const keyToDelete of currentKeys) {
              await cache.del(keyToDelete);
              this.logger.debug(`[retrieveCandlesFromL1][DELETE CACHE] Pulizia chiave vecchia: ${keyToDelete}`);
          }  
        }
      }
    }

    // Filtra le candele effettivamente richieste
    return allBars.filter(bar => {
      const t = dayjs(bar.t);
      return t.isAfter(start.subtract(1, 'ms')) && t.isBefore(end.add(1, 'ms'));
    }).sort((a, b) => new Date(a.t) - new Date(b.t));
  }

  async retrieveCandlesFromL2(symbol, startDate, endDate, tf) {
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
        this.logger.info(`Recupero dati mancanti da Alpaca : ${url}`);
        try {
          this.L3Hit++;
          res = await axios.get(url, {
            headers: {
              'APCA-API-KEY-ID': this.apiKey,
              'APCA-API-SECRET-KEY': this.apiSecret
            },
            timeout: this.timeout
          });
        } catch (error) {
          this.logger.error(`[API][${year}-${month}] ${error.message}`);
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



  /********* Funzioni stats per L2 ******************************/
  async getDirStatsL2() {
   const results = {};

    const subdirs = fs.readdirSync(this.cacheBasePath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory());

    for (const dirent of subdirs) {
      const dirPath = path.join(this.cacheBasePath, dirent.name);
      let fileCount = 0;
      let totalSize = 0;

      const files = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const file of files) {
        if (file.isFile()) {
          const filePath = path.join(dirPath, file.name);
          const { size } = fs.statSync(filePath);
          totalSize += size;
          fileCount++;
        }
      }

      // Aggiungi solo se c'è almeno un file
      if (fileCount > 0) {
        results[dirent.name] = {
          fileCount,
          totalSizeBytes: totalSize,
        };
      }
    }
    
    this.logger.trace(`[getDirStatsL2] results: ${JSON.stringify(results)}`);

    return results;
  }


  async listFilesL2(symbol) {
    const subdirPath = path.join(this.cacheBasePath, symbol);

    if (!fs.existsSync(subdirPath)) {
      this.logger.warning(`[listFilesL2] Symbol "${dirPath}" non trovato`);
      throw new Error(`Symbol "${subdirPath}" not found`);
    }

    const entries = fs.readdirSync(subdirPath, { withFileTypes: true });
    const files = entries
      .filter(entry => entry.isFile())
      .map(entry => {
        const match = entry.name.match(/^(\d{4})-(\d{2})_(\w+)\.json$/);
        if (match) {
          return {
            Anno: match[1],
            Mese: match[2],
            TF: match[3],
            nomeFile: entry.name
          };
        }
        return null;
      })
      .filter(Boolean);

    return files;
  }

  async deleteMatchingFiles(symbol, body ) {
    const { Anno, Mese, TF } = body;
    this.logger.info(`[deleteMatchingFiles] Funzione richiamata con Anno ${Anno}, Mese ${Mese} TF ${TF}`);

    const dirPath = path.join(this.cacheBasePath, symbol);

    if (!fs.existsSync(dirPath)) {
      this.logger.warning(`[deleteMatchingFiles] Symbol "${dirPath}" non trovato`);
      throw new Error(`Symbol "${dirPath}" non trovato`);
    } 

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const match = entry.name.match(/^(\d{4})-(\d{2})_(\w+)\.json$/);
      if (!match) continue;

      const [ , fileAnno, fileMese, fileTF ] = match;

      const matchAnno = !Anno || Anno === fileAnno;
      const matchMese = !Mese || Mese === fileMese;
      const matchTF = !TF || TF === fileTF;

      if (matchAnno && matchMese && matchTF) {
        const fullPath = path.join(dirPath, entry.name);
        fs.unlinkSync(fullPath);
        this.logger.log(`[deleteMatchingFiles] Deleted: ${entry.name}`);
      }
    }
  }


  async deleteAllCacheL2() {

    if (!fs.existsSync(this.cacheBasePath)) {
      this.logger.warning(`[deleteAllCacheL2]  symbol "${this.cacheBasePath}" non trovata`);
      return;
    }

    const subDirs = fs.readdirSync(this.cacheBasePath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const dir of subDirs) {
      const fullPath = path.join(this.cacheBasePath, dir);
      const files = fs.readdirSync(fullPath, { withFileTypes: true })
        .filter(f => f.isFile())
        .map(f => f.name);

      for (const file of files) {
        const filePath = path.join(fullPath, file);
        fs.unlinkSync(filePath);
        this.logger.log(`[deleteAllCacheL2]  Deleted: ${filePath}`);
      }
    }
  }

/********* Funzioni stats per L1 ******************************/
  async getStatL1() {
    const pattern = 'candles:*:*:*.*';
    const keys = await cache.keys(pattern);
    const results = [];

    for (const key of keys) {
      const parts = key.split(':');
      if (parts.length !== 4) continue;

      const [, symbol, tf, weekYear] = parts;
      const [week, year] = weekYear.split('.');
      let size = 0;

      try {
        size = await cache.client.memoryUsage(key) || 0;
      } catch (err) {
        this.logger.warning(`[getStatL1] Errore MEMORY USAGE per ${key}:`, err.message);
      }

      results.push({ symbol, tf, week, year, key, sizeBytes: size });
    }

    return results;
  }

  async deleteCandlesKeysL1({ symbol, tf, week, year }) {
    // Costruzione pattern con wildcard
    const s = symbol || '*';
    const t = tf || '*';
    const w = week || '*';
    const y = year || '*';

    const pattern = `candles:${s}:${t}:${w}.${y}`;
    const keys = await cache.keys(pattern);

    if (keys.length === 0) {
      this.logger.log('[deleteCandlesKeysL1] Nessuna chiave trovata con il pattern:', pattern);
      return;
    }

    this.logger.info(`[deleteCandlesKeysL1] Rimozione di ${keys.length} chiavi...`);
    for (const key of keys) {
      await cache.del(key);
    }
    this.logger.log('[deleteCandlesKeysL1] Eliminazione completata.');
  }

  async getRedisInfo(){
    const infoOutput = await cache.client.info();
    const lines = infoOutput.split('\n');
    const result = {};
    let currentSection = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('#')) {
        // Sezione (es. "# Memory")
        currentSection = trimmed.substring(2).toLowerCase(); // "memory"
        result[currentSection] = {};
      } else if (trimmed && trimmed.includes(':')) {
        const [key, value] = trimmed.split(':');
        if (currentSection) {
          result[currentSection][key] = isNaN(value) ? value : Number(value);
        } else {
          result[key] = isNaN(value) ? value : Number(value);
        }
      }
    }

    return result;
  }

  

    

}

module.exports = CacheManager;
