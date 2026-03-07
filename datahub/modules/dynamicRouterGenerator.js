// modules/dynamicRouterGenerator.js
"use strict";

const express = require("express");

class DynamicRouterGenerator {
  constructor({ logger, schemaReader, cacheManager, cachingTableManager }) {
    this.logger = logger;
    this.schemaReader = schemaReader;
    this.cacheManager = cacheManager;
    this.cachingTableManager = cachingTableManager;
  }

  /**
   * Generate CRUD router for a single table/view
   */
  generateRouterForTable(tableInfo) {
    const router = express.Router();
    const tableName = tableInfo.name;
    const tableType = tableInfo.type;
    const primaryKeys = tableInfo.primaryKeys || [];
    const isView = tableType === "view";
    const columns = tableInfo.columns || [];

    // Create a map of JSON columns for efficient lookup
    const jsonColumns = new Set(
      columns
        .filter((col) => col.type === "json")
        .map((col) => col.name)
    );

    // Create a map of datetime columns for efficient lookup
    const datetimeColumns = new Set(
      columns
        .filter((col) => col.type === "datetime" || col.type === "timestamp")
        .map((col) => col.name)
    );

    // Convert ISO 8601 string to MySQL DATETIME format 'YYYY-MM-DD HH:MM:SS'
    const toMysqlDatetime = (value) => {
      if (value === null || value === undefined || value === "") return value;
      // Already in MySQL format
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return value;
      // Parse ISO 8601 (with or without T/Z)
      const d = new Date(value);
      if (isNaN(d.getTime())) return value; // Not parseable, pass through
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    };

    // Helper function to serialize column values
    const serializeValue = (columnName, value) => {
      if (jsonColumns.has(columnName) && value !== null && value !== undefined) {
        // If it's a JSON column and the value is an object/array, stringify it
        if (typeof value === "object") {
          return JSON.stringify(value);
        }
        // If it's already a string, return as-is (assume it's already JSON)
        return value;
      }
      if (datetimeColumns.has(columnName) && value !== null && value !== undefined) {
        return toMysqlDatetime(value);
      }
      return value;
    };

    this.logger.info(
      `[dynamicRouter] Generating endpoints for ${tableType} ${tableName} (PK: ${primaryKeys.join(", ") || "none"}, JSON columns: ${Array.from(jsonColumns).join(", ") || "none"})`
    );

    // ========================================
    // GET /table - List all records with optional limit, offset, and filters
    // Filters support:
    // - String fields: field=value (equality)
    // - Numeric fields: field=value (equality), field=>value (greater), field=<value (less),
    //                   field=>=value (greater or equal), field=<=value (less or equal)
    // - Date ranges: field__gte=2024-01-01 (>=), field__lte=2024-12-31 (<=),
    //                field__gt=2024-01-01 (>), field__lt=2024-12-31 (<)
    // ========================================
    router.get("/", async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;

        // Validate limit
        if (limit < 1 || limit > 1000) {
          return res.status(400).json({
            ok: false,
            error: "limit must be between 1 and 1000",
          });
        }

        // Parse filters from query params (exclude limit and offset)
        const filters = [];
        const filterParams = [];
        const cacheParams = { limit, offset };

        // Extract sort params before building filters
        const sortBy = typeof req.query.sort_by === "string" ? req.query.sort_by.replace(/`/g, "``") : null;
        const sortDir = req.query.sort_dir === "asc" ? "ASC" : "DESC";

        for (const [key, value] of Object.entries(req.query)) {
          if (key === "limit" || key === "offset" || key === "sort_by" || key === "sort_dir") continue;

          let fieldName = key;
          let operator = "=";
          let actualValue = value;

          // Check for suffix-based operators (e.g., field__gte, field__lte)
          if (key.includes("__")) {
            const parts = key.split("__");
            if (parts.length === 2) {
              fieldName = parts[0];
              const suffix = parts[1];

              // Map suffix to operator
              const operatorMap = {
                gte: ">=",
                lte: "<=",
                gt: ">",
                lt: "<",
                eq: "=",
              };

              if (operatorMap[suffix]) {
                operator = operatorMap[suffix];
              }
            }
          } else if (typeof value === "string") {
            // Check for inline operators at the start: >=, <=, >, <
            // Order matters: check >= and <= before > and <
            if (value.startsWith(">=")) {
              operator = ">=";
              actualValue = value.slice(2);
            } else if (value.startsWith("<=")) {
              operator = "<=";
              actualValue = value.slice(2);
            } else if (value.startsWith(">")) {
              operator = ">";
              actualValue = value.slice(1);
            } else if (value.startsWith("<")) {
              operator = "<";
              actualValue = value.slice(1);
            }
          }

          // Add to filters
          // Use OR operator for multiple values instead of IN (mysql2 IN placeholder issues)
          if (operator === "=") {
            const values = typeof actualValue === "string" && actualValue.includes(",")
              ? actualValue.split(",").map((v) => v.trim()).filter(Boolean)
              : [actualValue];

            // Safely escape field name with backticks (protect against SQL injection)
            const safeField = String(fieldName).replace(/`/g, '``');

            if (values.length === 1) {
              // Single value - simple equality
              filters.push(`\`${safeField}\` = ?`);
              filterParams.push(values[0]);
            } else {
              // Multiple values - use OR
              const orConditions = values.map(() => `\`${safeField}\` = ?`).join(" OR ");
              filters.push(`(${orConditions})`);
              values.forEach(v => filterParams.push(v));
            }
          } else {
            // Non-equality operators (>, <, >=, <=) use standard comparison
            filters.push(`?? ${operator} ?`);
            filterParams.push(fieldName, actualValue);
          }
          cacheParams[key] = value; // Store original key with value for cache key
        }

