// modules/main.js — TEMPLATE DEFINITIVO
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const createLogger = require("../../shared/logger");
const { initializeSettings, getSetting, reloadSettings } = require("../../shared/loadSettings");
const { RedisBus } = require("../../shared/redisBus");
const { asBool, asInt } = require("../../shared/helpers");
const { AlpacaProvider } = require("./alpaca");
const { FmpProvider } = require("./fmp");
const fs = require('fs');

// =========================================================
// PLACEHOLDER da sostituire via script di scaffolding
// =========================================================
const MICROSERVICE    = "cacheManager";
const MODULE_NAME     = "main";
const MODULE_VERSION  = "0.1.0";    // e.g. "0.1.0"

class CacheManager {
  constructor() {
  
    // =====================================================
    // URL DI TUTTI I MICROSERVIZI STANDARD DEL SISTEMA
    // =====================================================

    //     // Auto-generated service URLs from doc/ports.json
    this.dbmanagerUrl = process.env.DBMANAGER_URL || "http://dbmanager:3002";
    this.marketsimulatorUrl = process.env.MARKETSIMULATOR_URL || "http://marketsimulator:3003";
    this.ordersimulatorUrl = process.env.ORDERSIMULATOR_URL || "http://ordersimulator:3004";
    this.orderlistnerUrl = process.env.ORDERLISTNER_URL || "http://orderlistner:3005";
    this.cachemanagerUrl = process.env.CACHEMANAGER_URL || "http://cachemanager:3006";
    this.strategyUtilsUrl = process.env.STRATEGYUTILS_URL || "http://strategyUtils:3007";
    this.alertingserviceUrl = process.env.ALERTINGSERVICE_URL || "http://alertingservice:3008";
    this.capitalmanagerUrl = process.env.CAPITALMANAGER_URL || "http://capitalmanager:3009";
    this.smaUrl = process.env.SMA_URL || "http://sma:3010";
    this.sltpUrl = process.env.SLTP_URL || "http://sltp:3011";
    this.livemarketlistnerUrl = process.env.LIVEMARKETLISTNER_URL || "http://livemarketlistner:3012";
    this.tickerscannerUrl = process.env.TICKERSCANNER_URL || "http://tickerscanner:3013";

    this.cacheBasePath="./cache";

    // =====================================================
    // Ambiente
    // =====================================================
    this.env = process.env.ENV || "DEV";

    // =====================================================
    // Canali Redis standard
    // =====================================================
    this.redisTelemetyChannel = `${this.env}.${MICROSERVICE}.telemetry`;
    this.redisStatusChannel   = `${this.env}.${MICROSERVICE}.status`;
    this.redisDataChannel     = `${this.env}.${MICROSERVICE}.data`;
    this.redisLogsChannel     = `${this.env}.${MICROSERVICE}.logs`;

    // Stato del modulo
    this._status       = "STARTING";
    this.statusDetails = null;

    // =====================================================
    // Configurazione standard dei canali del Redis Bus
    // =====================================================
    this.communicationChannels = {
      telemetry: { on: true, params: { intervalsMs: 1000 } },
      metrics:   { on: true, params: { intervalsMs: 1000 } },
      data:      { on: true, params: { intervalsMs: 0    } },
      logs:      { on: true, params: { intervalsMs: 0    } },
    };

    // =====================================================
    // Redis BUS
    // =====================================================
    this.bus = new RedisBus({
      channels: this.communicationChannels,
      name: MICROSERVICE
    });

    // =====================================================
    // LOGGER
    // =====================================================
    this.logger = createLogger(
      MICROSERVICE,
      MODULE_NAME,
      MODULE_VERSION,
      process.env.LOG_LEVEL || "info",
      {
        bus: null,
        busTopicPrefix: this.env,
        console: true,
        enqueueDb: true,
      }
    );

    this.bus.setLogger(this.logger);

    // Mini storage per metriche locali
    this.metrics = [];

    this.providerType = (process.env.HISTORICAL_PROVIDER || "FMP").toUpperCase();

    if (this.providerType === "ALPACA") {
      this.alpaca = new AlpacaProvider({
        apiKey: process.env.APCA_API_KEY_ID,
        apiSecret: process.env.APCA_API_SECRET_KEY,
        feed: process.env.ALPACA_MARKET_FEED || "sip",
        logger: this.logger,
      });
      this.logger.info("[CacheManager] Provider storico: ALPACA");
    } else if (this.providerType === "FMP") {
      this.fmp = new FmpProvider({
        apiKey: process.env.FMP_API_KEY,
        logger: this.logger,
      });
      this.logger.info("[CacheManager] Provider storico: FMP");
    } else {
      this.logger.error(
        `[CacheManager] Provider storico sconosciuto: ${this.providerType}`
      );
    }
  
  }

