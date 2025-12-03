// auth.js (router dell'authService)
"use strict";
const bcryptjs=require("bcryptjs");
const express = require("express");
const jwt = require("jsonwebtoken");
const createAuthModule = require("./modules/auth");
const createUserClient = require("./modules/user");
const createApiKeysClient = require("./modules/apiKeys");

function buildAuthRouter({ logger, moduleName = "auth" }) {
  const router = express.Router();

  const JWT_SECRET = process.env.JWT_SECRET || "9p628egQZd%Qp&vyzi0fD";
  const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
  const DBMANAGER_URL = process.env.DBMANAGER_URL || "http://dbmanager:3002";

  // 👇 client verso DBManager incapsulato nel modulo users
  const userClient = createUserClient({
    logger,
    dbManagerUrl: DBMANAGER_URL,
  });
  const apiKeysClient = createApiKeysClient({ 
    logger, 
    dbManagerUrl: DBMANAGER_URL });

  // 👇 modulo auth riceve le funzioni già pronte
  const auth = createAuthModule({
    logger,
    moduleName,
    jwtSecret: JWT_SECRET,
    jwtExpiresIn: JWT_EXPIRES_IN,
    findUserByUsername: userClient.findUserByUsername,
    findUserByApiKey: userClient.findUserByApiKey,
    getPermissionsForUser: userClient.getPermissionsForUser,
  });

  function pathMatches(pattern, path) {
    if (!pattern) return false;
    if (pattern.endsWith("*")) {
      const base = pattern.slice(0, -1);
      return path.startsWith(base);
    }
    return path === pattern;
  }

  function isMethodAllowed(rowMethod, reqMethod) {
    if (!rowMethod) return true; // null → wildcard
    return String(rowMethod).toUpperCase() === String(reqMethod).toUpperCase();
  }

  function hasPermission(perms, path, method) {
    if (!Array.isArray(perms) || perms.length === 0) return false;
    for (const p of perms) {
      const pat = p.resource_pattern;
      const m = p.http_method;
      const allowed = !!p.is_allowed;

      if (!allowed) continue;
      if (!pat) continue;

      if (pathMatches(pat, path) && isMethodAllowed(m, method)) {
        return true;
      }
    }
    return false;
  }

  // =========================
  // VALIDAZIONE per Traefik
  // =========================
  router.all("/validate", async (req, res) => {
    const originalPath =
      req.headers["x-forwarded-uri"] || req.path || "/";
    const originalMethod =
      (req.headers["x-forwarded-method"] || req.method || "GET").toUpperCase();

    const authHeader = req.headers["authorization"] || "";
    const apiKeyHeader =
      req.headers["x-api-key"] || req.headers["x-api_key"] || "";

    logger.log(
      `[${moduleName}] [/auth/validate] path=${originalPath} method=${originalMethod}`
    );

    try {
      // 1️⃣ JWT USER FLOW (Authorization: Bearer xxx)
      if (authHeader.startsWith("Bearer ")) {
        const token = authHeader.slice("Bearer ".length).trim();
        if (!token) {
          logger.warning(
            `[${moduleName}] [/auth/validate] Bearer token vuoto`
          );
          return res.status(401).json({ error: "Token mancante" });
        }

        let payload;
        try {
          payload = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
          logger.warning(
            `[${moduleName}] [/auth/validate] JWT non valido: ${err.message}`
          );
          return res.status(401).json({ error: "Token non valido" });
        }

        const userId = payload.sub || payload.userId;
        if (!userId) {
          logger.warning(
            `[${moduleName}] [/auth/validate] JWT senza userId`
          );
          return res.status(401).json({ error: "Token non valido" });
        }

        // 🔎 TODO: in una fase successiva potrai caricare i permessi utente da DB
        // e fare lo stesso tipo di hasPermission(path, method)
        // Per ora, se l'utente è autenticato → allow all (ma puoi mettere una whitelist)
        logger.log(
          `[${moduleName}] [/auth/validate] Utente autenticato userId=${userId} → ALLOW`
        );

        res.setHeader("X-User-Id", String(userId));
        res.setHeader("X-Auth-Subject-Type", "user");
        return res.status(200).end();
      }

      // 2️⃣ API KEY FLOW (X-API-Key: ak_xxx)
      if (apiKeyHeader) {
        const apiKeyValue = apiKeyHeader.trim();
        if (!apiKeyValue) {
          logger.warning(
            `[${moduleName}] [/auth/validate] X-API-Key vuota`
          );
          return res.status(401).json({ error: "API key mancante" });
        }

        // lookup API key in DBManager
        let apiKeyRow;
        try {
          apiKeyRow = await apiKeysClient.findByValue(apiKeyValue);
        } catch (err) {
          const status = err.response?.status;
          if (status === 404) {
            logger.warning(
              `[${moduleName}] [/auth/validate] API key non trovata`
            );
            return res.status(401).json({ error: "API key non valida" });
          }
          logger.error(
            `[${moduleName}] [/auth/validate] Errore lookup API key: ${err.message}`
          );
          return res
            .status(500)
            .json({ error: "Errore durante la validazione API key" });
        }

        if (!apiKeyRow || !apiKeyRow.is_active) {
          logger.warning(
            `[${moduleName}] [/auth/validate] API key inattiva o nulla`
          );
          return res.status(401).json({ error: "API key non attiva" });
        }

        // controlla scadenza se presente
        if (apiKeyRow.expires_at) {
          const now = new Date();
          const exp = new Date(apiKeyRow.expires_at);
          if (exp < now) {
            logger.warning(
              `[${moduleName}] [/auth/validate] API key scaduta id=${apiKeyRow.id}`
            );
            return res.status(401).json({ error: "API key scaduta" });
          }
        }

        // carica permessi
        let perms = [];
        try {
          perms = await apiKeysClient.listPermissionsForApiKey(apiKeyRow.id);
        } catch (err) {
          logger.error(
            `[${moduleName}] [/auth/validate] Errore lettura permessi API key: ${err.message}`
          );
          return res
            .status(500)
            .json({ error: "Errore durante la lettura permessi API key" });
        }

        const allowed = hasPermission(perms, originalPath, originalMethod);
        if (!allowed) {
          logger.warning(
            `[${moduleName}] [/auth/validate] Accesso NEGATO per API key id=${apiKeyRow.id} path=${originalPath} method=${originalMethod}`
          );
          return res.status(403).json({ error: "Permesso negato" });
        }

        logger.log(
          `[${moduleName}] [/auth/validate] Accesso CONSENTITO per API key id=${apiKeyRow.id} path=${originalPath} method=${originalMethod}`
        );

        res.setHeader("X-Api-Key-Id", String(apiKeyRow.id));
        res.setHeader("X-Auth-Subject-Type", "api_key");
        return res.status(200).end();
      }

      // 3️⃣ Nessun token, nessuna API key
      logger.warning(
        `[${moduleName}] [/auth/validate] Nessun token JWT o API key`
      );
      return res.status(401).json({ error: "Credenziali mancanti" });
    } catch (err) {
      logger.error(
        `[${moduleName}] [/auth/validate] Errore inatteso: ${err.message}`
      );
      return res.status(500).json({ error: "Errore interno di validazione" });
    }
  });


  // =========================
  // ENDPOINTS
  // =========================

  // POST /auth/login
  router.post("/login", async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "username e password sono richiesti" });
    }

    try {
      const result = await auth.loginWithPassword(username, password);
      return res.json(result);
    } catch (err) {
      logger.error(`[${moduleName}] login error: ${err.message}`);
      const status = err.statusCode || 401;
      return res.status(status).json({ error: err.message || "Unauthorized" });
    }
  });

  // GET /auth/validate → per Traefik ForwardAuth
  router.get("/validate", async (req, res) => {
    try {
      const requestInfo = {
        method: req.headers["x-forwarded-method"] || req.method,
        path: req.headers["x-forwarded-uri"] || req.originalUrl,
        headers: req.headers,
      };

      const ok = await auth.validateForwardAuth(requestInfo);

      if (!ok) return res.status(403).json({ error: "Forbidden" });
      return res.status(200).json({ status: "OK" });
    } catch (err) {
      logger.error(`[${moduleName}] validate error: ${err.message}`);
      return res.status(403).json({ error: "Forbidden" });
    }
  });


  // =========================
  // 2) USER MANAGEMENT (auth/users...) - semplice routing verso DBManager
  // =========================

  // GET /auth/users
  router.get("/users", async (req, res) => {
    try {
      const users = await userClient.listUsers();
      return res.json(users);
    } catch (err) {
      logger.error(`[${moduleName}] [GET /auth/users] ${err.message}`);
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante la lettura utenti" });
    }
  });

  // GET /auth/users/:id
  router.get("/users/:id", async (req, res) => {
    const userId = req.params.id;

    try {
      const user = await userClient.getUserById(userId);
      // lasciamo a DBManager la semantica di 404/errore → qui facciamo solo pass-through
      return res.json(user);
    } catch (err) {
      logger.error(
        `[${moduleName}] [GET /auth/users/:id] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante la lettura utente" });
    }
  });

  // POST /auth/users
  // ⛔ Nessun hashing qui: payload viene passato “as is” a DBManager.
// POST /auth/users
router.post("/users", async (req, res) => {
  const body = req.body || {};
  const { username, password, password_hash, ...rest } = body;

  if (!username) {
    return res.status(400).json({ error: "username è obbligatorio" });
  }

  // almeno uno dei due deve esserci
  if (!password && !password_hash) {
    return res.status(400).json({
      error: "devi fornire password oppure password_hash",
    });
  }

  try {
    let finalPasswordHash = password_hash;

    // se arriva la password in chiaro → la trasformiamo in hash
    if (password) {
      const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);
      finalPasswordHash = await require("bcryptjs").hash(
        password,
        bcryptRounds
      );
    }

    const payload = {
      username,
      password_hash: finalPasswordHash,
      ...rest, // email, is_active, is_service, ecc.
    };

    const result = await userClient.createUser(payload);
    return res.json(result);
  } catch (err) {
    logger.error(`[${moduleName}] [POST /auth/users] ${err.message}`);
    const status = err.response?.status || 500;
    return res
      .status(status)
      .json({ error: "Errore durante la creazione utente" });
  }
});


  // PUT /auth/users/:id
  router.put("/users/:id", async (req, res) => {
    const userId = req.params.id;

    try {
      const result = await userClient.updateUser(userId, req.body);
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [PUT /auth/users/:id] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante l'aggiornamento utente" });
    }
  });

  // DELETE /auth/users/:id
  router.delete("/users/:id", async (req, res) => {
    const userId = req.params.id;

    try {
      const result = await userClient.deleteUser(userId);
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [DELETE /auth/users/:id] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante la cancellazione utente" });
    }
  });

  // =========================
  // 3) PERMISSIONS MANAGEMENT (routing puro)
  // =========================

  // GET /auth/users/:id/permissions
  router.get("/users/:id/permissions", async (req, res) => {
    const userId = req.params.id;

    try {
      const perms = await userClient.listUserPermissions(userId);
      return res.json(perms);
    } catch (err) {
      logger.error(
        `[${moduleName}] [GET /auth/users/:id/permissions] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante la lettura permessi" });
    }
  });

  // POST /auth/users/:id/permissions
  router.post("/users/:id/permissions", async (req, res) => {
    const userId = req.params.id;

    try {
      const result = await userClient.addUserPermission(userId, req.body);
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [POST /auth/users/:id/permissions] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante la creazione del permesso" });
    }
  });

  // PUT /auth/users/:id/permissions/:permId
  router.put("/users/:id/permissions/:permId", async (req, res) => {
    const userId = req.params.id;
    const permId = req.params.permId;

    try {
      const result = await userClient.updateUserPermission(
        userId,
        permId,
        req.body
      );
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [PUT /auth/users/:id/permissions/:permId] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante l'aggiornamento del permesso" });
    }
  });

  // DELETE /auth/users/:id/permissions/:permId
  router.delete("/users/:id/permissions/:permId", async (req, res) => {
    const userId = req.params.id;
    const permId = req.params.permId;

    try {
      const result = await userClient.deleteUserPermission(userId, permId);
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [DELETE /auth/users/:id/permissions/:permId] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante la cancellazione del permesso" });
    }
  });

  // =========================
  // 4) API KEYS MANAGEMENT
  // =========================

  // GET /auth/api-keys
  router.get("/api-keys", async (req, res) => {
    try {
      const keys = await apiKeysClient.listApiKeys();
      return res.json(keys);
    } catch (err) {
      logger.error(`[${moduleName}] [GET /auth/api-keys] ${err.message}`);
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante la lettura delle API keys" });
    }
  });

  // GET /auth/api-keys/:id
  router.get("/api-keys/:id", async (req, res) => {
    const id = req.params.id;

    try {
      const key = await apiKeysClient.getApiKeyById(id);
      return res.json(key);
    } catch (err) {
      logger.error(
        `[${moduleName}] [GET /auth/api-keys/:id] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante la lettura della API key" });
    }
  });

  // POST /auth/api-keys
  router.post("/api-keys", async (req, res) => {
    try {
      const result = await apiKeysClient.createApiKey(req.body || {});
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [POST /auth/api-keys] ${err.message}`
      );
      const status = err.response?.status || 500;
      // DBManager manda già messaggio utile in err.message
      return res.status(status).json({
        error:
          err.response?.data?.error ||
          err.message ||
          "Errore durante la creazione API key",
      });
    }
  });

  // PUT /auth/api-keys/:id
  router.put("/api-keys/:id", async (req, res) => {
    const id = req.params.id;
    try {
      const result = await apiKeysClient.updateApiKey(id, req.body || {});
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [PUT /auth/api-keys/:id] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante l'aggiornamento API key" });
    }
  });

  // DELETE /auth/api-keys/:id
  router.delete("/api-keys/:id", async (req, res) => {
    const id = req.params.id;
    try {
      const result = await apiKeysClient.deleteApiKey(id);
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [DELETE /auth/api-keys/:id] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante la cancellazione API key" });
    }
  });

  // =========================
  // 5) API KEY PERMISSIONS
  // =========================

  // GET /auth/api-keys/:id/permissions
  router.get("/api-keys/:id/permissions", async (req, res) => {
    const id = req.params.id;
    try {
      const perms = await apiKeysClient.listPermissionsForApiKey(id);
      return res.json(perms);
    } catch (err) {
      logger.error(
        `[${moduleName}] [GET /auth/api-keys/:id/permissions] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res.status(status).json({
        error: "Errore durante la lettura dei permessi API key",
      });
    }
  });

  // POST /auth/api-keys/:id/permissions
  router.post("/api-keys/:id/permissions", async (req, res) => {
    const id = req.params.id;
    try {
      const result = await apiKeysClient.addPermissionToApiKey(
        id,
        req.body || {}
      );
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [POST /auth/api-keys/:id/permissions] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res.status(status).json({
        error:
          err.response?.data?.error ||
          err.message ||
          "Errore durante la creazione permesso API key",
      });
    }
  });

  // PUT /auth/api-keys/:id/permissions/:permId
  router.put(
    "/api-keys/:id/permissions/:permId",
    async (req, res) => {
      const id = req.params.id;
      const permId = req.params.permId;

      try {
        const result = await apiKeysClient.updatePermissionForApiKey(
          id,
          permId,
          req.body || {}
        );
        return res.json(result);
      } catch (err) {
        logger.error(
          `[${moduleName}] [PUT /auth/api-keys/:id/permissions/:permId] ${err.message}`
        );
        const status = err.response?.status || 500;
        return res.status(status).json({
          error: "Errore durante l'aggiornamento del permesso API key",
        });
      }
    }
  );

  // DELETE /auth/api-keys/:id/permissions/:permId
  router.delete(
    "/api-keys/:id/permissions/:permId",
    async (req, res) => {
      const id = req.params.id;
      const permId = req.params.permId;

      try {
        const result =
          await apiKeysClient.deletePermissionForApiKey(id, permId);
        return res.json(result);
      } catch (err) {
        logger.error(
          `[${moduleName}] [DELETE /auth/api-keys/:id/permissions/:permId] ${err.message}`
        );
        const status = err.response?.status || 500;
        return res.status(status).json({
          error: "Errore durante la cancellazione del permesso API key",
        });
      }
    }
  );

  return router;
}

module.exports = buildAuthRouter;