        // Build WHERE clause
        const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

        // Check if caching is enabled for this table
        const cachingConfig = await this.cachingTableManager.getCachingConfig(tableName);
        const cacheEnabled = cachingConfig?.enabled && this.cacheManager.isEnabled();

        // Try to get from cache if enabled
        if (cacheEnabled) {
          const cacheKey = this.cacheManager.generateKey(tableName, cacheParams);
          const cached = await this.cacheManager.get(cacheKey);

          if (cached) {
            this.logger.log(`[CACHE HIT] table=${tableName} cacheKey=${cacheKey} cachedDataCount=${cached?.data?.length}`);
            this.logger.log(`[GET /${tableName}] Returning from cache`);
            return res.json(cached);
          }
        }
        this.logger.log(`[CACHE MISS or DISABLED] cacheEnabled=${cacheEnabled} table=${tableName}`);

        // Query database - use backticks for table name to avoid ?? + backtick mixing issues
        const safeTable = String(tableName).replace(/`/g, '``');
        // ORDER BY: use sort_by param if provided, otherwise default for logs table
        const orderBy = sortBy
          ? `ORDER BY \`${sortBy}\` ${sortDir}`
          : tableName === 'logs' ? 'ORDER BY id DESC' : '';
        const querySQL = `SELECT * FROM \`${safeTable}\` ${whereClause} ${orderBy} LIMIT ? OFFSET ?`;
        const queryParams = [...filterParams, limit, offset];

        // Debug - log query for multi-level filters
        if (req.query.level && String(req.query.level).includes(',')) {
          this.logger.log(`[DATAHUB DEBUG] sql="${querySQL}" params=${JSON.stringify(queryParams)} whereClause="${whereClause}"`);
        }

        const [rows] = await this.schemaReader.query(querySQL, queryParams);

        // Debug - log level distribution for multi-level queries
        if (req.query.level && String(req.query.level).includes(',')) {
          const levelCounts = {};
          rows.forEach(row => {
            levelCounts[row.level] = (levelCounts[row.level] || 0) + 1;
          });
          const firstLevels = rows.slice(0, 5).map(r => r.level);
          this.logger.log(`[DATAHUB RESULTS] totalRows=${rows.length} levelCounts=${JSON.stringify(levelCounts)} firstLevels=${JSON.stringify(firstLevels)}`);
        }

        const [countResult] = await this.schemaReader.query(
          `SELECT COUNT(*) as total FROM \`${safeTable}\` ${whereClause}`,
          filterParams
        );

        const response = {
          ok: true,
          data: rows,
          count: rows.length,
          total: countResult[0]?.total || 0,
          limit,
          offset,
          filters: filters.length > 0 ? cacheParams : undefined,
        };

        // Save to cache if enabled
        if (cacheEnabled) {
          const cacheKey = this.cacheManager.generateKey(tableName, cacheParams);
          await this.cacheManager.set(cacheKey, response, cachingConfig.ttl);
        }

        return res.json(response);
      } catch (err) {
        this.logger.error(
          `[GET /${tableName}] Error: ${err?.message || String(err)}`
        );
        return res.status(500).json({
          ok: false,
          error: err?.message || String(err),
        });
      }
    });

    // ========================================
    // GET /table/:keys - Get record by primary key(s)
    // ========================================
    if (primaryKeys.length > 0) {
      const pkParams = primaryKeys.map((_, i) => `:key${i}`).join("/");

      router.get(`/${pkParams}`, async (req, res) => {
        try {
          const keyValues = primaryKeys.map((_, i) => req.params[`key${i}`]);

          // Check if caching is enabled for this table
          const cachingConfig = await this.cachingTableManager.getCachingConfig(tableName);
          const cacheEnabled = cachingConfig?.enabled && this.cacheManager.isEnabled();

          // Build cache key params object
          const cacheParams = {};
          primaryKeys.forEach((pk, i) => {
            cacheParams[pk] = keyValues[i];
          });

          // Try to get from cache if enabled
          if (cacheEnabled) {
            const cacheKey = this.cacheManager.generateKey(tableName, cacheParams);
            const cached = await this.cacheManager.get(cacheKey);

            if (cached) {
              this.logger.debug(`[GET /${tableName}/:keys] Returning from cache`);
              return res.json(cached);
            }
          }

          // Build WHERE clause
          const whereClause = primaryKeys
            .map((pk) => `?? = ?`)
            .join(" AND ");

          const queryParams = [];
          primaryKeys.forEach((pk, i) => {
            queryParams.push(pk, keyValues[i]);
          });

          const [rows] = await this.schemaReader.query(
            `SELECT * FROM ?? WHERE ${whereClause}`,
            [tableName, ...queryParams]
          );

          if (rows.length === 0) {
            return res.status(404).json({
              ok: false,
              error: "Record not found",
            });
          }

          const response = {
            ok: true,
            data: rows[0],
          };

          // Save to cache if enabled
          if (cacheEnabled) {
            const cacheKey = this.cacheManager.generateKey(tableName, cacheParams);
            await this.cacheManager.set(cacheKey, response, cachingConfig.ttl);
          }

          return res.json(response);
        } catch (err) {
          this.logger.error(
            `[GET /${tableName}/:keys] Error: ${err?.message || String(err)}`
          );
          return res.status(500).json({
            ok: false,
            error: err?.message || String(err),
          });
        }
      });
    }

    // ========================================
    // POST /table - Create new record
    // ========================================
    if (!isView) {
      router.post("/", async (req, res) => {
        try {
          const data = req.body || {};

          if (Object.keys(data).length === 0) {
            return res.status(400).json({
              ok: false,
              error: "Request body cannot be empty",
            });
          }

          const columns = Object.keys(data);
          // Serialize JSON column values
          const values = columns.map((col) => serializeValue(col, data[col]));
          const placeholders = columns.map(() => "?").join(", ");

          const [result] = await this.schemaReader.query(
            `INSERT INTO ?? (${columns.map(() => "??").join(", ")}) VALUES (${placeholders})`,
            [tableName, ...columns, ...values]
          );

          // Get inserted record if we have auto-increment or primary keys
          let insertedRecord = null;
          if (result.insertId) {
            const [rows] = await this.schemaReader.query(
              `SELECT * FROM ?? WHERE ${primaryKeys[0]} = ?`,
              [tableName, result.insertId]
            );
            insertedRecord = rows[0] || null;
          }

          // Invalidate cache for this table
          await this.cacheManager.invalidateTable(tableName);

          return res.status(201).json({
            ok: true,
            insertedId: result.insertId || null,
            affectedRows: result.affectedRows,
            data: insertedRecord,
          });
        } catch (err) {
          this.logger.error(
            `[POST /${tableName}] Error: ${err?.message || String(err)}`
          );
          return res.status(500).json({
            ok: false,
            error: err?.message || String(err),
          });
        }
      });
    }

    // ========================================
    // PUT /table/:keys - Update record by primary key(s)
    // ========================================
    if (!isView && primaryKeys.length > 0) {
      const pkParams = primaryKeys.map((_, i) => `:key${i}`).join("/");

      router.put(`/${pkParams}`, async (req, res) => {
        try {
          const keyValues = primaryKeys.map((_, i) => req.params[`key${i}`]);
          const data = req.body || {};

          // Log incoming request body for debugging
          this.logger.log(
            `[PUT /${tableName}/:keys] Received body with fields: ${Object.keys(data).join(", ")} | values: ${JSON.stringify(data)}`
          );

          if (Object.keys(data).length === 0) {
            this.logger.error(
              `[PUT /${tableName}/:keys] Empty request body received`
            );
            return res.status(400).json({
              ok: false,
              error: "Request body cannot be empty",
            });
          }

          // Remove primary keys from update data
          const updateData = { ...data };
          primaryKeys.forEach((pk) => delete updateData[pk]);

          if (Object.keys(updateData).length === 0) {
            this.logger.error(
              `[PUT /${tableName}/:keys] No fields to update - body=${JSON.stringify(data)} primaryKeys=${JSON.stringify(primaryKeys)}`
            );
            return res.status(400).json({
              ok: false,
              error: "No fields to update (excluding primary keys)",
            });
          }

          const setClause = Object.keys(updateData)
            .map(() => "?? = ?")
            .join(", ");

          this.logger.log(
            `[PUT /${tableName}/:keys] Updating with fields: ${Object.keys(updateData).join(", ")}`
          );

          const whereClause = primaryKeys
            .map(() => "?? = ?")
            .join(" AND ");

          const setParams = [];
          Object.entries(updateData).forEach(([key, val]) => {
            // Serialize JSON column values
            setParams.push(key, serializeValue(key, val));
          });

          const whereParams = [];
          primaryKeys.forEach((pk, i) => {
            whereParams.push(pk, keyValues[i]);
          });

          const [result] = await this.schemaReader.query(
            `UPDATE ?? SET ${setClause} WHERE ${whereClause}`,
            [tableName, ...setParams, ...whereParams]
          );

          if (result.affectedRows === 0) {
            return res.status(404).json({
              ok: false,
              error: "Record not found",
            });
          }

          // Get updated record
          const queryParams = [];
          primaryKeys.forEach((pk, i) => {
            queryParams.push(pk, keyValues[i]);
          });

          const [rows] = await this.schemaReader.query(
            `SELECT * FROM ?? WHERE ${whereClause}`,
            [tableName, ...queryParams]
          );

          // Invalidate cache for this table
          await this.cacheManager.invalidateTable(tableName);

          return res.json({
            ok: true,
            affectedRows: result.affectedRows,
            data: rows[0] || null,
          });
        } catch (err) {
          this.logger.error(
            `[PUT /${tableName}/:keys] Error: ${err?.message || String(err)}`
          );
          return res.status(500).json({
            ok: false,
            error: err?.message || String(err),
          });
        }
      });
    }

    // ========================================
    // DELETE /table/:keys - Delete record by primary key(s)
    // ========================================
    if (!isView && primaryKeys.length > 0) {
      const pkParams = primaryKeys.map((_, i) => `:key${i}`).join("/");

      router.delete(`/${pkParams}`, async (req, res) => {
        try {
          const keyValues = primaryKeys.map((_, i) => req.params[`key${i}`]);

          const whereClause = primaryKeys
            .map(() => "?? = ?")
            .join(" AND ");

          const whereParams = [];
          primaryKeys.forEach((pk, i) => {
            whereParams.push(pk, keyValues[i]);
          });

          const [result] = await this.schemaReader.query(
            `DELETE FROM ?? WHERE ${whereClause}`,
            [tableName, ...whereParams]
          );

          if (result.affectedRows === 0) {
            return res.status(404).json({
              ok: false,
              error: "Record not found",
            });
          }

          // Invalidate cache for this table
          await this.cacheManager.invalidateTable(tableName);

          return res.json({
            ok: true,
            affectedRows: result.affectedRows,
            deleted: true,
          });
        } catch (err) {
          this.logger.error(
            `[DELETE /${tableName}/:keys] Error: ${err?.message || String(err)}`
          );
          return res.status(500).json({
            ok: false,
            error: err?.message || String(err),
          });
        }
      });
    }

    return router;
  }

  /**
   * Generate routers for all tables in the schema
   */
  generateRoutersForSchema(schema) {
    const routers = new Map();

    for (const tableInfo of schema) {
      const router = this.generateRouterForTable(tableInfo);
      routers.set(tableInfo.name, {
        router,
        info: tableInfo,
      });
    }

    this.logger.info(
      `[dynamicRouter] Generated ${routers.size} dynamic routers`
    );

    return routers;
  }
}

module.exports = { DynamicRouterGenerator };