  // =========================================================
  // init(): logger + redis + settings dal DB
  // =========================================================
  async init() {
    this.logger.info("[init] Initializing...");

    // 1) CONNECT REDIS BUS
    await this.bus.connect();
    this.logger.attachBus(this.bus);

    // STATUS: STARTING
    await this.bus.publish(this.redisStatusChannel, {
      status: "STARTING",
      details: "Loading DB settings"
    });

    // 2) LOAD SETTINGS DAL DB
    const ok = await initializeSettings(this.dbmanagerUrl);
    if (!ok) {
      this._status = "ERROR";
      this.statusDetails = "DB unreachable";
      await this.bus.publish(this.redisStatusChannel, {
        status: this._status,
        details: this.statusDetails
      });

      this.logger.error("[init] Failed DB initialization");
      process.exit(1);
    }

    // 3) APPLY COMMON SETTINGS
    this.delayBetweenMessages = asInt(
      getSetting("PROCESS_DELAY_BETWEEN_MESSAGES"),
      500
    );

    this.logger.info(
      `[init] Settings loaded: delayBetweenMessages=${this.delayBetweenMessages}`
    );

    // 4) HOOK EVENTUALE
    await this.afterInit();

    // 5) READY
    this._status = "READY";
    this.statusDetails = "Initialization complete";

    await this.bus.publish(this.redisStatusChannel, {
      status: this._status,
      details: this.statusDetails
    });
  }

  // =========================================================
  // Hook custom per ogni microservizio (override)
  // =========================================================
  async afterInit() {
    this.logger.info("[afterInit] No custom logic implemented (template).");
  }


