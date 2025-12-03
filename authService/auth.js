// auth.js
"use strict";

const express = require("express");
const createAuthModule = require("./module/auth");

/**
 * Costruisce il router /auth.
 *
 * @param {object} deps
 * @param {object} deps.service      - istanza del servizio principale (da module/main.js)
 * @param {object} deps.logger       - logger condiviso (createLogger)
 * @param {string} deps.moduleName   - nome del modulo (es. "auth")
 */
function buildAuthRouter({ service, logger, moduleName }) {
  const router = express.Router();

  const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_SUPER_SECRET";
  const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";

  // Il service espone i metodi DAO (li implementerai tu in module/main.js)
  const auth = createAuthModule({
    logger,
    moduleName,
    jwtSecret: JWT_SECRET,
    jwtExpiresIn: JWT_EXPIRES_IN,
    findUserByUsername: (...args) => service.findUserByUsername(...args),
    findUserByApiKey: (...args) => service.findUserByApiKey(...args),
    getPermissionsForUser: (...args) => service.getPermissionsForUser(...args),
  });

  /**
   * POST /auth/login
   * body: { username, password }
   */
  router.post("/login", async (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: "username e password sono richiesti" });
    }

    try {
      const result = await auth.loginWithPassword(username, password);
      return res.json(result); // { token, user: {...} }
    } catch (err) {
      logger.error(`[${moduleName}] login error: ${err.message}`);
      const status = err.statusCode || 401;
      return res.status(status).json({ error: err.message || "Unauthorized" });
    }
  });

  /**
   * POST /auth/login/api-key
   * header: x-api-key: ...
   * oppure body: { apiKey }
   */
  router.post("/login/api-key", async (req, res) => {
    const apiKey = req.headers["x-api-key"] || req.body?.apiKey;

    if (!apiKey) {
      return res.status(400).json({ error: "API key mancante" });
    }

    try {
      const result = await auth.loginWithApiKey(apiKey);
      return res.json(result); // { token, user: {...} }
    } catch (err) {
      logger.error(`[${moduleName}] login/api-key error: ${err.message}`);
      const status = err.statusCode || 401;
      return res.status(status).json({ error: err.message || "Unauthorized" });
    }
  });

  /**
   * GET /auth/validate
   * Endpoint per Traefik ForwardAuth
   */
  router.get("/validate", async (req, res) => {
    try {
      const requestInfo = {
        method: req.headers["x-forwarded-method"] || req.method,
        path: req.headers["x-forwarded-uri"] || req.originalUrl,
        headers: req.headers,
      };

      const ok = await auth.validateForwardAuth(requestInfo);

      if (!ok) {
        return res.status(403).json({ error: "Forbidden" });
      }

      return res.status(200).json({ status: "OK" });
    } catch (err) {
      logger.error(`[${moduleName}] validate error: ${err.message}`);
      return res.status(403).json({ error: "Forbidden" });
    }
  });

  return router;
}

module.exports = buildAuthRouter;
