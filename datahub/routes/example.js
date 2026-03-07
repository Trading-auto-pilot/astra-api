// routes/example.js
// Example manual route for datahub
// This file demonstrates how to create custom endpoints
// This route will be mounted at: /api/custom/example

"use strict";

const express = require("express");

module.exports = function ({ logger, schemaReader }) {
  const router = express.Router();

  /**
   * GET /api/custom/example/hello
   * Simple hello world endpoint
   */
  router.get("/hello", async (req, res) => {
    return res.json({
      ok: true,
      message: "Hello from custom endpoint!",
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/custom/example/database-stats
   * Get statistics about the database
   */
  router.get("/database-stats", async (req, res) => {
    try {
      const database = schemaReader.config.database;

      // Get table count
      const [tableResult] = await schemaReader.query(
        `SELECT COUNT(*) as count
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ?
         AND TABLE_TYPE = 'BASE TABLE'`,
        [database]
      );

      // Get view count
      const [viewResult] = await schemaReader.query(
        `SELECT COUNT(*) as count
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ?
         AND TABLE_TYPE = 'VIEW'`,
        [database]
      );

      // Get total rows count across all tables (approximation)
      const [rowsResult] = await schemaReader.query(
        `SELECT SUM(TABLE_ROWS) as total
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ?
         AND TABLE_TYPE = 'BASE TABLE'`,
        [database]
      );

      return res.json({
        ok: true,
        database,
        stats: {
          tables: tableResult[0]?.count || 0,
          views: viewResult[0]?.count || 0,
          totalRowsApprox: rowsResult[0]?.total || 0,
        },
      });
    } catch (err) {
      logger.error(
        `[custom/example/database-stats] Error: ${err?.message || String(err)}`
      );
      return res.status(500).json({
        ok: false,
        error: err?.message || String(err),
      });
    }
  });

  /**
   * POST /api/custom/example/query
   * Execute a custom SELECT query (read-only for safety)
   * Body: { sql: "SELECT ...", params: [] }
   */
  router.post("/query", async (req, res) => {
    try {
      const { sql, params = [] } = req.body;

      if (!sql) {
        return res.status(400).json({
          ok: false,
          error: "sql parameter is required",
        });
      }

      // Safety check: only allow SELECT queries
      const trimmedSql = sql.trim().toUpperCase();
      if (!trimmedSql.startsWith("SELECT")) {
        return res.status(400).json({
          ok: false,
          error: "Only SELECT queries are allowed",
        });
      }

      const [rows] = await schemaReader.query(sql, params);

      return res.json({
        ok: true,
        data: rows,
        count: rows.length,
      });
    } catch (err) {
      logger.error(
        `[custom/example/query] Error: ${err?.message || String(err)}`
      );
      return res.status(500).json({
        ok: false,
        error: err?.message || String(err),
      });
    }
  });

  return router;
};
