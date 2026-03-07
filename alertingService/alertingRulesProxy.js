// alertingRulesProxy.js
"use strict";

const { Router } = require("express");
const axios = require("axios");
const { convertPathToDatahub, adaptDatahubResponse } = require("../shared/datahubAdapter");

const DEFAULT_DATAHUB_URL = "http://datahub:3000"; // Updated from dbmanager to datahub

function buildProxy({ logger, getDbManagerUrl }) {
  const router = Router();

  const resolveBaseUrl = () =>
    (typeof getDbManagerUrl === "function" ? getDbManagerUrl() : null) ||
    process.env.DATAHUB_URL ||
    process.env.DBMANAGER_URL ||
    DEFAULT_DATAHUB_URL;

  const forward = async (req, res, targetPath) => {
    const baseUrl = resolveBaseUrl();
    // Convert DBManager path format to datahub format (e.g., /alerting-rules -> /api/table/alerting_rules)
    const datahubPath = convertPathToDatahub(targetPath);
    const url = `${baseUrl}${datahubPath}`;

    logger?.info?.(
      `[alertingRulesProxy] ${req.method} ${req.originalUrl} -> ${url}`
    );

    try {
      const response = await axios({
        method: req.method,
        url,
        params: req.query,
        data: req.body,
        headers: {
          "Content-Type": req.headers["content-type"] || "application/json",
        },
        timeout: 15000,
        validateStatus: () => true,
      });

      // Convert datahub response format to DBManager format for frontend compatibility
      // Datahub: {ok: true, data: [...], count: N} → DBManager: {items: [...], count: N}
      const adaptedData = adaptDatahubResponse(response.data);

      return res.status(response.status).json(adaptedData);
    } catch (err) {
      logger?.error?.(
        `[alertingRulesProxy] ${req.method} ${req.originalUrl} failed: ${err?.message || String(err)}`
      );
      return res.status(502).json({
        ok: false,
        error: "Datahub proxy error",
        message: err?.message || String(err),
      });
    }
  };

  // alerting-rules
  router.all("/alerting-rules", (req, res) =>
    forward(req, res, "/alerting-rules")
  );
  router.all("/alerting-rules/:id", (req, res) =>
    forward(req, res, `/alerting-rules/${req.params.id}`)
  );

  // alerting-state
  router.all("/alerting-state", (req, res) =>
    forward(req, res, "/alerting-state")
  );
  router.all("/alerting-state/:id", (req, res) =>
    forward(req, res, `/alerting-state/${req.params.id}`)
  );

  // alerting-deliveries
  router.all("/alerting-deliveries", (req, res) =>
    forward(req, res, "/alerting-deliveries")
  );
  router.all("/alerting-deliveries/:id", (req, res) =>
    forward(req, res, `/alerting-deliveries/${req.params.id}`)
  );

  return router;
}

module.exports = buildProxy;
