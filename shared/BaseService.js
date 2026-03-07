// BaseService.js - Base class for all microservices
"use strict";

const path = require("path");
const fs = require("fs").promises;
const createLogger = require("./logger");
const {
  initializeSettings,
  getSetting,
  reloadSettings,
  getAllSettings,
  setSetting,
  persistSetting,
} = require("./loadSettings");
const { RedisBus } = require("./redisBus");
const { publishEventsManifest } = require("./eventsManifestRegistry");
const { asBool, asInt } = require("./helpers");

/**
 * BaseService - Abstract base class for all microservices
 *
 * Provides standardized:
 * - Redis Bus connection and channel management
 * - Logger initialization with DB queuing
 * - Settings loading from DBManager
 * - Status management and health checks
 * - Metrics collection
 * - Communication channel configuration
 * - Event manifest publishing
 * - Graceful shutdown
 *
 * @example
 * class MyService extends BaseService {
 *   constructor() {
 *     super({
 *       microservice: 'my-service',
 *       moduleName: 'main',
 *       moduleVersion: '1.0.0'
 *     });
 *     // Service-specific initialization
 *   }
 *
 *   async _onInit() {
 *     // Custom initialization logic
 *     this.logger.info('[_onInit] Custom setup...');
 *   }
 * }
 */
class BaseService {
  constructor(config = {}) {
    const {
      microservice,
      moduleName = "main",
      moduleVersion = "0.1.0",
      defaultPort = 3000,
      additionalServiceUrls = {},
      customChannels = {},
      enableDbSettings = true,
      enableEventsManifest = true,
    } = config;

    if (!microservice) {
      throw new Error("BaseService requires 'microservice' parameter in config");
    }

    // =====================================================
    // Core identifiers
    // =====================================================
    this._microservice = microservice;
    this._moduleName = moduleName;
    this._moduleVersion = moduleVersion;
    this._defaultPort = defaultPort;
    this._enableDbSettings = enableDbSettings;
    this._enableEventsManifest = enableEventsManifest;

    // =====================================================
    // Service URLs - Standard microservices
    // =====================================================
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
    this.schedulerUrl = process.env.SCHEDULER_URL || "http://scheduler:3014";
    this.authServiceUrl = process.env.AUTHSERVICE_URL || "http://authService:3015";
    this.servicecontrolplaneUrl = process.env.SERVICECONTROLPLANE_URL || "http://servicecontrolplane:3016";
    this.ibkrbridgeUrl = process.env.IBKRBRIDGE_URL || "http://ibkr-bridge:3017";
    this.decisionengineUrl = process.env.DECISIONENGINE_URL || "http://decision-engine:3018";

    // Additional service URLs (for custom services)
    Object.assign(this, additionalServiceUrls);

    // =====================================================
    // Environment
    // =====================================================
    this.env = process.env.ENV || "DEV";

    // =====================================================
    // Redis channel names (standard pattern)
    // =====================================================
    this.redisTelemetryChannel = `${this.env}.${microservice}.telemetry`;
    this.redisStatusChannel = `${this.env}.${microservice}.status`;
    this.redisDataChannel = `${this.env}.${microservice}.data`;
    this.redisLogsChannel = `${this.env}.${microservice}.logs`;
    this.redisEventsChannel = `${this.env}.${microservice}.events`;

    // Custom channels from child class
    Object.assign(this, customChannels);

    // =====================================================
    // Status management
    // =====================================================
    this._status = "STARTING";
    this.statusDetails = null;

    // =====================================================
    // Communication channels configuration
    // =====================================================
    this.communicationChannels = {
      telemetry: { on: true, params: { intervalsMs: 1000 } },
      metrics: { on: true, params: { intervalsMs: 1000 } },
      data: { on: true, params: { intervalsMs: 0 } },
      logs: { on: true, params: { intervalsMs: 0 } },
      events: { on: true, params: { intervalsMs: 0 } },
    };

    // =====================================================
    // Redis Bus initialization
    // =====================================================
    this.bus = new RedisBus({
      channels: this.communicationChannels,
      url: process.env.REDIS_URL,
      name: microservice,
    });

    // =====================================================
    // Logger initialization
    // =====================================================
    process.env.MICROSERVICE_NAME = process.env.MICROSERVICE_NAME || microservice;
    this.logger = createLogger(
      microservice,
      moduleName,
      moduleVersion,
      process.env.LOG_LEVEL || "info",
      {
        bus: null, // Will be attached after bus connection
        busTopicPrefix: this.env,
        console: true,
        enqueueDb: true,
      }
    );

    this.bus.setLogger(this.logger);

    // =====================================================
    // Metrics storage
    // =====================================================
    this.metrics = [];

    // =====================================================
    // Internal state
    // =====================================================
    this.delayBetweenMessages = 500;
    this._initRetryTimer = null;
    this._releaseInfo = null;
  }

