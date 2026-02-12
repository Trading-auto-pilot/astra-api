// modules/main.js — TEMPLATE DEFINITIVO
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const fs = require("fs/promises");
const axios = require("axios");
const https = require("https");
const createLogger = require("../../shared/logger");
const {
  initializeSettings,
  getSetting,
  reloadSettings,
  getAllSettings,
  setSetting,
} = require("../../shared/loadSettings");
const { RedisBus } = require("../../shared/redisBus");
const { asBool, asInt } = require("../../shared/helpers");

// =========================================================
// PLACEHOLDER da sostituire via script di scaffolding
// =========================================================
const MICROSERVICE    = "ibkr-keepalive";
const MODULE_NAME     = "main";
const MODULE_VERSION  = "0.1.0";    // e.g. "0.1.0"

class IbkrKeepalive {
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
    this.schedulerUrl = process.env.SCHEDULER_URL || "http://scheduler:3014";
    this.authServiceUrl = process.env.AUTHSERVICE_URL || "http://authService:3015";
    this.servicecontrolplaneUrl = process.env.SERVICECONTROLPLANE_URL || "http://servicecontrolplane:3016";
    this.ibkrbridgeUrl = process.env.IBKRBRIDGE_URL || "http://ibkr-bridge:3017";
    this.decisionengineUrl = process.env.DECISIONENGINE_URL || "http://decision-engine:3018";
    this.ibkrkeepaliveUrl = process.env.IBKRKEEPALIVE_URL || "http://ibkr-keepalive:3019";


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
    process.env.MICROSERVICE_NAME = process.env.MICROSERVICE_NAME || MICROSERVICE;
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

