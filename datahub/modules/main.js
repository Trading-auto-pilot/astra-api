// modules/main.js
"use strict";

const BaseService = require("../../shared/BaseService");
const { SchemaReader } = require("./schemaReader");
const { DynamicRouterGenerator } = require("./dynamicRouterGenerator");
const { ManualRoutesLoader } = require("./manualRoutesLoader");
const { CacheManager } = require("./cacheManager");
const { CachingTableManager } = require("./cachingTableManager");
const { asInt } = require("../../shared/helpers");
const { getConfigString, getConfigInt, getConfigBoolean } = require("../../shared/loadSettings");

/**
 * Datahub - Dynamic Database API microservice
 *
 * This service extends BaseService which provides:
 * - Redis Bus connection
 * - Logger with DB queuing
 * - Settings management
 * - Standard endpoints
 * - Metrics collection
 * - Graceful shutdown
 *
 * Datahub-specific features:
 * - Reads MySQL schema and generates CRUD endpoints for all tables/views
 * - Supports custom manual routes in routes/ folder
 * - Hot reload via /api/refresh endpoint
 */
class Datahub extends BaseService {
  constructor() {
    super({
      microservice: "datahub",
      moduleName: "main",
      moduleVersion: "1.0.0",
      enableDbSettings: false, // Datahub has direct DB access, no need for HTTP settings loading
    });

    // =====================================================
    // DATAHUB-SPECIFIC PROPERTIES
    // =====================================================

    // MySQL connection config
    this.mysqlConfig = {
      host: getConfigString("MYSQL_HOST", "localhost"),
      port: getConfigInt("MYSQL_PORT", 3306),
      user: getConfigString("MYSQL_USER", "root"),
      password: getConfigString(["MYSQL_PASSWORD", "MYSQL_ROOT_PASSWORD"], ""),
      database: getConfigString("MYSQL_DATABASE", "trading"),
      simulDatabase: getConfigString("MYSQL_SIMUL", ""),
    };

    // Redis caching config
    this.redisConfig = {
      redis: {
        enabled: getConfigBoolean("REDIS_CACHE_ENABLED", false),
        host: getConfigString("REDIS_HOST", "localhost"),
        port: getConfigInt("REDIS_PORT", 6379),
        password: getConfigString("REDIS_PASSWORD", "") || undefined,
        db: getConfigInt("REDIS_DB", 0),
        keyPrefix: getConfigString("REDIS_KEY_PREFIX", "datahub"),
      },
    };

    // Schema reader
    this.schemaReader = new SchemaReader({
      logger: this.logger,
      config: this.mysqlConfig,
    });

    // Cache manager
    this.cacheManager = new CacheManager({
      logger: this.logger,
      config: this.redisConfig,
    });

    // Caching table manager
    this.cachingTableManager = new CachingTableManager({
      logger: this.logger,
      schemaReader: this.schemaReader,
    });

    // Dynamic router generator (will receive cache managers after init)
    this.routerGenerator = null;

    // Manual routes loader
    this.manualRoutesLoader = new ManualRoutesLoader({
      logger: this.logger,
    });

    // Storage for generated routers
    this.dynamicRouters = new Map();
    this.manualRouters = [];
    this.schema = [];
    this.lastSchemaRefresh = null;
  }

  /**
   * Custom initialization hook
   * Called after Redis connection and settings loading
   */
  async _onInit() {
    this.logger.info("[_onInit] Initializing datahub...");

    // Connect to MySQL
    await this.schemaReader.connect();

    // Connect to Redis for caching
    await this.cacheManager.connect();

    // Load schema first
    this.schema = await this.schemaReader.readSchema();

    // Initialize caching table (creates __caching if not exists and syncs with schema)
    await this.cachingTableManager.initialize(this.schema);

    // Create router generator with cache managers
    this.routerGenerator = new (require("./dynamicRouterGenerator").DynamicRouterGenerator)({
      logger: this.logger,
      schemaReader: this.schemaReader,
      cacheManager: this.cacheManager,
      cachingTableManager: this.cachingTableManager,
    });

    // Generate routes
    await this.refreshSchema();

    this.logger.info("[_onInit] Datahub initialization complete");
  }

  /**
   * Refresh schema: read database schema and regenerate all endpoints
   */
  async refreshSchema() {
    this.logger.info("[refreshSchema] Reading database schema...");

    try {
      // Read schema from database
      this.schema = await this.schemaReader.readSchema();

      // Sync caching table with current schema
      await this.cachingTableManager.syncWithSchema(this.schema);

      // Generate dynamic routers for each table/view
      this.dynamicRouters = this.routerGenerator.generateRoutersForSchema(
        this.schema
      );

      // Load manual routes
      this.manualRouters = await this.manualRoutesLoader.loadManualRoutes({
        logger: this.logger,
        schemaReader: this.schemaReader,
      });

      this.lastSchemaRefresh = new Date().toISOString();

      this.logger.info(
        `[refreshSchema] Schema refreshed: ${this.dynamicRouters.size} tables/views, ${this.manualRouters.length} manual routes`
      );

      return {
        ok: true,
        tables: this.dynamicRouters.size,
        manualRoutes: this.manualRouters.length,
        lastRefresh: this.lastSchemaRefresh,
      };
    } catch (err) {
      this.logger.error(
        `[refreshSchema] Error: ${err?.message || String(err)}`
      );
      throw err;
    }
  }

  /**
   * Custom cleanup hook
   * Called during graceful shutdown, before Redis is closed
   */
  async _onShutdown() {
    this.logger.info("[_onShutdown] Cleaning up...");

    try {
      await this.cacheManager.disconnect();
    } catch (e) {
      this.logger.error("[_onShutdown] Error closing Redis connection", e);
    }

    try {
      await this.schemaReader.disconnect();
    } catch (e) {
      this.logger.error("[_onShutdown] Error closing MySQL connection", e);
    }
  }

  // =====================================================
  // DATAHUB-SPECIFIC METHODS
  // =====================================================

  /**
   * Get schema information
   */
  getSchemaInfo() {
    const tableInfos = Array.from(this.dynamicRouters.values()).map((entry) => entry.info || {});
    const tablesDetailed = tableInfos.map((info) => ({
      name: info.name,
      schema: info.schema || this.mysqlConfig.database,
      type: info.type || "table",
    }));
    const tablesBySchema = tablesDetailed.reduce((acc, table) => {
      const schemaName = String(table.schema || this.mysqlConfig.database || "default");
      if (!acc[schemaName]) acc[schemaName] = [];
      acc[schemaName].push(table.name);
      return acc;
    }, {});

    Object.values(tablesBySchema).forEach((tables) => tables.sort((a, b) => a.localeCompare(b)));

    return {
      tables: Array.from(this.dynamicRouters.keys()),
      tablesDetailed,
      tablesBySchema,
      manualRoutes: this.manualRouters.map((r) => ({
        name: r.name,
        path: r.path,
      })),
      lastRefresh: this.lastSchemaRefresh,
      totalEndpoints: this.dynamicRouters.size + this.manualRouters.length,
    };
  }

  /**
   * Get dynamic routers for mounting in server
   */
  getDynamicRouters() {
    return this.dynamicRouters;
  }

  /**
   * Get manual routers for mounting in server
   */
  getManualRouters() {
    return this.manualRouters;
  }

  /**
   * Get cache manager
   */
  getCacheManager() {
    return this.cacheManager;
  }

  /**
   * Get caching table manager
   */
  getCachingTableManager() {
    return this.cachingTableManager;
  }
}

module.exports = Datahub;
