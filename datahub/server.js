// server.js
"use strict";

const express = require("express");
const { createMicroserviceServer } = require("../shared/serverFactory");
const DatahubService = require("./modules/main");

/**
 * datahub REST Server - Dynamic Database API
 *
 * Uses serverFactory which provides:
 * - Express setup with JSON middleware
 * - CORS configuration (Traefik-compatible)
 * - Service initialization
 * - requireReady middleware
 * - Standard routes (/release, /settings, /connect, /dbLogger)
 * - Status router (/status/*)
 * - Graceful shutdown
 *
 * Datahub-specific routes:
 * - /api/schema - Get schema information
 * - /api/refresh - Refresh schema and regenerate endpoints
 * - /api/table/{table} - Dynamic CRUD endpoints for each table
 * - /api/custom/{route} - Manual custom routes
 */

/**
 * Create datahub API router with schema and refresh endpoints
 */
function createDatahubRouter({ logger, getService }) {
  const router = express.Router();

  /**
   * GET /api/schema
   * Returns schema information (tables, views, manual routes)
   */
  router.get("/schema", async (req, res) => {
    try {
      const service = getService();
      const schemaInfo = service.getSchemaInfo();
      return res.json({ ok: true, ...schemaInfo });
    } catch (err) {
      logger.error(`[GET /api/schema] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        ok: false,
        error: err?.message || String(err),
      });
    }
  });

  /**
   * POST /api/refresh
   * Refresh schema: reload database schema and regenerate all endpoints
   */
  router.post("/refresh", async (req, res) => {
    try {
      logger.info("[POST /api/refresh] Refreshing schema...");
      const service = getService();
      const result = await service.refreshSchema();

      return res.json({
        ok: true,
        message: "Schema refreshed successfully.",
        ...result,
      });
    } catch (err) {
      logger.error(`[POST /api/refresh] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        ok: false,
        error: err?.message || String(err),
      });
    }
  });

  return router;
}

/**
 * Create caching configuration router
 * Manages cache settings for each table
 */