    this._timer = null;
    this._running = false;
    this._lastIntervalMs = null;
    this._client = null;
    this._reauthInFlight = null;
    this._lastTickleAt = null;
    this._lastTickleStatus = null;
    this._lastAuthStatus = null;
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
    this.logger.info("[afterInit] Starting IBKR keepalive loop.");
    this.startKeepalive();
  }

  _readSettings() {
    const baseUrl =
      getSetting("IBKRGW_BASE_URL") ||
      process.env.IBKRGW_BASE_URL ||
      getSetting("IBKR_BASE_URL") ||
      process.env.IBKR_BASE_URL ||
      "https://localhost:5000";
    const ssoDispatcherUrl =
      getSetting("IBKRGW_SSO_URL") ||
      process.env.IBKRGW_SSO_URL ||
      "https://localhost:5000/sso/Dispatcher?hardware_info=eyJpZCI6IjNjYzU0NWJmIiwibWFjIjoiMTY6RUY6QUY6NkQ6QzY6OUEifQ%3D%3D";
    const insecureTls = asBool(
      getSetting("IBKR_INSECURE_TLS") ?? process.env.IBKR_INSECURE_TLS,
      false
    );
    const tickleIntervalMs = asInt(
      getSetting("TICKLE_INTERVAL_MS") ?? process.env.TICKLE_INTERVAL_MS,
      50000
    );
    const authCheckIntervalMs = asInt(
      getSetting("AUTH_CHECK_INTERVAL_MS") ?? process.env.AUTH_CHECK_INTERVAL_MS,
      60000
    );
    return { baseUrl, ssoDispatcherUrl, insecureTls, tickleIntervalMs, authCheckIntervalMs };
  }

  // =========================================================
  // Settings API
  // =========================================================
  getAllSettings() {
    return getAllSettings();
  }

  setSetting(key, value) {
    return setSetting(key, value);
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

  _buildClient(baseUrl, insecureTls) {
    const config = {
      baseURL: baseUrl,
      timeout: 8000,
      validateStatus: () => true,
    };
    if (baseUrl.startsWith("https://")) {
      config.httpsAgent = new https.Agent({
        rejectUnauthorized: !insecureTls,
        keepAlive: true,
      });
    }
    return axios.create(config);
  }

  _syncClient(settings) {
    const { baseUrl, insecureTls } = settings;
    if (!baseUrl) {
      this._client = null;
      return;
    }
    if (!this._client || this._client.defaults.baseURL !== baseUrl) {
      this._client = this._buildClient(baseUrl, insecureTls);
    }
  }

  async _ensureReauth(settings) {
    if (this._reauthInFlight) {
      await this._reauthInFlight;
      return;
    }
    const { ssoDispatcherUrl } = settings || this._readSettings();
    if (!ssoDispatcherUrl) return;
    this._reauthInFlight = (async () => {
      try {
        this.logger.info(`[keepalive] sso reauth url=${ssoDispatcherUrl}`);
        const resp = await axios.get(ssoDispatcherUrl, {
          timeout: 8000,
          validateStatus: () => true,
        });
        if (resp.status === 200) {
          this.logger.trace?.(
            `[keepalive] sso reauth ok status=${resp.status}`
          );
        } else {
          this.logger.error(
            `[keepalive] sso reauth failed status=${resp.status} payload=${JSON.stringify(resp.data ?? null)}`
          );
        }
      } catch (err) {
        this.logger.warning(
          `[keepalive] sso reauth failed: ${err?.message || String(err)}`
        );
      }
    })();
    try {
      await this._reauthInFlight;
    } finally {
      this._reauthInFlight = null;
    }
  }

  async _requestWithReauth(config) {
    const settings = this._readSettings();
    this._syncClient(settings);
    if (!this._client) return { status: null, data: null };
    const resp = await this._client.request(config);
    if (resp?.status === 401) {
      await this._ensureReauth(settings);
      return this._client.request(config);
    }
    return resp;
  }

  startKeepalive() {
    if (this._timer) return;
    const settings = this._readSettings();
    this.logger.info(
      `[keepalive] IBKRGW_BASE_URL=${settings.baseUrl || "-"} insecureTls=${settings.insecureTls}`
    );
    this._tick();
    this._lastIntervalMs = settings.authCheckIntervalMs;
    this._timer = setInterval(() => this._tick(), settings.authCheckIntervalMs);
    this.logger.info(
      `[keepalive] loop started intervalMs=${settings.authCheckIntervalMs}`
    );
  }

  stopKeepalive() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  async _checkAuth() {
    try {
      const resp = await this._requestWithReauth({
        method: "GET",
        url: "/v1/api/iserver/auth/status",
      });
      this._lastAuthStatus = resp.status;
      if (resp.status >= 400) {
        this.logger.warning(
          `[keepalive] auth status warning status=${resp.status} payload=${JSON.stringify(resp.data ?? null)}`
        );
      }
    } catch (err) {
      this._lastAuthStatus = null;
      this.logger.error(
        `[keepalive] auth status error: ${err?.message || String(err)}`
      );
    }
  }

  async _tickleIfDue(intervalMs) {
    const now = Date.now();
    const last = this._lastTickleAt ? new Date(this._lastTickleAt).getTime() : 0;
    if (now - last < intervalMs) return;
    try {
      const startedAt = Date.now();
      const resp = await this._requestWithReauth({
        method: "POST",
        url: "/v1/api/tickle",
      });
      const elapsedMs = Date.now() - startedAt;
      this._lastTickleStatus = resp.status;
      this.logger.trace?.(
        `[keepalive] tickle ok status=${resp.status} latencyMs=${elapsedMs}`
      );
      if (resp.status >= 400) {
        this.logger.warning(
          `[keepalive] tickle warning status=${resp.status} payload=${JSON.stringify(resp.data ?? null)}`
        );
      }
    } catch (err) {
      this._lastTickleStatus = null;
      this.logger.error(
        `[keepalive] tickle error: ${err?.message || String(err)}`
      );
    }
    this._lastTickleAt = new Date().toISOString();
  }

  async _tick() {
    if (this._running) {
      this.logger.trace?.("[keepalive] tick skipped: already running");
      return;
    }
    this._running = true;
    const startedAt = Date.now();
    try {
      const settings = this._readSettings();
      if (settings.authCheckIntervalMs !== this._lastIntervalMs) {
        if (this._timer) clearInterval(this._timer);
        this._lastIntervalMs = settings.authCheckIntervalMs;
        this._timer = setInterval(() => this._tick(), settings.authCheckIntervalMs);
        this.logger.info(
          `[keepalive] interval updated intervalMs=${settings.authCheckIntervalMs}`
        );
      }

      this._syncClient(settings);
      await this._checkAuth();
      await this._tickleIfDue(settings.tickleIntervalMs);
      await this._publishTelemetry();
    } catch (err) {
      this.logger.error(
        `[keepalive] tick error: ${err?.message || String(err)}`
      );
    } finally {
      const elapsedMs = Date.now() - startedAt;
      this.logger.trace?.(
        `[keepalive] tick done elapsedMs=${elapsedMs}`
      );
      this._running = false;
    }
  }

  async _publishTelemetry() {
    if (!this.bus || typeof this.bus.publish !== "function") {
      this.logger.warning?.("[keepalive] telemetry publish skipped: bus not available");
      return;
    }
    const payload = {
      type: "keepalive",
      ts: Date.now(),
      env: this.env,
      status: this._status,
      lastAuthStatus: this._lastAuthStatus,
      lastTickleStatus: this._lastTickleStatus,
      lastTickleAt: this._lastTickleAt,
    };
    try {
      await this.bus.publish(this.redisTelemetyChannel, payload);
      this.logger.trace?.("[keepalive] telemetry published");
    } catch (err) {
      this.logger.warning?.(
        `[keepalive] telemetry publish failed: ${err?.message || String(err)}`
      );
    }
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
          path.resolve(process.cwd(), "__TemplateService", "release.json"),
          mainDir ? path.resolve(mainDir, "release.json") : null,
        ].filter(Boolean)
      )
    );
    for (const filePath of candidates) {
      try {
        await fs.access(filePath);
        const raw = await fs.readFile(filePath, "utf8");
        this.logger.info("[getReleaseInfo] lettura release.json", { filePath });
        return JSON.parse(raw);
      } catch {
        // tenta il prossimo percorso
      }
    }
    this.logger.warning("[getReleaseInfo] release.json non trovato", { candidates });
    return {
      lastUpdate: null,
      version: "unknown",
      microservice: "__TemplateService",
      note: ["release.json non trovato"],
    };
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
      keepalive: {
        lastAuthStatus: this._lastAuthStatus,
        lastTickleStatus: this._lastTickleStatus,
        lastTickleAt: this._lastTickleAt,
      },
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
  async connect() {
    this.startKeepalive();
    return "CONNECTED";
  }

  async disconnect() {
    this.stopKeepalive();
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

  // Accesso diretto
  getBus()    { return this.bus; }
  getLogger() { return this.logger; }
  get status() { return this._status; }
}

module.exports = IbkrKeepalive;