  // =========================================================
  // INITIALIZATION
  // =========================================================

  /**
   * Initialize the service:
   * 1. Connect to Redis Bus
   * 2. Attach logger to bus
   * 3. Publish events manifest
   * 4. Load settings from DB
   * 5. Call custom initialization hook (_onInit)
   * 6. Update status to READY
   */
  async init() {
    this.logger.info("[init] Initializing...");

    // 1) CONNECT REDIS BUS
    try {
      await this.bus.connect();
      this.logger.attachBus(this.bus);

      // Publish events manifest (if enabled)
      if (this._enableEventsManifest) {
        await publishEventsManifest({
          bus: this.bus,
          logger: this.logger,
          microserviceName: this._microservice,
          serviceRootDir: path.resolve(__dirname, "..", this._microservice),
        });
      }
    } catch (err) {
      this.logger.error(`[init] Redis connection failed: ${err?.message || String(err)}`);
      // Continue - service can work with degraded functionality
    }

    // STATUS: STARTING
    try {
      await this.bus.publish(this.redisStatusChannel, {
        status: "STARTING",
        details: "Loading DB settings",
      });
    } catch {
      // Ignore bus errors
    }

    // 2) LOAD SETTINGS FROM DB (if enabled)
    if (this._enableDbSettings) {
      const ok = await initializeSettings(this.dbmanagerUrl);
      if (!ok) {
        this._status = "ERROR";
        this.statusDetails = "DB unreachable";

        try {
          await this.bus.publish(this.redisStatusChannel, {
            status: this._status,
            details: this.statusDetails,
          });
        } catch {
          // Ignore bus errors
        }

        this.logger.error("[init] Failed DB initialization");

        // Schedule retry if _scheduleInitRetry is implemented
        if (typeof this._scheduleInitRetry === "function") {
          this._scheduleInitRetry("dbmanager");
        } else {
          process.exit(1);
        }
        return;
      }

      // Apply common settings
      this.delayBetweenMessages = asInt(
        getSetting("PROCESS_DELAY_BETWEEN_MESSAGES"),
        500
      );

      this.logger.info(
        `[init] Settings loaded: delayBetweenMessages=${this.delayBetweenMessages}`
      );
    }

    // 3) CUSTOM INITIALIZATION HOOK
    try {
      await this._onInit();
    } catch (err) {
      this._status = "ERROR";
      this.statusDetails = `Init hook failed: ${err?.message || String(err)}`;
      this.logger.error("[init] Custom initialization failed", err);

      try {
        await this.bus.publish(this.redisStatusChannel, {
          status: this._status,
          details: this.statusDetails,
        });
      } catch {
        // Ignore bus errors
      }

      throw err;
    }

    // 4) READY
    this._status = "READY";
    this.statusDetails = "Initialization complete";

    try {
      await this.bus.publish(this.redisStatusChannel, {
        status: this._status,
        details: this.statusDetails,
      });
    } catch {
      // Ignore bus errors
    }

    this.logger.info(`[init] ${this._microservice} initialized successfully`);
  }

  /**
   * Custom initialization hook - override in child class
   * Called after Redis connection and settings loading
   *
   * @example
   * async _onInit() {
   *   this.logger.info('[_onInit] Loading strategies...');
   *   await this._loadStrategies();
   * }
   */
  async _onInit() {
    // Override in child class
    this.logger.info("[_onInit] No custom logic (using BaseService default)");
  }

