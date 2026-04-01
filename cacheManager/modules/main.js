// modules/main.js — TEMPLATE DEFINITIVO
"use strict";

const path = require("path");
const { randomUUID } = require("crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const createLogger = require("../../shared/logger");
const { initializeSettings, getSetting, reloadSettings, getAllSettings, setSetting } = require("../../shared/loadSettings");
const { RedisBus } = require("../../shared/redisBus");
const { publishEventsManifest } = require("../../shared/eventsManifestRegistry");
const { asBool, asInt } = require("../../shared/helpers");
const { AlpacaProvider } = require("./alpaca");
const { FmpProvider } = require("./fmp");
const axios = require("axios");
const fs = require("fs");
const fsp = require("fs/promises");

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
    // Support both DATAHUB_URL (preferred) and DBMANAGER_URL (backward compat)
    this.dbmanagerUrl = process.env.DATAHUB_URL || process.env.DBMANAGER_URL || "http://datahub:3000";
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
    this.ibkrbridgeUrl =
      process.env.IBKRBRIDGE_URL ||
      process.env.IBKR_BRIDGE_URL ||
      "http://ibkr-bridge:3017";

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
    this.redisEventsChannel   = `${this.env}.${MICROSERVICE}.events`;

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
      events:    { on: true, params: { intervalsMs: 0    } },
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
    this._l3ThresholdAlertActive = false;

    this.providerType = (process.env.HISTORICAL_PROVIDER || "FMP").toUpperCase();

    const hasAlpacaCreds = Boolean(process.env.APCA_API_KEY_ID && process.env.APCA_API_SECRET_KEY);
    const hasFmpKey = Boolean(process.env.FMP_API_KEY);

    if (hasAlpacaCreds) {
      this.alpaca = new AlpacaProvider({
        apiKey: process.env.APCA_API_KEY_ID,
        apiSecret: process.env.APCA_API_SECRET_KEY,
        feed: process.env.ALPACA_MARKET_FEED || "sip",
        logger: this.logger,
      });
    }

    if (hasFmpKey) {
      this.fmp = new FmpProvider({
        apiKey: process.env.FMP_API_KEY,
        logger: this.logger,
      });
    }

    if (this.providerType === "IBKR") {
      this.logger.info("[CacheManager] Provider storico: IBKR");
    } else if (this.providerType === "ALPACA") {
      this.logger.info("[CacheManager] Provider storico: ALPACA");
      if (!this.alpaca) {
        this.logger.warning("[CacheManager] APCA_API_KEY_ID/APCA_API_SECRET_KEY mancanti: ALPACA non disponibile");
      }
      if (!this.fmp) {
        this.logger.warning("[CacheManager] Fallback FMP non disponibile (FMP_API_KEY mancante)");
      }
    } else if (this.providerType === "FMP") {
      this.logger.info("[CacheManager] Provider storico: FMP");
      if (!this.fmp) {
        this.logger.warning("[CacheManager] FMP_API_KEY mancante: FMP non disponibile");
      }
    } else {
      this.logger.error(`[CacheManager] Provider storico sconosciuto: ${this.providerType}`);
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
    await publishEventsManifest({
      bus: this.bus,
      logger: this.logger,
      microserviceName: MICROSERVICE,
      serviceRootDir: path.resolve(__dirname, ".."),
    });

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


  async getReleaseInfo() {
    const mainDir =
      (typeof require !== "undefined" &&
        require.main &&
        require.main.filename &&
        path.dirname(require.main.filename)) ||
      null;
    const candidates = Array.from(
      new Set(
        [
          path.resolve(__dirname, "..", "release.json"),
          path.resolve(process.cwd(), "release.json"),
          path.resolve(process.cwd(), "cacheManager", "release.json"),
          mainDir ? path.resolve(mainDir, "release.json") : null,
        ].filter(Boolean)
      )
    );

    for (const filePath of candidates) {
      try {
        const raw = await fsp.readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        this._releaseCache = parsed;
        this.logger.info("[getReleaseInfo] lettura release.json", { filePath: String(filePath) });
        return parsed;
      } catch (error) {
        this.logger.trace("[getReleaseInfo] tentativo fallito", {
          filePath: String(filePath),
          error: error?.message || String(error),
        });
      }
    }

    this.logger.warning("[getReleaseInfo] release.json non trovato", { candidates });
    return (
      this._releaseCache || {
        lastUpdate: null,
        version: "unknown",
        microservice: "cacheManager",
        note: ["release.json non trovato o non leggibile"],
      }
    );
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

  async _publishEvent(eventId, payload = {}, severity = "info", correlationId = null) {
    if (!this.bus || typeof this.bus.publish !== "function") return;
    const cid = correlationId || randomUUID();
    const event = {
      eventKey: `${MICROSERVICE}.${eventId}`,
      eventId,
      service: MICROSERVICE,
      env: this.env,
      ts: new Date().toISOString(),
      severity,
      correlationId: cid,
      payload,
    };
    try {
      await this.bus.publish(this.redisEventsChannel, event);
    } catch (err) {
      this.logger.warning(
        `[events] publish failed eventId=${eventId}: ${err?.message || String(err)}`
      );
    }
  }

  async _checkL3UsageThreshold() {
    if (!this.bus?.pub || !this.bus.pub.isOpen) return;

    const rawThreshold = Number(process.env.L3_USAGE_ALERT_PERCENT ?? 95);
    const thresholdPct =
      Number.isFinite(rawThreshold) && rawThreshold > 0 && rawThreshold <= 100
        ? rawThreshold
        : 95;

    try {
      const memoryInfo = await this.bus.pub.info("memory");
      if (!memoryInfo || typeof memoryInfo !== "string") return;

      const usedMatch = memoryInfo.match(/^used_memory:(\d+)$/m);
      const maxMatch = memoryInfo.match(/^maxmemory:(\d+)$/m);

      const usedBytes = Number(usedMatch?.[1] || 0);
      const maxBytes = Number(maxMatch?.[1] || 0);

      if (!Number.isFinite(usedBytes) || !Number.isFinite(maxBytes) || maxBytes <= 0) {
        return;
      }

      const usagePct = (usedBytes / maxBytes) * 100;

      if (usagePct >= thresholdPct && !this._l3ThresholdAlertActive) {
        this._l3ThresholdAlertActive = true;
        await this._publishEvent(
          "CACHE.L3.THRESHOLD.REACHED",
          {
            reason: "L3 Redis usage reached threshold",
            thresholdPercent: thresholdPct,
            usedBytes,
            maxBytes,
            usagePercent: Number(usagePct.toFixed(2)),
          },
          "warning"
        );
      } else if (usagePct < thresholdPct) {
        this._l3ThresholdAlertActive = false;
      }
    } catch (err) {
      this.logger.warning(
        `[L3] Threshold check failed: ${err?.message || String(err)}`
      );
    }
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
      events:    norm("events"),
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
    this.bus.setChannelConfig("events",    cfg.events);

    this.logger.info(
      `[channels] telemetry=${cfg.telemetry.on} metrics=${cfg.metrics.on} data=${cfg.data.on} logs=${cfg.logs.on} events=${cfg.events.on}`
    );

    return { ok: true, channels: cfg };
  }

  // =========================================================
  // GET INFO STANDARDIZZATO
  // =========================================================
  getInfo() {
    let version = MODULE_VERSION;
    try {
      const rel = this._releaseCache || null;
      if (rel?.version) version = rel.version;
    } catch {
      // ignore
    }

    return {
      MICROSERVICE,
      MODULE_NAME,
      MODULE_VERSION: version,
      STATUS: this._status,
      STATUS_DETAILS: this.statusDetails,
      ENV: this.env,
      communicationChannels: this.communicationChannels,
      BusChannels: {
        telemetry: this.redisTelemetyChannel,
        status:    this.redisStatusChannel,
        data:      this.redisDataChannel,
        logs:      this.redisLogsChannel,
        events:    this.redisEventsChannel,
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
    this.logger.warning("[setDbLogStatus] Not supported by this logger | ", { status });
    return { dbLogEnabled: false };
  }

  // =========================================================
  // Log level API (usata da /status/logLevel)
  // =========================================================
  getLogLevel() {
    if (typeof this.logger.getLevel === "function") {
      const lvl = this.logger.getLevel();
      return lvl || process.env.LOG_LEVEL;
    }
    return process.env.LOG_LEVEL;
  }

  setLogLevel(level) {
    if (typeof this.logger.setLevel === "function") {
      this.logger.setLevel(level);
      return { level };
    }
    this.logger.warning("[setLogLevel] Not supported by this logger | ", { level });
    return { level: process.env.LOG_LEVEL || null };
  }

  getAllSettings() {
    return getAllSettings();
  }

  setSetting(key, value) {
    return setSetting(key, value);
  }

  // Accesso diretto
  getBus()    { return this.bus; }
  getLogger() { return this.logger; }
  get status() { return this._status; }


  // =========================================================
  // CANDLE CACHE: L3 (Redis) -> L2 (FS) -> L1 (Provider)
  // =========================================================

  async getCandles(symbol, startDate, endDate, tf = "1Day", exchange) {
    const tfCache = this._normalizeTfCache(tf);
    const startTs = new Date(startDate).getTime();
    const endTs = new Date(endDate).getTime();
    if (Number.isFinite(startTs) && Number.isFinite(endTs) && startTs > endTs) {
      this.logger.warning(
        `[getCandles] Intervallo invertito, swap start/end ${startDate} → ${endDate}`
      );
      const tmp = startDate;
      startDate = endDate;
      endDate = tmp;
    }
    this.logger.info(
      `[getCandles] Richiesta candele ${symbol} ${startDate} → ${endDate} tf=${tfCache}`
    );
    const monthKeys = this._listMonthKeysBetween(startDate, endDate);
    const missingMonths = [];

    for (const monthKey of monthKeys) {
      const ensured = this._ensureCanonicalL2MonthFile(symbol, tfCache, monthKey);
      if (!ensured) missingMonths.push(monthKey);
    }

    if (missingMonths.length) {
      this.logger.info(
        `[getCandles] Mesi mancanti per ${symbol} tf=${tfCache}: ${missingMonths.join(", ")}`
      );
    } else {
      this.logger.info(
        `[getCandles] Tutti i file mensili presenti per ${symbol} tf=${tfCache}, nessuna chiamata provider`
      );
    }

    // Missing month(s): fetch full month and mark file as complete.
    for (const monthKey of missingMonths) {
      const { fromIso, toIso } = this._monthBoundsUtc(monthKey);
      this.logger.warning(
        `[getCandles] File mese mancante ${monthKey}_${tfCache}.json → fetch completo ${fromIso}→${toIso}`
      );
      try {
        const providerCandles = await this._retrieveFromProvider(
          symbol,
          fromIso,
          toIso,
          tfCache,
          exchange
        );
        const monthCandles = this._filterCandlesByRange(providerCandles, fromIso, toIso);
        await this._writeL2MonthFile(symbol, tfCache, monthKey, monthCandles);
      } catch (err) {
        // Per mesi correnti o futuri i provider possono fallire legittimamente
        // (mercato non ancora aperto, dati non ancora disponibili).
        // In questo caso serviamo i dati storici dalla cache senza propagare l'errore.
        const now = new Date();
        const [ky, km] = monthKey.split("-").map(Number);
        const monthStart = new Date(Date.UTC(ky, km - 1, 1));
        const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        if (monthStart >= currentMonthStart) {
          this.logger.warning(
            `[getCandles] Provider fallito per mese corrente/futuro ${monthKey} ${symbol} tf=${tfCache} — nessun dato disponibile, uso cache storica: ${err.message}`
          );
        } else {
          // Mese passato: errore reale, propaghiamo
          throw err;
        }
      }
    }

    const collected = this._readL2ByMonthKeys(symbol, tfCache, monthKeys);
    const filtered = this._filterCandlesByRange(collected, startDate, endDate);
    await this._writeL3(symbol, tfCache, filtered);

    this.logger.info(
      `[getCandles] Totale candele restituite per ${symbol} ${startDate}→${endDate}: ${filtered.length}`
    );
    return filtered;
  }

  // ---------------------- Helpers comuni -------------------

  _buildL3Key(symbol, tf) {
    const tfCache = this._normalizeTfCache(tf);
    return `candles:${symbol}:${tfCache}`;
  }

  _normalizeTfCache(tf = "1Day") {
    const v = String(tf || "1Day").toLowerCase().trim();
    if (["1m", "1min"].includes(v)) return "1min";
    if (["5m", "5min"].includes(v)) return "5min";
    if (["15m", "15min"].includes(v)) return "15min";
    if (["30m", "30min"].includes(v)) return "30min";
    if (["1h", "1hr", "1hour"].includes(v)) return "1h";
    if (["2h", "2hr", "2hour"].includes(v)) return "2h";
    if (["4h", "4hr", "4hour"].includes(v)) return "4h";
    if (["6h", "6hr", "6hour"].includes(v)) return "6h";
    if (["12h", "12hr", "12hour"].includes(v)) return "12h";
    if (["1d", "1day"].includes(v)) return "1day";
    if (["1w", "1week"].includes(v)) return "1week";
    if (["1mo", "1month"].includes(v)) return "1month";
    return v;
  }

  _listMonthKeysBetween(startDate, endDate) {
    const out = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
    let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1, 0, 0, 0, 0));
    const endMon = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1, 0, 0, 0, 0));
    while (cur <= endMon) {
      const y = cur.getUTCFullYear();
      const m = String(cur.getUTCMonth() + 1).padStart(2, "0");
      out.push(`${y}-${m}`);
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
    return out;
  }

  _monthBoundsUtc(monthKey) {
    const [yRaw, mRaw] = String(monthKey || "").split("-");
    const y = Number(yRaw);
    const m = Number(mRaw);
    const from = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
    const to = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0) - 1);
    return { fromIso: from.toISOString(), toIso: to.toISOString() };
  }

  _l2MonthFilePath(symbol, tfCache, monthKey) {
    return path.join(this.cacheBasePath || "cache", symbol, `${monthKey}_${tfCache}.json`);
  }

  _tfFileAliases(tfCache) {
    const aliases = new Set([tfCache]);
    if (tfCache === "1day") aliases.add("1Day");
    if (tfCache === "1week") aliases.add("1Week");
    if (tfCache === "1month") aliases.add("1Month");
    if (tfCache === "1h") aliases.add("1Hour");
    if (tfCache === "2h") aliases.add("2Hour");
    if (tfCache === "4h") aliases.add("4Hour");
    if (tfCache === "6h") aliases.add("6Hour");
    if (tfCache === "12h") aliases.add("12Hour");
    return Array.from(aliases);
  }

  _ensureCanonicalL2MonthFile(symbol, tfCache, monthKey) {
    const canonical = this._l2MonthFilePath(symbol, tfCache, monthKey);
    if (fs.existsSync(canonical)) return canonical;
    const dir = path.join(this.cacheBasePath || "cache", symbol);
    for (const alias of this._tfFileAliases(tfCache)) {
      const p = path.join(dir, `${monthKey}_${alias}.json`);
      if (fs.existsSync(p)) {
        try {
          fs.renameSync(p, canonical);
          this.logger.info(`[L2] Normalizzato nome file ${p} -> ${canonical}`);
          return canonical;
        } catch (err) {
          this.logger.warning(`[L2] rename fallito ${p} -> ${canonical}: ${err.message}`);
          return p;
        }
      }
    }
    return null;
  }

  _readL2ByMonthKeys(symbol, tfCache, monthKeys = []) {
    const out = [];
    for (const monthKey of monthKeys) {
      const file = this._ensureCanonicalL2MonthFile(symbol, tfCache, monthKey);
      if (!file || !fs.existsSync(file)) continue;
      try {
        const json = JSON.parse(fs.readFileSync(file, "utf8"));
        if (Array.isArray(json)) out.push(...json);
      } catch (err) {
        this.logger.error(`[L2] Errore parse file ${file}: ${err.message}`);
      }
    }
    return out
      .map((c) => {
        const ts = this._toTimestampMs(c?.t ?? c?.timestamp ?? c?.time ?? c?.date);
        if (!Number.isFinite(ts)) return null;
        return { ...c, t: new Date(ts).toISOString() };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.t) - new Date(b.t));
  }

  async _writeL2MonthFile(symbol, tfCache, monthKey, candles = []) {
    try {
      const dir = path.join(this.cacheBasePath || "cache", symbol);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = this._l2MonthFilePath(symbol, tfCache, monthKey);
      const normalized = (Array.isArray(candles) ? candles : [])
        .map((c) => {
          const ts = this._toTimestampMs(c?.t ?? c?.timestamp ?? c?.time ?? c?.date);
          if (!Number.isFinite(ts)) return null;
          return { ...c, t: new Date(ts).toISOString() };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(a.t) - new Date(b.t));
      fs.writeFileSync(file, JSON.stringify(normalized, null, 2));
      this.logger.info(`[L2] Scrittura file completo ${file} (${normalized.length} candele)`);
    } catch (err) {
      this.logger.error(`[L2] Errore scrittura file mensile ${monthKey}_${tfCache}: ${err.message}`);
    }
  }

  /**
   * Returns the most recent candle for the given symbol/timeframe from L3 (Redis).
   * Does not fetch from provider — returns null on cache miss.
   */
  async getLatestCandle(symbol, tf) {
    if (!symbol || !tf) return null;
    const key = this._buildL3Key(symbol, tf);
    let raw;
    try {
      raw = await this.bus.get(key);
    } catch (err) {
      this.logger.error(`[getLatestCandle] Redis error key=${key}: ${err.message}`);
      return null;
    }
    if (!raw) return null;
    let data;
    try {
      data = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
    if (!Array.isArray(data) || !data.length) return null;
    // Sort descending by t, return the latest
    const sorted = data
      .filter((c) => c && (c.t || c.timestamp || c.time || c.date))
      .sort((a, b) => {
        const ta = this._toTimestampMs(a.t ?? a.timestamp ?? a.time ?? a.date) ?? 0;
        const tb = this._toTimestampMs(b.t ?? b.timestamp ?? b.time ?? b.date) ?? 0;
        return tb - ta;
      });
    return sorted[0] ?? null;
  }

  _toTimestampMs(value) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return null;
      if (value > 1e15) return Math.floor(value / 1e6); // ns
      if (value > 1e12) return value; // ms
      if (value > 1e10) return Math.floor(value / 1e3); // us
      return value * 1000; // sec
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (/^\d+$/.test(trimmed)) {
        const n = Number(trimmed);
        if (!Number.isFinite(n)) return null;
        if (n > 1e15) return Math.floor(n / 1e6); // ns
        if (n > 1e12) return n; // ms
        if (n > 1e10) return Math.floor(n / 1e3); // us
        return n * 1000; // sec
      }
      const parsed = Date.parse(trimmed);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  _mapTfAlpaca(tf) {
    const val = String(tf || "1Day").toLowerCase();
    if (["1m", "1min"].includes(val)) return "1Min";
    if (["5m", "5min"].includes(val)) return "5Min";
    if (["15m", "15min"].includes(val)) return "15Min";
    if (["30m", "30min"].includes(val)) return "30Min";
    if (["1h", "1hr", "1hour"].includes(val)) return "1Hour";
    if (["2h", "2hr", "2hour", "6h", "6hr", "6hour"].includes(val)) return "1Hour";
    if (["12h", "12hr", "12hour"].includes(val)) return "1Day";
    if (["1d", "1day"].includes(val)) return "1Day";
    if (["1w", "1week"].includes(val)) return "1Week";
    if (["1mo", "1month", "1mth"].includes(val)) return "1Month";
    return "1Day";
  }

  _mapTfFmp(tf) {
    const val = String(tf || "1day").toLowerCase();
    if (["1m", "1min"].includes(val)) return "1min";
    if (["5m", "5min"].includes(val)) return "5min";
    if (["15m", "15min"].includes(val)) return "15min";
    if (["30m", "30min"].includes(val)) return "30min";
    if (["1h", "1hr", "1hour"].includes(val)) return "1hour";
    if (["2h", "2hr", "2hour"].includes(val)) return "2hour";
    if (["4h", "4hr", "4hour"].includes(val)) return "4hour";
    if (["6h", "6hr", "6hour"].includes(val)) return "6hour";
    if (["12h", "12hr", "12hour"].includes(val)) return "12hour";
    if (["1d", "1day"].includes(val)) return "1day";
    if (["1w", "1week"].includes(val)) return "1week";
    if (["1mo", "1month"].includes(val)) return "1month";
    return val;
  }

  _mapTfIbkr(tf) {
    const val = String(tf || "1day").toLowerCase();
    if (["1m", "1min"].includes(val)) return "1min";
    if (["2m", "2min"].includes(val)) return "2min";
    if (["3m", "3min"].includes(val)) return "3min";
    if (["5m", "5min"].includes(val)) return "5min";
    if (["10m", "10min"].includes(val)) return "10min";
    if (["15m", "15min"].includes(val)) return "15min";
    if (["30m", "30min"].includes(val)) return "30min";
    if (["1h", "1hr", "1hour"].includes(val)) return "1h";
    if (["2h", "2hr", "2hour", "4h", "4hr", "4hour"].includes(val)) return "2h";
    if (["1d", "1day"].includes(val)) return "1d";
    if (["1w", "1week"].includes(val)) return "1w";
    return "1d";
  }

  _buildIbkrPeriod(startDate, endDate) {
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "1d";
    const days = Math.max(1, Math.ceil((end - start) / (24 * 60 * 60 * 1000)));
    if (days <= 7) return `${days}d`;
    if (days <= 30) return `${Math.ceil(days / 7)}w`;
    return `${days}d`;
  }

  _tfDurationMs(tf = "1Day") {
    const v = String(tf || "").toLowerCase();
    if (v.includes("min")) {
      const n = Number.parseInt(v, 10);
      return (Number.isFinite(n) ? n : 1) * 60 * 1000;
    }
    if (v.includes("hour") || v.endsWith("h") || v.includes("hr")) {
      const n = Number.parseInt(v, 10);
      return (Number.isFinite(n) ? n : 1) * 60 * 60 * 1000;
    }
    if (v.includes("week") || v.endsWith("w")) return 7 * 24 * 60 * 60 * 1000;
    if (v.includes("month") || v.endsWith("mo")) return 30 * 24 * 60 * 60 * 1000;
    return 24 * 60 * 60 * 1000; // default daily
  }

  _isIntradayTf(tf = "") {
    const v = String(tf || "").toLowerCase().trim();
    if (!v) return false;
    // supported intraday aliases: 1min/5min/15min, 1h/2h, 1hour/2hour, 1hr/2hr
    if (v.includes("min") || v.includes("hour")) return true;
    if (/^\d+(m|h|hr)$/.test(v)) return true;
    return false;
  }

  // Cache in-memory asset_class per symbol (evita query ripetute a universe)
  _assetClassCache = {};

  async _resolveAssetClass(symbol) {
    if (this._assetClassCache[symbol] !== undefined) return this._assetClassCache[symbol];
    try {
      const resp = await axios.get(
        `${this.dbmanagerUrl}/api/table/universe?symbol=${encodeURIComponent(symbol)}&limit=1`,
        { timeout: 4000 }
      );
      const rows = resp.data?.data ?? resp.data?.items ?? [];
      const row = Array.isArray(rows) ? rows[0] : null;
      const assetClass = row?.asset_class || (row?.is_etf ? "ETF" : "STOCK");
      this._assetClassCache[symbol] = assetClass;
      return assetClass;
    } catch {
      this._assetClassCache[symbol] = "STOCK";
      return "STOCK";
    }
  }

  // Mappa asset_class → secType IBKR
  static SEC_TYPE_MAP = { STOCK: "STK", ETF: "ETF", METAL: "CMDTY", FUTURE: "FUT" };

  async _ibkrResolveConid(symbol, exchange) {
    const url = `${this.ibkrbridgeUrl}/mirror/iserver/secdef/search`;
    const preferredExchange = exchange || process.env.IBKR_EXCHANGE || "NASDAQ";
    const assetClass = await this._resolveAssetClass(symbol);
    const secType = CacheManager.SEC_TYPE_MAP[assetClass] || "STK";
    this.logger.trace?.(
      `[L1][IBKR] Resolve conid URL=${url} symbol=${symbol} exchange=${preferredExchange || "-"} asset_class=${assetClass} secType=${secType}`
    );
    const resp = await axios.get(url, {
      params: {
        symbol,
        name: true,
        secType,
        ...(preferredExchange ? { exchange: preferredExchange } : {}),
      },
      timeout: 8000,
    });
    const payload = resp.data;
    const list = Array.isArray(payload) ? payload : payload?.data || [];
    const match = list[0] || {};
    const conid = match?.conid ?? match?.conidEx ?? match?.conId;
    if (!conid) {
      throw new Error(`IBKR conid not found for ${symbol}`);
    }
    return conid;
  }

  async _ibkrFetchHistory({ conid, startDate, endDate, bar, symbol }) {
    const url = `${this.ibkrbridgeUrl}/mirror/iserver/marketdata/history`;
    const period = this._buildIbkrPeriod(startDate, endDate);
    this.logger.trace?.(
      `[L1][IBKR] History URL=${url} conid=${conid} bar=${bar} period=${period} symbol=${symbol}`
    );
    const resp = await axios.get(url, {
      params: {
        conid,
        bar,
        period,
        outsideRth: true,
      },
      timeout: 12000,
    });

    const rows = Array.isArray(resp.data?.data) ? resp.data.data : resp.data || [];
    if (!Array.isArray(rows)) {
      throw new Error("IBKR history invalid payload");
    }

    return rows
      .map((row) => {
        const tsRaw = Number(row.t ?? row.time);
        const ts = Number.isFinite(tsRaw)
          ? tsRaw < 1e12
            ? tsRaw * 1000
            : tsRaw
          : null;
        return {
          t: ts ? new Date(ts).toISOString() : row.t,
          o: row.o ?? row.open,
          h: row.h ?? row.high,
          l: row.l ?? row.low,
          c: row.c ?? row.close,
          v: row.v ?? row.volume,
          tf: bar,
          symbol,
          conid,
        };
      })
      .filter((r) => r.t);
  }

  _filterCandlesByRange(candles, startDate, endDate) {
    const startTs = new Date(startDate).getTime();
    const endTs = new Date(endDate).getTime();

    return candles.filter((c) => {
      const t = this._toTimestampMs(c?.t ?? c?.timestamp ?? c?.time ?? c?.date);
      return Number.isFinite(t) && t >= startTs && t <= endTs;
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
    const sorted = candles
      .map((c) => ({
        ...c,
        _ts: this._toTimestampMs(c?.t ?? c?.timestamp ?? c?.time ?? c?.date),
      }))
      .filter((c) => Number.isFinite(c._ts))
      .sort((a, b) => a._ts - b._ts);

    // Nessuna candela → range completamente mancante
    if (!sorted.length) {
      this.logger.log(
        `[detectMissingRanges] Nessuna candela, range completamente mancante ${startDate}→${endDate}`
      );
      const ranges = [{ from: startDate, to: endDate }];
      this.logger.log(
        `[detectMissingRanges] Timeframe=${tf}, gap rilevati (solo bordi): ${JSON.stringify(ranges)}`
      );
      return ranges;
    }

    const isIntraday = this._isIntradayTf(tf);
    // For intraday ranges, edge gaps often represent market-closed windows
    // (overnight/weekend). If we already have candles, avoid forcing remote fetches
    // for those non-tradable border intervals.
    if (isIntraday) {
      this.logger.log(
        `[detectMissingRanges] TF=${tf} intraday with ${sorted.length} candles: skip edge-gap refill`
      );
      return [];
    }

    const ranges = [];
    const startTs = new Date(startDate).getTime();
    const endTs = new Date(endDate).getTime();
    const firstTs = sorted[0]._ts;
    const lastTs = sorted[sorted.length - 1]._ts;

    const tfMs = this._tfDurationMs(tf);
    const gapStartMs = firstTs - startTs;
    const gapEndMs = endTs - lastTs;

    // gap iniziale: ignora residui inferiori a una barra (tipico offset timezone)
    if (gapStartMs >= tfMs) {
      ranges.push({ from: startDate, to: sorted[0].t ?? new Date(firstTs).toISOString() });
    }

    // gap finale: ignora "frazione di giornata" su richieste fino a now
    if (gapEndMs >= tfMs) {
      ranges.push({
        from: sorted[sorted.length - 1].t ?? new Date(lastTs).toISOString(),
        to: endDate,
      });
    }

    if (ranges.length) {
      this.logger.log(
        `[detectMissingRanges] Timeframe=${tf}, gap rilevati (solo bordi): ${JSON.stringify(ranges)}`
      );
    } else {
      this.logger.log(
        `[detectMissingRanges] Candles presenti (${sorted.length}), nessun gap ai bordi per TF=${tf}`
      );
    }

    return ranges;
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
      const normalize = (c) => {
        const ts = this._toTimestampMs(c?.t ?? c?.timestamp ?? c?.time ?? c?.date);
        if (!Number.isFinite(ts)) return null;
        return { ...c, t: new Date(ts).toISOString() };
      };

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
      for (const c of existing.map(normalize)) {
        if (c) map.set(c.t, c);
      }
      for (const c of candles.map(normalize)) {
        if (c) map.set(c.t, c);
      }

      const merged = Array.from(map.values()).sort(
        (a, b) => new Date(a.t) - new Date(b.t)
      );

      const payload = JSON.stringify(merged);
      await this.bus.set(key, payload);

      this.logger.info(
        `[L3] Memorizzate ${merged.length} candele in cache L3 (key=${key})`
      );
      await this._checkL3UsageThreshold();
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
      const normalized = candles
        .map((c) => {
          const ts = this._toTimestampMs(c?.t ?? c?.timestamp ?? c?.time ?? c?.date);
          if (!Number.isFinite(ts)) return null;
          return { ...c, t: new Date(ts).toISOString() };
        })
        .filter(Boolean);
      if (!normalized.length) return;

      const baseDir = path.join(this.cacheBasePath, symbol);
      if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

      const groups = {};

      // raggruppa per yyyy-mm
      for (const c of normalized) {
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
        for (const c of existing) {
          const ts = this._toTimestampMs(c?.t ?? c?.timestamp ?? c?.time ?? c?.date);
          if (!Number.isFinite(ts)) continue;
          map.set(new Date(ts).toISOString(), { ...c, t: new Date(ts).toISOString() });
        }
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

      // Enforce L2 max size if configured
      await this._enforceL2MaxSize();
    } catch (err) {
      this.logger.error(
        `[L2] Errore scrittura file L2: ${err.message}`
      );
    }
  }

  // =========================================================
  // L2: Lettura file singolo (by year/month/tf or filename)
  // =========================================================
  async readL2File({ symbol, year, month, tf, fileName }) {
    let targetPath = null;
    if (fileName) {
      const safeName = String(fileName).replace(/\\/g, "/");
      if (safeName.includes("..")) {
        throw new Error("Invalid fileName");
      }
      const baseDir = path.resolve(this.cacheBasePath || "cache");
      const fullPath = path.resolve(baseDir, safeName);
      if (!fullPath.startsWith(baseDir)) {
        throw new Error("Invalid fileName");
      }
      targetPath = fullPath;
    } else {
      if (!symbol || !year || !month || !tf) {
        throw new Error("symbol, year, month, tf required");
      }
      const safeSymbol = String(symbol).trim().toUpperCase();
      const safeYear = String(year).trim();
      const safeMonth = String(month).padStart(2, "0");
      const safeTf = String(tf).trim();
      targetPath = path.resolve(
        this.cacheBasePath || "cache",
        safeSymbol,
        `${safeYear}-${safeMonth}_${safeTf}.json`
      );
    }
    const raw = await fsp.readFile(targetPath, "utf8");
    const stats = await fsp.stat(targetPath);
    return {
      data: JSON.parse(raw),
      meta: {
        file: targetPath,
        createdAt: stats.birthtime?.toISOString?.() || stats.birthtime,
        updatedAt: stats.mtime?.toISOString?.() || stats.mtime,
      },
    };
  }

  async writeL2File({ symbol, year, month, tf, fileName, data }) {
    if (!data) {
      throw new Error("data required");
    }
    const payload = Array.isArray(data) ? data : data?.candles || data?.data || data;
    if (!payload || typeof payload !== "object") {
      throw new Error("invalid data payload");
    }

    let targetPath = null;
    if (fileName) {
      const safeName = String(fileName).replace(/\\/g, "/");
      if (safeName.includes("..")) {
        throw new Error("Invalid fileName");
      }
      const baseDir = path.resolve(this.cacheBasePath || "cache");
      const fullPath = path.resolve(baseDir, safeName);
      if (!fullPath.startsWith(baseDir)) {
        throw new Error("Invalid fileName");
      }
      targetPath = fullPath;
    } else {
      if (!symbol || !year || !month || !tf) {
        throw new Error("symbol, year, month, tf required");
      }
      const safeSymbol = String(symbol).trim().toUpperCase();
      const safeYear = String(year).trim();
      const safeMonth = String(month).padStart(2, "0");
      const safeTf = String(tf).trim();
      targetPath = path.resolve(
        this.cacheBasePath || "cache",
        safeSymbol,
        `${safeYear}-${safeMonth}_${safeTf}.json`
      );
    }

    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.writeFile(targetPath, JSON.stringify(payload, null, 2), "utf8");
    return { ok: true, file: targetPath };
  }

  /**
   * Enforce MAX_L2_CACHE_MB limit (older files removed first).
   */
  async _enforceL2MaxSize() {
    const maxMbRaw = getSetting("MAX_L2_CACHE_MB");
    const maxMb = Number(maxMbRaw);
    if (!Number.isFinite(maxMb) || maxMb <= 0) {
      return;
    }
    const maxBytes = maxMb * 1024 * 1024;
    const baseDir = this.cacheBasePath || "cache";

    try {
      const stat = await fsp.stat(baseDir).catch(() => null);
      if (!stat || !stat.isDirectory()) return;

      const files = [];
      const dirs = [];
      const walk = async (dir) => {
        dirs.push(dir);
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
          } else if (entry.isFile()) {
            try {
              const st = await fsp.stat(full);
              files.push({ path: full, size: st.size, mtimeMs: st.mtimeMs });
            } catch (err) {
              this.logger.warning(`[L2] Impossibile leggere size file ${full}: ${err.message}`);
            }
          }
        }
      };

      await walk(baseDir);
      let total = files.reduce((s, f) => s + (Number(f.size) || 0), 0);
      if (total <= maxBytes) return;

      const toMb = (v) => `${(v / 1024 / 1024).toFixed(1)} MB`;
      const beforeBytes = total;
      this.logger.warning(
        `[L2] Cache L2 oltre limite (${toMb(total)} > ${toMb(maxBytes)}), rimozione file più vecchi`
      );

      files.sort((a, b) => (a.mtimeMs || 0) - (b.mtimeMs || 0));
      const removedFiles = [];
      const touchedSymbols = new Set();

      for (const file of files) {
        if (total <= maxBytes) break;
        try {
          await fsp.unlink(file.path);
          total -= file.size || 0;
          removedFiles.push({
            path: file.path,
            size: file.size || 0,
            mtimeMs: file.mtimeMs || null,
          });
          const rel = path.relative(baseDir, file.path);
          const parts = rel.split(path.sep).filter(Boolean);
          if (parts.length > 0) touchedSymbols.add(parts[0]);
          this.logger.info(`[L2] Rimosso file ${file.path} (size=${file.size}) per rientrare nel limite`);
        } catch (err) {
          this.logger.error(`[L2] Errore cancellando file ${file.path}: ${err.message}`);
        }
      }

      if (removedFiles.length > 0) {
        await this._publishEvent(
          "CACHE.L2.CLEANING",
          {
            reason: "L2 cache exceeded MAX_L2_CACHE_MB",
            limitMb: maxMb,
            beforeBytes,
            afterBytes: total,
            removedFilesCount: removedFiles.length,
            touchedSymbols: Array.from(touchedSymbols),
            removedFiles,
          },
          "warning"
        );
      }

      // Rimuovi directory vuote (dal fondo)
      dirs
        .sort((a, b) => b.length - a.length)
        .forEach(async (d) => {
          try {
            const entries = await fsp.readdir(d);
            if (entries.length === 0) {
              await fsp.rmdir(d);
            }
          } catch {
            /* ignore */
          }
        });
    } catch (err) {
      this.logger.error(`[L2] Errore enforcement limite cache: ${err.message}`);
    }
  }

  // =========================================================
  // L1: Provider remoto (ALPACA / FMP)
  // =========================================================
  async _retrieveFromProvider(symbol, startDate, endDate, tf, exchange) {
    const provider = this.providerType || "ALPACA";
    const tfAlpaca = this._mapTfAlpaca(tf);
    const tfFmp = this._mapTfFmp(tf);
    const tfIbkr = this._mapTfIbkr(tf);

    this.logger.info(
      `[L1] Recupero da provider ${provider} per ${symbol} ${startDate}→${endDate} tf=${tf}`
    );

    try {
      const tagBars = (bars, providerKey, fallbackFrom = null) => {
        if (!Array.isArray(bars)) return [];
        const fallbackInfo = fallbackFrom
          ? { providerFallback: true, providerFallbackFrom: fallbackFrom }
          : { providerFallback: false };
        return bars.map((bar) => ({
          ...bar,
          provider: providerKey,
          ...fallbackInfo,
        }));
      };

      const fetchFrom = async (providerKey, fallbackFrom = null) => {
        switch (providerKey) {
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
            timeframe: tfAlpaca,
          });
          if (!bars || bars.length === 0) {
            throw new Error(`[ALPACA_EMPTY] 0 candele restituite per ${symbol} nel range richiesto`);
          }
          const tagged = tagBars(bars, "ALPACA", fallbackFrom);

          this.L1Hit = (this.L1Hit || 0) + 1;
          this.lastProviderCall = new Date().toISOString();
          this.logger.info(
            `[L1][ALPACA] Restituite ${bars.length} candele per ${symbol}`
          );
          return tagged;
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
            timeframe: tfFmp,
            periodLength: 10,
          });
          if (!bars || bars.length === 0) {
            throw new Error(`[FMP_EMPTY] 0 candele restituite per ${symbol} nel range richiesto`);
          }
          const tagged = tagBars(bars, "FMP", fallbackFrom);

          this.L1Hit = (this.L1Hit || 0) + 1;
          this.lastProviderCall = new Date().toISOString();
          this.logger.info(
            `[L1][FMP] Restituite ${bars.length} candele per ${symbol}`
          );
          return tagged;
        }

        case "IBKR": {
          const conid = await this._ibkrResolveConid(symbol, exchange);
          const bars = await this._ibkrFetchHistory({
            conid,
            startDate,
            endDate,
            bar: tfIbkr,
            symbol,
          });
          if (!bars || bars.length === 0) {
            throw new Error(`[IBKR_EMPTY] 0 candele restituite per ${symbol} nel range richiesto`);
          }
          const tagged = tagBars(bars, "IBKR", fallbackFrom);
          this.L1Hit = (this.L1Hit || 0) + 1;
          this.lastProviderCall = new Date().toISOString();
          this.logger.info(
            `[L1][IBKR] Restituite ${bars.length} candele per ${symbol} conid=${conid}`
          );
          return tagged;
        }

        default:
          throw new Error(`Provider storico non valido: ${providerKey}`);
        }
      };

      if (provider === "IBKR") {
        try {
          return await fetchFrom("IBKR");
        } catch (err) {
          this.logger.warning(
            `[L1] IBKR fallito per ${symbol}, provo FMP`
          );
          try {
            return await fetchFrom("FMP", "IBKR");
          } catch (err2) {
            this.logger.warning(
              `[L1] FMP fallito per ${symbol}, provo ALPACA`
            );
            return await fetchFrom("ALPACA", "IBKR");
          }
        }
      }

      if (provider === "ALPACA") {
        try {
          return await fetchFrom("ALPACA");
        } catch (err) {
          this.logger.warning(`[L1] ALPACA fallito per ${symbol}, provo FMP`);
          return await fetchFrom("FMP", "ALPACA");
        }
      }

      if (provider === "FMP") {
        try {
          return await fetchFrom("FMP");
        } catch (err) {
          this.logger.warning(`[L1] FMP fallito per ${symbol}, provo IBKR`);
          try {
            return await fetchFrom("IBKR", "FMP");
          } catch (err2) {
            this.logger.warning(`[L1] IBKR fallito per ${symbol}, provo ALPACA`);
            return await fetchFrom("ALPACA", "FMP");
          }
        }
      }

      return await fetchFrom(provider);
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