  async  getReleaseInfo() {
    const filePath = path.resolve(__dirname, "..", "release.json");
    console.log(filePath)
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`Errore lettura release.json: ${err.message}`);
    }
  }
  
  /**
   * Ricarica i settings da DB senza riavviare il servizio.
   */
  async reloadSettings() {
    this.logger.info("[reloadSettings] Reloading settings from DB...");
    const ok = await reloadSettings(this.dbmanagerUrl);
    if (!ok) {
      this.logger.error("[reloadSettings] Failed to reload settings from DB");
      throw new Error("reloadSettings failed");
    }

    this.delayBetweenMessages = asInt(
      getSetting("PROCESS_DELAY_BETWEEN_MESSAGES"),
      500
    );

    this.logger.info(
      `[reloadSettings] Settings reloaded: delayBetweenMessages=${this.delayBetweenMessages}`
    );

    if (typeof this.afterSettingsReload === "function") {
      await this.afterSettingsReload();
    }

    return {
      ok: true,
      delayBetweenMessages: this.delayBetweenMessages,
    };
  }

  // =========================================================
  // METRICHE GENERICHE
  // =========================================================
  getMetricsSnapshot(max = 100) {
    return this.metrics.slice(-max);
  }

  pushMetric(metric) {
    metric.ts = Date.now();
    this.metrics.push(metric);
    if (this.metrics.length > 2000) this.metrics.shift();
  }

  // =========================================================
  // Aggiornamento dinamico dei channel config
  // =========================================================
  normalizeChannels(inCfg = {}, prev = {}) {
    const ms = (v, d = 500) => Number(v ?? d) || d;

    const norm = (k) => ({
      on: !!inCfg?.[k]?.on ?? prev?.[k]?.on ?? true,
      params: {
        intervalsMs: ms(
          inCfg?.[k]?.params?.intervalsMs ??
          prev?.[k]?.params?.intervalsMs ??
          500
        ),
      },
    });

    return {
      telemetry: norm("telemetry"),
      metrics:   norm("metrics"),
      data:      norm("data"),
      logs:      norm("logs"),
    };
  }

  async updateCommunicationChannel(newConf) {
    const cfg = this.normalizeChannels(newConf, this.communicationChannels);

    this.communicationChannels = cfg;

    // applica config al BUS
    await this.bus.applyChannels?.(cfg);

    this.bus.setChannelConfig("telemetry", cfg.telemetry);
    this.bus.setChannelConfig("metrics",   cfg.metrics);
    this.bus.setChannelConfig("data",      cfg.data);
    this.bus.setChannelConfig("logs",      cfg.logs);

    this.logger.info(
      `[channels] telemetry=${cfg.telemetry.on} metrics=${cfg.metrics.on} data=${cfg.data.on} logs=${cfg.logs.on}`
    );

    return { ok: true, channels: cfg };
  }

  // =========================================================
  // GET INFO STANDARDIZZATO
  // =========================================================
  getInfo() {
    return {
      MICROSERVICE,
      MODULE_NAME,
      MODULE_VERSION,
      STATUS: this._status,
      STATUS_DETAILS: this.statusDetails,
      ENV: this.env,
      communicationChannels: this.communicationChannels,
      BusChannels: {
        telemetry: this.redisTelemetyChannel,
        status:    this.redisStatusChannel,
        data:      this.redisDataChannel,
        logs:      this.redisLogsChannel,
      },
    };
  }

  // =========================================================
  // SHUTDOWN
  // =========================================================
  async disconnect() {
    this.logger.info("[disconnect] Shutting down...");

    try {
      await this.bus.close();
    } catch (e) {
      this.logger.error("[disconnect] Error closing RedisBus", e);
    }

    this._status = "STOPPED";
    return this._status;
  }

  // =========================================================
  // DB Logger API (usata da /dbLogger nel server.js)
  // =========================================================
  getDbLogStatus() {
    // Se il logger supporta questa API, la usiamo
    if (typeof this.logger.getDbLogStatus === "function") {
      return this.logger.getDbLogStatus();
    }
    // Fallback neutro
    return { dbLogEnabled: false };
  }

  setDbLogStatus(status) {
    if (typeof this.logger.setDbLogStatus === "function") {
      return this.logger.setDbLogStatus(status);
    }
    this.logger.warn("[setDbLogStatus] Not supported by this logger", { status });
    return { dbLogEnabled: false };
  }

  // Accesso diretto
  getBus()    { return this.bus; }
  getLogger() { return this.logger; }
  get status() { return this._status; }


  // =========================================================
  // CANDLE CACHE: L3 (Redis) -> L2 (FS) -> L1 (Provider)
  // =========================================================

  async getCandles(symbol, startDate, endDate, tf = "1Day") {
    this.logger.info(
      `[getCandles] Richiesta candele ${symbol} ${startDate} → ${endDate} tf=${tf}`
    );

    // -------------------------------------------------------
    // 1) L3 - Redis
    // -------------------------------------------------------
    const l3Candles = await this._readL3(symbol, tf, startDate, endDate);
    this.logger.log(
      `[getCandles] L3 ha restituito ${l3Candles.length} candele per ${symbol}`
    );

    let collected = [...l3Candles];

    let missingRanges = this._detectMissingRanges(
      l3Candles,
      startDate,
      endDate,
      tf
    );
    this.logger.log(
      `[getCandles] Intervalli mancanti dopo L3: ${JSON.stringify(
        missingRanges
      )}`
    );

    // Se L3 ha coperto tutto → ritorno diretto
    if (missingRanges.length === 0 && l3Candles.length > 0) {
      this.logger.info(
        `[getCandles] Tutte le candele trovate in L3 (Redis) per ${symbol}`
      );
      return this._filterCandlesByRange(collected, startDate, endDate);
    }

    // -------------------------------------------------------
    // 2) Per ogni intervallo mancante: L2 -> L1
    // -------------------------------------------------------
    for (const range of missingRanges) {
      const { from, to } = range;
      this.logger.info(
        `[getCandles] Recupero intervallo mancante ${symbol} ${from} → ${to}`
      );

      // 2a) L2 - File system
      const l2Candles = await this._readL2(symbol, from, to, tf);
      this.logger.log(
        `[getCandles] L2 ha restituito ${l2Candles.length} candele per ${symbol} ${from}→${to}`
      );

      collected.push(...l2Candles);

      const subMissing = this._detectMissingRanges(
        l2Candles,
        from,
        to,
        tf
      );
      this.logger.log(
        `[getCandles] Intervalli mancanti dopo L2 per ${symbol} ${from}→${to}: ${JSON.stringify(
          subMissing
        )}`
      );

      // Se L2 copre tutto questo sotto-range → aggiorno solo L3
      if (subMissing.length === 0 && l2Candles.length > 0) {
        this.logger.info(
          `[getCandles] Intervallo ${from}→${to} soddisfatto da L2, aggiorno L3`
        );
        await this._writeL3(symbol, tf, collected);
        continue;
      }

      // 2b) Provider remoto per la parte mancante
      for (const sub of subMissing) {
        const { from: pFrom, to: pTo } = sub;
        this.logger.warning(
          `[getCandles] Intervallo ${pFrom}→${pTo} mancante anche in L2, uso provider remoto`
        );

        const providerCandles = await this._retrieveFromProvider(
          symbol,
          pFrom,
          pTo,
          tf
        );

        this.logger.info(
          `[getCandles] Provider remoto ha restituito ${providerCandles.length} candele per ${symbol} ${pFrom}→${pTo}`
        );

        // Salvo in L2 + L3 (merge)
        await this._writeL2(symbol, tf, providerCandles);
        collected.push(...providerCandles);
        await this._writeL3(symbol, tf, collected);
      }
    }

    // -------------------------------------------------------
    // 3) Ordino e filtro sul range richiesto
    // -------------------------------------------------------
    collected.sort((a, b) => new Date(a.t) - new Date(b.t));

    const filtered = this._filterCandlesByRange(
      collected,
      startDate,
      endDate
    );

    this.logger.info(
      `[getCandles] Totale candele restituite per ${symbol} ${startDate}→${endDate}: ${filtered.length}`
    );

    return filtered;
  }

  // ---------------------- Helpers comuni -------------------

  _buildL3Key(symbol, tf) {
    return `candles:${symbol}:${tf}`;
  }

  _filterCandlesByRange(candles, startDate, endDate) {
    const startTs = new Date(startDate).getTime();
    const endTs = new Date(endDate).getTime();

    return candles.filter((c) => {
      const t = new Date(c.t).getTime();
      return t >= startTs && t <= endTs;
    });
  }

  /**
   * Rileva solo gap ai bordi (inizio/fine), NON i weekend/festività.
   * Se non ci sono candele → ritorna un singolo intervallo [startDate,endDate].
   
  _detectMissingRanges(candles, startDate, endDate, tf = "1Day") {
    if (tf !== "1Day") {
      // per altri timeframe al momento non gestiamo i gap
      return [];
    }

    const ranges = [];
    const sorted = [...candles].sort(
      (a, b) => new Date(a.t) - new Date(b.t)
    );

    if (!sorted.length) {
      this.logger.log(
        `[detectMissingRanges] Nessuna candela, range completamente mancante ${startDate}→${endDate}`
      );
      ranges.push({ from: startDate, to: endDate });
      this.logger.log(
        `[detectMissingRanges] Timeframe=${tf}, gap rilevati (solo bordi): ${JSON.stringify(
          ranges
        )}`
      );
      return ranges;
    }

    const startTs = new Date(startDate).getTime();
    const endTs = new Date(endDate).getTime();
    const firstTs = new Date(sorted[0].t).getTime();
    const lastTs = new Date(sorted[sorted.length - 1].t).getTime();

    // gap iniziale
    if (firstTs > startTs) {
      ranges.push({ from: startDate, to: sorted[0].t });
    }

    // gap finale
    if (lastTs < endTs) {
      ranges.push({ from: sorted[sorted.length - 1].t, to: endDate });
    }

    this.logger.log(
      `[detectMissingRanges] Totale intervalli mancanti: ${ranges.length}`
    );
    if (ranges.length) {
      this.logger.log(
        `[detectMissingRanges] Timeframe=${tf}, gap rilevati (solo bordi): ${JSON.stringify(
          ranges
        )}`
      );
    }

    return ranges;
  }
*/

  _detectMissingRanges(candles, startDate, endDate, tf = "1Day") {
    if (tf !== "1Day") {
      // per altri timeframe al momento non gestiamo i gap
      return [];
    }

    const sorted = [...candles].sort(
      (a, b) => new Date(a.t) - new Date(b.t)
    );

    // Nessuna candela → range completamente mancante
    if (!sorted.length) {
      this.logger.log(
        `[detectMissingRanges] Nessuna candela, range completamente mancante ${startDate}→${endDate}`
      );
      const ranges = [{ from: startDate, to: endDate }];
      this.logger.log(
        `[detectMissingRanges] Timeframe=${tf}, gap rilevati (solo bordi): ${JSON.stringify(
          ranges
        )}`
      );
      return ranges;
    }

    // Abbiamo almeno una candela:
    // per TF=1Day assumiamo che il provider dia già tutti i giorni di trading.
    // NON inseguamo gap ai bordi (weekend/festivi) per evitare chiamate remote inutili.
    this.logger.log(
      `[detectMissingRanges] Candles presenti (${sorted.length}), nessun range mancante calcolato per TF=${tf}`
    );
    return [];
  }

  // =========================================================
  // L3: Redis
  // =========================================================
  async _readL3(symbol, tf, startDate, endDate) {
    const key = this._buildL3Key(symbol, tf);
    this.logger.log(`[L3] Lettura Redis key=${key}`);

    let raw;
    try {
      raw = await this.bus.get(key);
    } catch (err) {
      this.logger.error(
        `[L3] Errore lettura Redis per key=${key}: ${err.message}`
      );
      return [];
    }

    this.logger.log(
      `[L3] Valore grezzo da Redis per ${key}: type=${typeof raw}, preview=${
        typeof raw === "string" ? raw.slice(0, 50) : "[object Object]"
      }`
    );

    if (!raw) {
      this.logger.info(`[L3] Cache miss (null) per key=${key}`);
      return [];
    }

    let data = raw;

    if (typeof raw === "string") {
      try {
        data = JSON.parse(raw);
      } catch (err) {
        this.logger.error(
          `[L3] Errore parse JSON per key=${key}: ${err.message}`
        );
        return [];
      }
    }

    if (!Array.isArray(data)) {
      this.logger.error(`[L3] Formato non valido in Redis per key=${key}`);
      return [];
    }

    const filtered = this._filterCandlesByRange(data, startDate, endDate);

    this.logger.info(
      `[L3] HIT → ${data.length} candele totali in cache (key=${key})`
    );
    this.logger.log(
      `[L3] Filtrate ${filtered.length} candele per range ${startDate}→${endDate}`
    );

    return filtered;
  }

  async _writeL3(symbol, tf, candles) {
    if (!candles || !candles.length) return;

    const key = this._buildL3Key(symbol, tf);
    this.logger.log(
      `[L3] Scrittura in Redis key=${key} (${candles.length} candele)`
    );

    try {
      // leggo eventuali esistenti per fare merge e non perdere nulla
      let existing = [];
      const raw = await this.bus.get(key);
      if (raw) {
        try {
          const parsed =
            typeof raw === "string" ? JSON.parse(raw) : raw;
          if (Array.isArray(parsed)) existing = parsed;
        } catch (err) {
          this.logger.error(
            `[L3] Errore parse JSON esistente per key=${key}: ${err.message}`
          );
        }
      }

      const map = new Map();
      for (const c of existing) map.set(c.t, c);
      for (const c of candles) map.set(c.t, c);

      const merged = Array.from(map.values()).sort(
        (a, b) => new Date(a.t) - new Date(b.t)
      );

      const payload = JSON.stringify(merged);
      await this.bus.set(key, payload);

      this.logger.info(
        `[L3] Memorizzate ${merged.length} candele in cache L3 (key=${key})`
      );
    } catch (err) {
      this.logger.error(
        `[L3] Errore scrittura Redis per key=${key}: ${err.message}`
      );
    }
  }

  // =========================================================
  // L2: File system
  // =========================================================
  async _readL2(symbol, startDate, endDate, tf) {
    const out = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    this.logger.log(
      `[L2] Lettura da FS per ${symbol} ${startDate}→${endDate} tf=${tf}`
    );

    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMon = new Date(end.getFullYear(), end.getMonth(), 1);

    while (cur <= endMon) {
      const year = cur.getFullYear();
      const month = (cur.getMonth() + 1).toString().padStart(2, "0");
      const file = `${this.cacheBasePath}/${symbol}/${year}-${month}_${tf}.json`;

      if (fs.existsSync(file)) {
        try {
          const json = JSON.parse(fs.readFileSync(file, "utf8"));
          this.L2Hit = (this.L2Hit || 0) + 1;
          this.logger.info(
            `[L2] HIT file ${file} (${json.length} candele)`
          );
          out.push(...json);
        } catch (e) {
          this.logger.error(
            `[L2] Errore lettura/parse file ${file}: ${
              e.message || String(e)
            }`
          );
        }
      } else {
        this.L2Miss = (this.L2Miss || 0) + 1;
        this.logger.warning(
          `[L2] MISS file ${file} (non esiste)`
        );
      }

      cur.setMonth(cur.getMonth() + 1);
    }

    const filtered = this._filterCandlesByRange(
      out,
      startDate,
      endDate
    );

    this.logger.log(
      `[L2] Totale candele lette da FS per ${symbol}: ${out.length}, filtrate nel range: ${filtered.length}`
    );

    return filtered;
  }

  async _writeL2(symbol, tf, candles) {
    if (!candles || !candles.length) return;

    try {
      const baseDir = path.join(this.cacheBasePath, symbol);
      if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

      const groups = {};

      // raggruppa per yyyy-mm
      for (const c of candles) {
        const month = c.t.slice(0, 7); // "YYYY-MM"
        if (!groups[month]) groups[month] = [];
        groups[month].push(c);
      }

      for (const month of Object.keys(groups)) {
        const file = path.join(baseDir, `${month}_${tf}.json`);

        let existing = [];
        if (fs.existsSync(file)) {
          try {
            existing = JSON.parse(fs.readFileSync(file, "utf8"));
          } catch (err) {
            this.logger.error(
              `[L2] Errore lettura/parsing file esistente ${file}: ${err.message}`
            );
          }
        }

        const map = new Map();
        for (const c of existing) map.set(c.t, c);
        for (const c of groups[month]) map.set(c.t, c);

        const merged = Array.from(map.values()).sort(
          (a, b) => new Date(a.t) - new Date(b.t)
        );

        this.logger.info(
          `[L2] Scrittura file ${file} (${merged.length} candele)`
        );

        fs.writeFileSync(file, JSON.stringify(merged, null, 2));
        this.logger.log(`[L2] File scritto correttamente: ${file}`);
      }
    } catch (err) {
      this.logger.error(
        `[L2] Errore scrittura file L2: ${err.message}`
      );
    }
  }

  // =========================================================
  // L1: Provider remoto (ALPACA / FMP)
  // =========================================================
  async _retrieveFromProvider(symbol, startDate, endDate, tf) {
    const provider = this.providerType || "ALPACA";

    this.logger.info(
      `[L1] Recupero da provider ${provider} per ${symbol} ${startDate}→${endDate} tf=${tf}`
    );

    try {
      switch (provider) {
        case "ALPACA": {
          if (!this.alpaca) {
            throw new Error(
              "Alpaca provider non inizializzato (this.alpaca undefined)"
            );
          }

          const bars = await this.alpaca.fetchDailyBars({
            symbol,
            start: startDate,
            end: endDate,
            timeframe: tf,
          });

          this.L1Hit = (this.L1Hit || 0) + 1;
          this.lastProviderCall = new Date().toISOString();
          this.logger.info(
            `[L1][ALPACA] Restituite ${bars.length} candele per ${symbol}`
          );
          return bars;
        }

        case "FMP": {
          if (!this.fmp) {
            throw new Error(
              "FMP provider non inizializzato (this.fmp undefined)"
            );
          }

          const bars = await this.fmp.fetchDailyBars({
            symbol,
            start: startDate,
            end: endDate,
            timeframe: tf,
            periodLength: 10,
          });

          this.L1Hit = (this.L1Hit || 0) + 1;
          this.lastProviderCall = new Date().toISOString();
          this.logger.info(
            `[L1][FMP] Restituite ${bars.length} candele per ${symbol}`
          );
          return bars;
        }

        default:
          throw new Error(`Provider storico non valido: ${provider}`);
      }
    } catch (e) {
      this.logger.error(
        `[L1] Errore recupero candele da provider ${provider} per ${symbol}: ${
          e.message || String(e)
        }`
      );
      throw e;
    }
  }

}

module.exports = CacheManager;
