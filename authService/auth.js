// auth.js (router dell'authService)
"use strict";
const bcryptjs=require("bcryptjs");
const express = require("express");
const jwt = require("jsonwebtoken");
const createAuthModule = require("./modules/auth");
const buildAuthorization = require("./modules/authorization");
const createUserClient = require("./modules/user");
const createApiKeysClient = require("./modules/apiKeys");

function buildAuthRouter({ logger, moduleName = "auth" }) {
  const router = express.Router();

  const JWT_SECRET = process.env.JWT_SECRET
  const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
  const DBMANAGER_URL = process.env.DBMANAGER_URL || "http://dbmanager:3002";

  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET non impostata! Configura la variabile d'ambiente.");
  }

  // 👇 client verso DBManager incapsulato nel modulo users
  const userClient = createUserClient({
    logger,
    dbManagerUrl: DBMANAGER_URL,
  });

  const { authorize } = buildAuthorization({ logger, userClient });

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
    touchLastLoginAt: userClient.touchLastLoginAt,
    listUserClientNavigation: userClient.listUserClientNavigation,
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
    const normalizedRow = String(rowMethod).toUpperCase();
    const normalizedReq = String(reqMethod).toUpperCase();
    if (normalizedRow === "ANY") return true;
    return normalizedRow === normalizedReq;
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
    const forwardedUri = req.headers["x-forwarded-uri"] || req.originalUrl || "/";
    const forwardedPrefix = req.headers["x-forwarded-prefix"] || "";
    const pathForAuth =
      forwardedPrefix && forwardedUri.startsWith("/")
        ? `${forwardedPrefix}${forwardedUri}`
        : forwardedPrefix || forwardedUri || originalPath || "/";

    const authHeader = req.headers["authorization"] || "";
    const apiKeyHeader =
      req.headers["x-api-key"] || req.headers["x-api_key"] || "";

    logger.log(
      `[${moduleName}] [/auth/validate] path=${originalPath} method=${originalMethod}`
    );

    // 👇 BYPASS PRE-FLIGHT CORS
    if (originalMethod === "OPTIONS") {
      logger.log(
        `[${moduleName}] [/auth/validate] preflight OPTIONS → ALLOW`
      );
      return res.status(200).end();
    }

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

        // Autorizzazione Permessi
        const subjectType = payload.subType || "user";
        const subjectId   = payload.subId   || userId;

        const method = req.get("X-Forwarded-Method") || req.method;
        const { allowed, reason } = await authorize({
          subjectType,
          subjectId,
          method,
          path : pathForAuth
        });

        if (!allowed) {
          logger.warning(
            `[auth] deny ${subjectType}:${subjectId} → ${method} ${pathForAuth} (${reason})`
          );
          return res.status(403).json({ error: "Accesso negato" });
        }

        
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

        const allowed = hasPermission(perms, pathForAuth, originalMethod);
        if (!allowed) {
          logger.warning(
            `[${moduleName}] [/auth/validate] Accesso NEGATO per API key id=${apiKeyRow.id} path=${pathForAuth} method=${originalMethod}`
          );
          return res.status(403).json({ error: "Permesso negato" });
        }

        logger.log(
          `[${moduleName}] [/auth/validate] Accesso CONSENTITO per API key id=${apiKeyRow.id} path=${pathForAuth} method=${originalMethod}`
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
      logger.info(
        `[${moduleName}] login result requires_password_reset=${result?.requires_password_reset}`
      );
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
  // 2) USER MANAGEMENT (auth/admin/user...) - semplice routing verso DBManager
  // =========================

  router.get("/admin/me", async (req, res) => {
  const authHeader = req.headers["authorization"] || "";

  try {
    if (!authHeader.startsWith("Bearer ")) {
      logger.warning(
        `[${moduleName}] [/admin/me] Bearer token mancante`
      );
      return res.status(401).json({ error: "Token mancante" });
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      logger.warning(
        `[${moduleName}] [/admin/me] Bearer token vuoto`
      );
      return res.status(401).json({ error: "Token mancante" });
    }

    let rawPayload;
    try {
      rawPayload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      logger.warning(
        `[${moduleName}] [/admin/me] JWT non valido: ${err.message}`
      );
      return res.status(401).json({ error: "Token non valido" });
    }

    // user id dal payload (compatibile con vari formati)
    const userId =
      rawPayload.sub || rawPayload.userId || rawPayload.subId;

    if (!userId) {
      logger.warning(
        `[${moduleName}] [/admin/me] JWT senza userId`
      );
      return res.status(401).json({ error: "Token non valido" });
    }

    // 1️⃣ info utente (sanitizzata)
    let user = null;
    try {
      const fullUser = await userClient.getUserById(userId);
      user = auth.sanitizeUser(fullUser);
    } catch (err) {
      logger.warning(
        `[${moduleName}] [/admin/me] getUserById error userId=${userId}: ${err.message}`
      );
    }

    // 2️⃣ navigazione client
    let clientNavigation = [];
    try {
      clientNavigation = await auth.cliNav(userId, logger);
    } catch (err) {
      logger.warning(
        `[${moduleName}] [/admin/me] cliNav error userId=${userId}: ${err.message}`
      );
    }

    // 3️⃣ pesi personalizzati
    let scoreWeights = null;
    try {
      scoreWeights = await userClient.getUserScoreWeights(userId);
    } catch (err) {
      logger.warning(
        `[${moduleName}] [/admin/me] getUserScoreWeights error userId=${userId}: ${err.message}`
      );
      scoreWeights = null;
    }

    // 3️⃣ payload token con iat/exp leggibili
    const tokenPayload = auth.formatTokenPayload(rawPayload);

    // 4️⃣ arricchisco l'oggetto utente con i pesi (se presenti)
    const userWithWeights = user
      ? {
          ...user,
          score_weights: scoreWeights ?? null,
        }
      : user;

    return res.json({
      tokenPayload,
      user: userWithWeights,
      clientNavigation,
      scoreWeights: scoreWeights ?? null,
    });
  } catch (err) {
    logger.error(
      `[${moduleName}] [/admin/me] Errore inatteso: ${err.message}`
    );
    return res.status(500).json({ error: "Errore interno" });
  }
});

  // GET /auth/admin/user
  router.get("/admin/user", async (req, res) => {
    try {
      const users = await userClient.listUsers();
      return res.json(users);
    } catch (err) {
      logger.error(`[${moduleName}] [GET /auth/admin/user] ${err.message}`);
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante la lettura utenti" });
    }
  });

  // GET /auth/admin/user/:id
  router.get("/admin/user/:id", async (req, res) => {
    const userId = req.params.id;

    try {
      const user = await userClient.getUserById(userId);
      // lasciamo a DBManager la semantica di 404/errore → qui facciamo solo pass-through
      return res.json(user);
    } catch (err) {
      logger.error(
        `[${moduleName}] [GET /auth/admin/user/:id] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante la lettura utente" });
    }
  });


  // POST /auth/admin/user
  // ⛔ Nessun hashing qui: payload viene passato “as is” a DBManager.
// POST /auth/admin/user
router.post("/admin/user", async (req, res) => {
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
    logger.error(`[${moduleName}] [POST /auth/admin/user] ${err.message}`);
    const status = err.response?.status || 500;
    return res
      .status(status)
      .json({ error: "Errore durante la creazione utente" });
  }
});


  // PUT /auth/admin/user/:id
  router.put("/admin/user/:id", async (req, res) => {
    const userId = req.params.id;

    try {
      const body = req.body || {};
      const { password, password_hash, ...rest } = body;
      let finalPasswordHash = password_hash;

      if (password) {
        const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);
        finalPasswordHash = await bcryptjs.hash(password, bcryptRounds);
      }

      const payload = {
        ...rest,
        ...(finalPasswordHash ? { password_hash: finalPasswordHash } : {}),
      };

      const result = await userClient.updateUser(userId, payload);
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [PUT /auth/admin/user/:id] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante l'aggiornamento utente" });
    }
  });

  // PUT /auth/admin/user/:id/score-weights
  router.put("/admin/user/:id/score-weights", async (req, res) => {
    const userId = req.params.id;
    const payload = req.body || {};

    try {
      const result = await userClient.updateUserScoreWeights(userId, payload);
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [PUT /auth/admin/user/:id/score-weights] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante l'aggiornamento dei pesi" });
    }
  });

  // DELETE /auth/admin/user/:id
  router.delete("/admin/user/:id", async (req, res) => {
    const userId = req.params.id;

    try {
      const result = await userClient.deleteUser(userId);
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [DELETE /auth/admin/user/:id] ${err.message}`
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

  // GET /auth/admin/user/:id/permissions
  router.get("/admin/user/:id/permissions", async (req, res) => {
    const userId = req.params.id;

    try {
      const perms = await userClient.listUserPermissions(userId);
      return res.json(perms);
    } catch (err) {
      logger.error(
        `[${moduleName}] [GET /auth/admin/user/:id/permissions] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante la lettura permessi" });
    }
  });

  // POST /auth/admin/user/:id/permissions
  router.post("/admin/user/:id/permissions", async (req, res) => {
    const userId = req.params.id;

    try {
      const result = await userClient.addUserPermission(userId, req.body);
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [POST /auth/admin/user/:id/permissions] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante la creazione del permesso" });
    }
  });

  // PUT /auth/admin/user/:id/permissions/:permId
  router.put("/admin/user/:id/permissions/:permId", async (req, res) => {
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
        `[${moduleName}] [PUT /auth/admin/user/:id/permissions/:permId] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante l'aggiornamento del permesso" });
    }
  });

  // DELETE /auth/admin/user/:id/permissions/:permId
  router.delete("/admin/user/:id/permissions/:permId", async (req, res) => {
    const userId = req.params.id;
    const permId = req.params.permId;

    try {
      const result = await userClient.deleteUserPermission(userId, permId);
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [DELETE /auth/admin/user/:id/permissions/:permId] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante la cancellazione del permesso" });
    }
  });

  // =========================
  // 3b) USER CLIENT NAVIGATION MANAGEMENT (routing puro)
  // =========================

  // GET /auth/admin/user/:id/client-nav
  router.get("/admin/user/:id/client-nav", async (req, res) => {
    const userId = req.params.id;
    try {
      const rows = await userClient.listUserClientNavigation(userId);
      return res.json(rows);
    } catch (err) {
      logger.error(
        `[${moduleName}] [GET /auth/admin/user/:id/client-nav] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante la lettura della navigazione client" });
    }
  });

  // POST /auth/admin/user/:id/client-nav
  router.post("/admin/user/:id/client-nav", async (req, res) => {
    const userId = req.params.id;
    try {
      const result = await userClient.addUserClientNavigation(userId, req.body);
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [POST /auth/admin/user/:id/client-nav] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res.status(status).json({
        error:
          err.response?.data?.error ||
          "Errore durante la creazione della navigazione client",
      });
    }
  });

  // PUT /auth/admin/user/:id/client-nav/:navId
  router.put("/admin/user/:id/client-nav/:navId", async (req, res) => {
    const userId = req.params.id;
    const navId = req.params.navId;
    try {
      const result = await userClient.updateUserClientNavigation(
        userId,
        navId,
        req.body
      );
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [PUT /auth/admin/user/:id/client-nav/:navId] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res.status(status).json({
        error:
          err.response?.data?.error ||
          "Errore durante l'aggiornamento della navigazione client",
      });
    }
  });

  // DELETE /auth/admin/user/:id/client-nav/:navId
  router.delete("/admin/user/:id/client-nav/:navId", async (req, res) => {
    const userId = req.params.id;
    const navId = req.params.navId;
    try {
      const result = await userClient.deleteUserClientNavigation(userId, navId);
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [DELETE /auth/admin/user/:id/client-nav/:navId] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res.status(status).json({
        error:
          err.response?.data?.error ||
          "Errore durante la cancellazione della navigazione client",
      });
    }
  });

  // =========================
  // 4) API KEYS MANAGEMENT
  // =========================

  // GET /auth/admin/api-keys
  router.get("/admin/api-keys", async (req, res) => {
    try {
      const keys = await apiKeysClient.listApiKeys();
      return res.json(keys);
    } catch (err) {
      logger.error(`[${moduleName}] [GET /auth/admin/api-keys] ${err.message}`);
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante la lettura delle API keys" });
    }
  });

  // GET /auth/admin/api-keys/:id
  router.get("/admin/api-keys/:id", async (req, res) => {
    const id = req.params.id;

    try {
      const key = await apiKeysClient.getApiKeyById(id);
      return res.json(key);
    } catch (err) {
      logger.error(
        `[${moduleName}] [GET /auth/admin/api-keys/:id] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({ error: "Errore durante la lettura della API key" });
    }
  });

  // POST /auth/admin/api-keys
  router.post("/admin/api-keys", async (req, res) => {
    const body = req.body || {};
    const {
      name,
      api_key,
      description,
      expires_at,
      owner_user_id,
      email,
      is_active,
    } = body;

    if (!name) {
      return res.status(400).json({ error: "name è obbligatorio" });
    }

    let createdUserId = null;
    try {
      const generatedApiKey =
        api_key ||
        `ak_${require("crypto").randomBytes(24).toString("hex")}`;
      const tempPassword = require("crypto")
        .randomBytes(24)
        .toString("hex");
      const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);
      const password_hash = await bcryptjs.hash(tempPassword, bcryptRounds);

      const userPayload = {
        username: name,
        email: email ?? null,
        password_hash,
        is_active: is_active ?? true,
        is_service: true,
      };

      const createdUser = await userClient.createUser(userPayload);
      createdUserId = createdUser?.id ?? createdUser?.insertId ?? null;

      const apiKeyPayload = {
        name,
        api_key: generatedApiKey,
        description: description ?? null,
        expires_at: expires_at ?? null,
        owner_user_id: owner_user_id ?? createdUserId,
        is_active: is_active ?? true,
      };

      const result = await apiKeysClient.createApiKey(apiKeyPayload);
      // Return api_key only on creation.
      return res.json({ ...result, user_id: createdUserId, api_key: generatedApiKey });
    } catch (err) {
      logger.error(
        `[${moduleName}] [POST /auth/admin/api-keys] ${err.message}`
      );

      if (createdUserId) {
        try {
          await userClient.deleteUser(createdUserId);
        } catch (rollbackErr) {
          logger.warning(
            `[${moduleName}] [POST /auth/admin/api-keys] rollback user delete failed userId=${createdUserId} err=${rollbackErr.message}`
          );
        }
      }

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

  // PUT /auth/admin/api-keys/:id
  router.put("/admin/api-keys/:id", async (req, res) => {
    const id = req.params.id;
    try {
      const body = req.body || {};
      const payload = {
        ...body,
        owner_user_id: body.owner_user_id === "" ? null : body.owner_user_id,
        description: body.description === "" ? null : body.description,
        expires_at: body.expires_at === "" ? null : body.expires_at,
      };
      const result = await apiKeysClient.updateApiKey(id, payload);
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [PUT /auth/admin/api-keys/:id] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res
        .status(status)
        .json({
          error:
            err.response?.data?.error ||
            err.message ||
            "Errore durante l'aggiornamento API key",
        });
    }
  });

  // DELETE /auth/admin/api-keys/:id
  router.delete("/admin/api-keys/:id", async (req, res) => {
    const id = req.params.id;
    try {
      const result = await apiKeysClient.deleteApiKey(id);
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [DELETE /auth/admin/api-keys/:id] ${err.message}`
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

  // GET /auth/admin/api-keys/:id/permissions
  router.get("/admin/api-keys/:id/permissions", async (req, res) => {
    const id = req.params.id;
    try {
      const perms = await apiKeysClient.listPermissionsForApiKey(id);
      return res.json(perms);
    } catch (err) {
      logger.error(
        `[${moduleName}] [GET /auth/admin/api-keys/:id/permissions] ${err.message}`
      );
      const status = err.response?.status || 500;
      return res.status(status).json({
        error: "Errore durante la lettura dei permessi API key",
      });
    }
  });

  // POST /auth/admin/api-keys/:id/permissions
  router.post("/admin/api-keys/:id/permissions", async (req, res) => {
    const id = req.params.id;
    try {
      const result = await apiKeysClient.addPermissionToApiKey(
        id,
        req.body || {}
      );
      return res.json(result);
    } catch (err) {
      logger.error(
        `[${moduleName}] [POST /auth/admin/api-keys/:id/permissions] ${err.message}`
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

  // PUT /auth/admin/api-keys/:id/permissions/:permId
  router.put(
    "/admin/api-keys/:id/permissions/:permId",
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
          `[${moduleName}] [PUT /auth/admin/api-keys/:id/permissions/:permId] ${err.message}`
        );
        const status = err.response?.status || 500;
        return res.status(status).json({
          error: "Errore durante l'aggiornamento del permesso API key",
        });
      }
    }
  );

  // DELETE /auth/admin/api-keys/:id/permissions/:permId
  router.delete(
    "/admin/api-keys/:id/permissions/:permId",
    async (req, res) => {
      const id = req.params.id;
      const permId = req.params.permId;

      try {
        const result =
          await apiKeysClient.deletePermissionForApiKey(id, permId);
        return res.json(result);
      } catch (err) {
        logger.error(
          `[${moduleName}] [DELETE /auth/admin/api-keys/:id/permissions/:permId] ${err.message}`
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
