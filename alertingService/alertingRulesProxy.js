// alertingRulesProxy.js
"use strict";

const { Router } = require("express");
const axios = require("axios");

const DEFAULT_DBMANAGER_URL = "http://dbmanager:3002";

function buildProxy({ logger, getDbManagerUrl }) {
  const router = Router();

  const resolveBaseUrl = () =>
    (typeof getDbManagerUrl === "function" ? getDbManagerUrl() : null) ||
    process.env.DBMANAGER_URL ||
    DEFAULT_DBMANAGER_URL;

  const forward = async (req, res, targetPath) => {
    const baseUrl = resolveBaseUrl();
    const url = `${baseUrl}${targetPath}`;

    logger?.debug?.(
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

      return res.status(response.status).json(response.data);
    } catch (err) {
      logger?.error?.(
        `[alertingRulesProxy] ${req.method} ${req.originalUrl} failed: ${err?.message || String(err)}`
      );
      return res.status(502).json({
        ok: false,
        error: "DBManager proxy error",
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
