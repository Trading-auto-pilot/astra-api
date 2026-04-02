"use strict";

/**
 * routes/guards.js
 *
 * Express router for volatility-event guard config endpoints.
 * Moved from inline routes in server.js.
 *
 * Routes (mount at /guards):
 *  GET   /config  — returns current guard configuration
 *  PATCH /config  — updates guard settings at runtime
 */

const express = require("express");

/**
 * @param {object} options
 * @param {Function} options.getGuardConfig
 * @param {Function} options.updateGuardConfig
 * @param {object}   [options.logger]
 * @returns {express.Router}
 */
function buildGuardsRouter({ getGuardConfig, updateGuardConfig, logger }) {
  const router = express.Router();

  router.get("/config", (_req, res) => {
    res.json({ ok: true, data: getGuardConfig() });
  });

  router.patch("/config", (req, res) => {
    try {
      const updated = updateGuardConfig(req.body || {});
      logger?.info?.(`[PATCH /guards/config] updated: ${JSON.stringify(updated)}`);
      res.json({ ok: true, data: updated });
    } catch (err) {
      logger?.error?.(`[PATCH /guards/config] ${err?.message || String(err)}`);
      res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  return router;
}

module.exports = { buildGuardsRouter };