function createCachingRouter({ logger, getService }) {
  const router = express.Router();

  /**
   * GET /api/caching
   * Get all caching configurations
   */
  router.get("/", async (req, res) => {
    try {
      const service = getService();
      const cachingTableManager = service.getCachingTableManager();
      const configs = await cachingTableManager.getAllCachingConfigs();

      return res.json({
        ok: true,
        data: configs,
        count: configs.length,
      });
    } catch (err) {
      logger.error(`[GET /api/caching] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        ok: false,
        error: err?.message || String(err),
      });
    }
  });

  /**
   * GET /api/caching/:tableName
   * Get caching configuration for a specific table
   */
  router.get("/:tableName", async (req, res) => {
    try {
      const service = getService();
      const cachingTableManager = service.getCachingTableManager();
      const { tableName } = req.params;

      const config = await cachingTableManager.getCachingConfig(tableName);

      if (!config) {
        return res.status(404).json({
          ok: false,
          error: `Caching configuration for table '${tableName}' not found`,
        });
      }

      return res.json({
        ok: true,
        data: config,
      });
    } catch (err) {
      logger.error(
        `[GET /api/caching/${req.params.tableName}] Error: ${err?.message || String(err)}`
      );
      return res.status(500).json({
        ok: false,
        error: err?.message || String(err),
      });
    }
  });

  /**
   * PUT /api/caching/:tableName
   * Update caching configuration for a specific table
   */
  router.put("/:tableName", async (req, res) => {
    try {
      const service = getService();
      const cachingTableManager = service.getCachingTableManager();
      const cacheManager = service.getCacheManager();
      const { tableName } = req.params;
      const { enabled, ttl } = req.body;

      // Validate input
      if (enabled !== undefined && typeof enabled !== "boolean") {
        return res.status(400).json({
          ok: false,
          error: "enabled must be a boolean",
        });
      }

      if (ttl !== undefined && (typeof ttl !== "number" || ttl < 0)) {
        return res.status(400).json({
          ok: false,
          error: "ttl must be a non-negative number",
        });
      }

      // Update configuration
      const updatedConfig = await cachingTableManager.updateCachingConfig(tableName, {
        enabled,
        ttl,
      });

      if (!updatedConfig) {
        return res.status(404).json({
          ok: false,
          error: `Table '${tableName}' not found`,
        });
      }

      // If caching was disabled, invalidate the cache for this table
      if (enabled === false) {
        await cacheManager.invalidateTable(tableName);
        logger.info(`[PUT /api/caching/${tableName}] Cache invalidated for table`);
      }

      return res.json({
        ok: true,
        data: updatedConfig,
        message: "Caching configuration updated successfully",
      });
    } catch (err) {
      logger.error(
        `[PUT /api/caching/${req.params.tableName}] Error: ${err?.message || String(err)}`
      );
      return res.status(500).json({
        ok: false,
        error: err?.message || String(err),
      });
    }
  });

  return router;
}

/**
 * Create dynamic table router that forwards to specific table routers
 * This router resolves table routes dynamically at request time
 */
function createDynamicTableRouter({ logger, getService }) {
  const router = express.Router();

  // Forward all requests to the appropriate table router
  router.use("/:tableName", (req, res, next) => {
    const service = getService();
    const tableName = req.params.tableName;
    const dynamicRouters = service.getDynamicRouters();

    if (!dynamicRouters.has(tableName)) {
      return res.status(404).json({
        ok: false,
        error: `Table '${tableName}' not found`,
      });
    }

    // Get the table router and forward the request
    const { router: tableRouter } = dynamicRouters.get(tableName);

    // Remove the table name from the path
    req.url = req.url.replace(`/${tableName}`, "") || "/";

    // Forward to table router
    tableRouter(req, res, next);
  });

  return router;
}

/**
 * Create custom routes router that forwards to manual routes
 */
function createCustomRoutesRouter({ logger, getService }) {
  const router = express.Router();

  // Forward all requests to the appropriate custom route
  router.use((req, res, next) => {
    const service = getService();
    const manualRouters = service.getManualRouters();

    // Try to match the path with manual routes
    for (const { path, router: customRouter } of manualRouters) {
      if (req.path === path || req.path.startsWith(`${path}/`)) {
        // Remove the matched path prefix and forward to custom router
        req.url = req.url.replace(path, "") || "/";
        return customRouter(req, res, next);
      }
    }

    return res.status(404).json({
      ok: false,
      error: "Custom route not found",
    });
  });

  return router;
}

const { app, getService, logger } = createMicroserviceServer({
  ServiceClass: DatahubService,
  microservice: "datahub",
  moduleName: "RESTServer",
  moduleVersion: "1.0.0",
  defaultPort: 3000,

  // Custom routes - ORDER MATTERS: more specific routes first
  routes: [
    {
      path: "/api/caching",
      router: ({ logger, getService }) => createCachingRouter({ logger, getService }),
      protected: false,
    },
    {
      path: "/api/table",
      router: ({ logger, getService }) => createDynamicTableRouter({ logger, getService }),
      protected: false,
    },
    {
      path: "/api/custom",
      router: ({ logger, getService }) => createCustomRoutesRouter({ logger, getService }),
      protected: false,
    },
    {
      path: "/api",
      router: ({ logger, getService }) => createDatahubRouter({ logger, getService }),
      protected: false,
    },
  ],
});

// DEBUG: Log all PUT requests
app.use((req, res, next) => {
  if (req.method === 'PUT') {
    logger.log(`[DEBUG DATAHUB] ${req.method} ${req.path} | body: ${JSON.stringify(req.body)}`);
  }
  next();
});

/**
 * Override /settings endpoint to provide DBManager-compatible format
 * The serverFactory creates a /settings endpoint that returns { ok: true, data: {...} }
 * We need to return a direct array for DBManager compatibility: [{ param_key, param_value, active }, ...]
 *
 * This override must be registered AFTER createMicroserviceServer() so it replaces the default route
 */

// Remove all existing /settings routes
app._router.stack = app._router.stack.filter(layer => {
  return !(layer.route && layer.route.path === '/settings' && layer.route.methods.get);
});

// PUT /settings/:key — upsert a setting by param_key (update if exists, insert if not)
app.put("/settings/:key", async (req, res) => {
  try {
    const service = getService();
    if (!service || service.status !== "READY") {
      return res.status(503).json({ error: "Service not ready" });
    }

    const { key } = req.params;
    const { param_value } = req.body;

    if (param_value === undefined || param_value === null) {
      return res.status(400).json({ ok: false, error: "param_value is required" });
    }

    const schemaReader = service.schemaReader;
    const value = String(param_value);

    // Try update first
    const [updateResult] = await schemaReader.query(
      "UPDATE settings SET param_value = ?, active = 1 WHERE param_key = ?",
      [value, key]
    );

    if (updateResult.affectedRows === 0) {
      // Key doesn't exist — insert it
      await schemaReader.query(
        "INSERT INTO settings (param_key, param_value, active) VALUES (?, ?, 1)",
        [key, value]
      );
      logger.info(`[PUT /settings/${key}] Inserted new setting: ${value}`);
    } else {
      logger.info(`[PUT /settings/${key}] Updated setting: ${value}`);
    }

    return res.json({ ok: true, param_key: key, param_value: value });
  } catch (err) {
    logger.error(`[PUT /settings/${req.params.key}] Error: ${err?.message || String(err)}`);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Add our DBManager-compatible /settings endpoint
app.get("/settings", async (req, res) => {
  try {
    const service = getService();
    if (!service || service.status !== "READY") {
      return res.status(503).json({
        error: "Service not ready",
      });
    }

    const schemaReader = service.schemaReader;
    logger.info("[GET /settings] Fetching settings (DBManager-compatible format)");

    const [rows] = await schemaReader.query(
      "SELECT param_key, param_value, active FROM settings ORDER BY param_key"
    );

    // Return array directly (DBManager format)
    return res.json(rows);
  } catch (err) {
    logger.error(`[GET /settings] Error: ${err?.message || String(err)}`);
    return res.status(500).json({
      error: err?.message || String(err),
      settings: [],
    });
  }
});

// Add DBManager-compatible POST /logs endpoint
app.post("/logs", async (req, res) => {
  try {
    const service = getService();
    if (!service || service.status !== "READY") {
      return res.status(503).json({
        error: "Service not ready",
      });
    }

    const schemaReader = service.schemaReader;
    const logs = req.body;

    if (!Array.isArray(logs) || logs.length === 0) {
      return res.status(400).json({
        error: "Invalid payload: expected non-empty array of logs",
      });
    }

    logger.log(`[POST /logs] Inserting ${logs.length} logs`);

    // Insert logs in batch
    const insertPromises = logs.map(async (log) => {
      const {
        timestamp,
        level,
        functionName,
        message,
        jsonDetails,
        microservice,
        moduleName,
        moduleVersion,
      } = log;

      // Convert timestamp to MySQL datetime format if needed
      let mysqlTimestamp = timestamp;
      if (timestamp && timestamp.includes(' ')) {
        // Already in "YYYY-MM-DD HH:MM:SS" format
        mysqlTimestamp = timestamp;
      } else if (timestamp) {
        // Convert ISO to MySQL format
        mysqlTimestamp = new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
      }

      const [result] = await schemaReader.query(
        `INSERT INTO logs (timestamp, level, functionName, message, jsonDetails, microservice, moduleName, moduleVersion)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mysqlTimestamp,
          level,
          functionName,
          message,
          jsonDetails,
          microservice,
          moduleName,
          moduleVersion,
        ]
      );

      return result;
    });

    await Promise.all(insertPromises);

    logger.log(`[POST /logs] Successfully inserted ${logs.length} logs`);

    // Return DBManager-compatible response
    return res.json({
      ok: true,
      inserted: logs.length,
    });
  } catch (err) {
    logger.error(`[POST /logs] Error: ${err?.message || String(err)}`);
    return res.status(500).json({
      error: err?.message || String(err),
    });
  }
});

/**
 * Add DBManager-compatible /auth endpoints
 * AuthService uses these endpoints for user, role, and permission management
 * This router is loaded from routes/auth.js
 */
const path = require("path");
const authRouterFactory = require("./routes/auth.js");
const fundamentalsCompatRouterFactory = require("./routes/fundamentalsCompat.js");

app.use("/auth", (req, res, next) => {
  const service = getService();
  if (!service || service.status !== "READY") {
    return res.status(503).json({
      error: "Service not ready",
    });
  }

  const schemaReader = service.schemaReader;
  const authRouter = authRouterFactory({ logger, schemaReader });

  // Forward to auth router
  authRouter(req, res, next);
});

/**
 * DBManager-compatible /fundamentals/* endpoints
 * Used by tickerScanner and other services that haven't migrated to /api/table/* yet.
 */
app.use("/fundamentals", (req, res, next) => {
  const service = getService();
  if (!service || service.status !== "READY") {
    return res.status(503).json({ error: "Service not ready" });
  }
  const schemaReader = service.schemaReader;
  const fundamentalsRouter = fundamentalsCompatRouterFactory({ logger, schemaReader });
  fundamentalsRouter(req, res, next);
});