  // =========================================================
  // RELEASE INFO
  // =========================================================

  /**
   * Load release.json from service directory
   * Tries multiple candidate paths
   */
  async getReleaseInfo() {
    if (this._releaseInfo) {
      return this._releaseInfo;
    }

    const mainDir =
      (typeof require !== "undefined" &&
        require.main &&
        require.main.filename &&
        path.dirname(require.main.filename)) ||
      null;

    const candidates = Array.from(
      new Set(
        [
          path.resolve(__dirname, "..", this._microservice, "release.json"),
          path.resolve(process.cwd(), "release.json"),
          path.resolve(process.cwd(), this._microservice, "release.json"),
          mainDir ? path.resolve(mainDir, "release.json") : null,
        ].filter(Boolean)
      )
    );

    for (const filePath of candidates) {
      try {
        await fs.access(filePath);
        const raw = await fs.readFile(filePath, "utf8");
        this.logger.info("[getReleaseInfo] Loaded release.json", { filePath });
        this._releaseInfo = JSON.parse(raw);
        return this._releaseInfo;
      } catch {
        // Try next candidate
      }
    }

    this.logger.warning("[getReleaseInfo] release.json not found", { candidates });
    this._releaseInfo = {
      lastUpdate: null,
      version: "unknown",
      microservice: this._microservice,
      note: ["release.json not found"],
    };
    return this._releaseInfo;
  }

  // =========================================================
  // SETTINGS MANAGEMENT
  // =========================================================

  /**
   * Reload settings from DB without restarting the service
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

    // Custom hook for child classes
    if (typeof this._onSettingsReload === "function") {
      await this._onSettingsReload();
    }

    return {
      ok: true,
      delayBetweenMessages: this.delayBetweenMessages,
    };
  }

  /**
   * Get all settings from cache
   */
  getAllSettings() {
    return getAllSettings();
  }

  /**
   * Set a setting value (in-memory cache only — not persisted to DB)
   */
  setSetting(key, value) {
    return setSetting(key, value);
  }

  /**
   * Persist a setting to the DB (PUT /settings/:key on datahub/DBManager)
   * and update the in-memory cache. Use this when the value must survive restarts.
   * @param {string} key
   * @param {string|number} value
   * @returns {Promise<void>}
   */
  persistSetting(key, value) {
    return persistSetting(key, value);
  }

  // =========================================================
  // METRICS
  // =========================================================

  /**
   * Get recent metrics snapshot
   */
  getMetricsSnapshot(max = 100) {
    return this.metrics.slice(-max);
  }

  /**
   * Push a metric to the metrics array
   */
  pushMetric(metric) {
    metric.ts = Date.now();
    this.metrics.push(metric);
    if (this.metrics.length > 2000) this.metrics.shift();
  }

  // =========================================================
  // COMMUNICATION CHANNELS
  // =========================================================

