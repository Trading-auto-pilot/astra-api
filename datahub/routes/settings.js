// routes/settings.js
"use strict";

/**
 * Legacy DBManager-compatible /settings endpoint
 *
 * This endpoint provides backward compatibility with the DBManager /settings endpoint
 * so that all microservices using loadSettings.js can migrate transparently to datahub.
 *
 * DBManager format:
 * - GET /settings → Array of {param_key, param_value, active}
 *
 * This endpoint reads from the 'settings' table and returns the same format.
 */

module.exports = function({ logger, schemaReader }) {
  const express = require("express");
  const router = express.Router();

  /**
   * GET /settings
   * Returns all active settings in DBManager-compatible format
   *
   * Response format (compatible with loadSettings.js):
   * [
   *   { param_key: "KEY1", param_value: "value1", active: true },
   *   { param_key: "KEY2", param_value: "value2", active: false },
   *   ...
   * ]
   */
  router.get("/", async (req, res) => {
    try {
      logger.debug("[GET /settings] Fetching settings (DBManager-compatible endpoint)");

      // Query the settings table
      const [rows] = await schemaReader.query(
        "SELECT param_key, param_value, active FROM settings ORDER BY param_key"
      );

      // Return array directly (DBManager format)
      // The loadSettings.js accepts both:
      // - Direct array: res.data = [...]
      // - Wrapped: res.data.data = [...]
      // We use direct array for maximum compatibility
      return res.json(rows);
    } catch (err) {
      logger.error(
        `[GET /settings] Error: ${err?.message || String(err)}`
      );

      // Return empty array on error (same as DBManager on DB issues)
      // This allows microservices to continue with cached settings
      return res.status(500).json({
        error: err?.message || String(err),
        settings: [],
      });
    }
  });

  /**
   * GET /settings/:key
   * Get a specific setting by key (optional, for direct access)
   */
  router.get("/:key", async (req, res) => {
    try {
      const { key } = req.params;

      logger.debug(`[GET /settings/${key}] Fetching specific setting`);

      const [rows] = await schemaReader.query(
        "SELECT param_key, param_value, active FROM settings WHERE param_key = ? LIMIT 1",
        [key]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          error: `Setting '${key}' not found`,
        });
      }

      return res.json(rows[0]);
    } catch (err) {
      logger.error(
        `[GET /settings/${req.params.key}] Error: ${err?.message || String(err)}`
      );
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  return router;
};