  /**
   * Normalize channel configuration
   */
  normalizeChannels(inCfg = {}, prev = {}) {
    const ms = (v, d = 500) => Number(v ?? d) || d;

    const norm = (k) => ({
      on: !!(inCfg?.[k]?.on ?? prev?.[k]?.on ?? true),
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
      metrics: norm("metrics"),
      data: norm("data"),
      logs: norm("logs"),
      events: norm("events"),
    };
  }

  /**
   * Update communication channel configuration dynamically
   */
  async updateCommunicationChannel(newConf) {
    const cfg = this.normalizeChannels(newConf, this.communicationChannels);

    this.communicationChannels = cfg;

    // Apply config to bus
    if (typeof this.bus.applyChannels === "function") {
      await this.bus.applyChannels(cfg);
    }

    this.bus.setChannelConfig("telemetry", cfg.telemetry);
    this.bus.setChannelConfig("metrics", cfg.metrics);
    this.bus.setChannelConfig("data", cfg.data);
    this.bus.setChannelConfig("logs", cfg.logs);
    this.bus.setChannelConfig("events", cfg.events);

    this.logger.info(
      `[channels] telemetry=${cfg.telemetry.on} metrics=${cfg.metrics.on} data=${cfg.data.on} logs=${cfg.logs.on} events=${cfg.events.on}`
    );

    // Custom hook for child classes
    if (typeof this._onChannelUpdate === "function") {
      await this._onChannelUpdate(cfg);
    }

    return { ok: true, channels: cfg };
  }

  // =========================================================
  // SERVICE INFO
  // =========================================================

  /**
   * Get standardized service info
   */
  getInfo() {
    return {
      MICROSERVICE: this._microservice,
      MODULE_NAME: this._moduleName,
      MODULE_VERSION: this._moduleVersion,
      STATUS: this._status,
      STATUS_DETAILS: this.statusDetails,
      ENV: this.env,
      communicationChannels: this.communicationChannels,
      BusChannels: {
        telemetry: this.redisTelemetryChannel,
        status: this.redisStatusChannel,
        data: this.redisDataChannel,
        logs: this.redisLogsChannel,
        events: this.redisEventsChannel,
      },
    };
  }

  // =========================================================
  // LOGGING CONTROLS
  // =========================================================

  /**
   * Get current log level
   */
  getLogLevel() {
    if (typeof this.logger.getLevel === "function") {
      const lvl = this.logger.getLevel();
      return lvl || process.env.LOG_LEVEL;
    }
    return process.env.LOG_LEVEL;
  }

  /**
   * Set log level dynamically
   */
  setLogLevel(level) {
    if (typeof this.logger.setLevel === "function") {
      this.logger.setLevel(level);
      return { level };
    }
    this.logger.warning("[setLogLevel] Not supported by this logger", { level });
    return { level: process.env.LOG_LEVEL || null };
  }

  /**
   * Get DB logging status
   */
  getDbLogStatus() {
    if (typeof this.logger.getDbLogStatus === "function") {
      return this.logger.getDbLogStatus();
    }
    return { dbLogEnabled: false };
  }

  /**
   * Enable/disable DB logging
   */
  setDbLogStatus(status) {
    if (typeof this.logger.setDbLogStatus === "function") {
      return this.logger.setDbLogStatus(status);
    }
    this.logger.warning("[setDbLogStatus] Not supported by this logger", { status });
    return { dbLogEnabled: false };
  }

  // =========================================================
  // SHUTDOWN
  // =========================================================

  /**
   * Graceful shutdown
   * 1. Call custom cleanup hook (_onShutdown)
   * 2. Close Redis connections
   * 3. Update status to STOPPED
   */
  async disconnect() {
    this.logger.info("[disconnect] Shutting down...");

    this._status = "STOPPING";

    // Custom cleanup hook
    try {
      await this._onShutdown();
    } catch (err) {
      this.logger.error("[disconnect] Error in shutdown hook", err);
    }

    // Close Redis bus
    try {
      await this.bus.close();
    } catch (err) {
      this.logger.error("[disconnect] Error closing RedisBus", err);
    }

    // Clear retry timers
    if (this._initRetryTimer) {
      clearTimeout(this._initRetryTimer);
      this._initRetryTimer = null;
    }

    this._status = "STOPPED";
    this.logger.info("[disconnect] Shutdown complete");
    return this._status;
  }

  /**
   * Custom shutdown hook - override in child class
   * Called before Redis bus is closed
   *
   * @example
   * async _onShutdown() {
   *   this.logger.info('[_onShutdown] Cleaning up resources...');
   *   this.myMap.clear();
   * }
   */
  async _onShutdown() {
    // Override in child class
  }

  // =========================================================
  // ACCESSORS
  // =========================================================

  /**
   * Get Redis bus instance
   */
  getBus() {
    return this.bus;
  }

  /**
   * Get logger instance
   */
  getLogger() {
    return this.logger;
  }

  /**
   * Get current status
   */
  get status() {
    return this._status;
  }

  /**
   * Get microservice name
   */
  get microservice() {
    return this._microservice;
  }

  /**
   * Get module name
   */
  get moduleName() {
    return this._moduleName;
  }

  /**
   * Get module version
   */
  get moduleVersion() {
    return this._moduleVersion;
  }
}

module.exports = BaseService;
