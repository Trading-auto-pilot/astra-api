// module/auth.js
"use strict";
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

/**
 * Factory del modulo auth.
 *
 * @param {object} deps
 * @param {object} deps.logger
 * @param {string} deps.moduleName
 * @param {string} deps.jwtSecret
 * @param {string} deps.jwtExpiresIn
 * @param {function} deps.findUserByUsername(username)
 * @param {function} deps.findUserByApiKey(apiKey)
 * @param {function} deps.getPermissionsForUser(userId)
 * @param {function} [deps.touchLastLoginAt(userId)]
 * @param {function} [deps.listUserClientNavigation(userId)]
 */
function createAuthModule(deps) {
  const {
    logger,
    moduleName = "auth",
    jwtSecret,
    jwtExpiresIn = "1h",
    findUserByUsername,
    findUserByApiKey,
    getPermissionsForUser,
    touchLastLoginAt,
    listUserClientNavigation,
  } = deps;

  if (!jwtSecret) {
    throw new Error(`[${moduleName}] jwtSecret non configurato`);
  }

  // ---------- Helpers ----------

  function signToken(payload) {
    return jwt.sign(payload, jwtSecret, { expiresIn: jwtExpiresIn });
  }

  async function checkPassword(plain, hash) {
    return bcrypt.compare(plain, hash);
  }

  function extractBearerToken(headers) {
    const auth = headers["authorization"] || headers["Authorization"];
    if (!auth) return null;
    const parts = auth.split(" ");
    if (parts.length !== 2) return null;
    const [scheme, token] = parts;
    if (!/^Bearer$/i.test(scheme)) return null;
    return token;
  }

  function renewTokenFromBearer(headers) {
    const token = extractBearerToken(headers || {});
    if (!token) {
      const err = new Error("Bearer token mancante");
      err.statusCode = 401;
      throw err;
    }
    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      const e = new Error(`Token non valido: ${err.message}`);
      e.statusCode = 401;
      throw e;
    }
    const payload = {
      sub: String(decoded.sub || ""),
      username: decoded.username,
      type: decoded.type,
    };
    if (!payload.sub) {
      const err = new Error("Token senza sub");
      err.statusCode = 401;
      throw err;
    }
    logger.trace(
      `[${moduleName}] renew ok userId=${payload.sub} username=${payload.username || "-"} type=${payload.type || "-"}`
    );
    const newToken = signToken(payload);
    return {
      token: newToken,
      payload,
    };
  }

  function matchPermission(perm, reqPath, reqMethod) {
    // perm: { resource_pattern, http_method, is_allowed }
    if (!perm.is_allowed) return false;

    const method = (reqMethod || "ANY").toUpperCase();
    const permMethod = perm.http_method || "ANY";

    if (permMethod !== "ANY" && permMethod !== method) {
      return false;
    }

    const pattern = perm.resource_pattern || "";
    if (!pattern) return true; // se non definito → vale sempre

    if (pattern.endsWith("/*")) {
      const base = pattern.slice(0, -2);
      return reqPath === base || reqPath.startsWith(base + "/");
    }

    return reqPath === pattern;
  }

  // ---------- API: login con username/password ----------

  async function loginWithPassword(username, password) {
    if (typeof findUserByUsername !== "function") {
      throw new Error(`[${moduleName}] findUserByUsername non implementata`);
    }

    const user = await findUserByUsername(username);

    if (!user || !user.is_active) {
      const err = new Error("Credenziali non valide");
      err.statusCode = 401;
      throw err;
    }

    logger.trace(
        `[auth] login username=${username} userId=${user.id} password=${password} hash=${user.password_hash}`
    );
    const ok = await checkPassword(password, user.password_hash);
    logger.trace(
      `[auth] login bcrypt.compare result username=${username} isValid=${ok}`
    );
    if (!ok) {
      const err = new Error("Credenziali non valide");
      err.statusCode = 401;
      throw err;
    }

    const lastLoginAt = user.last_login_at ?? null;
    logger.info(
      `[${moduleName}] loginWithPassword userId=${user.id} last_login_at=${lastLoginAt}`
    );

    // Decide reset requirement based on the value BEFORE we update last_login_at.
    const requiresPasswordReset = lastLoginAt === null || lastLoginAt === undefined;
    logger.info(
      `[${moduleName}] loginWithPassword userId=${user.id} requires_password_reset=${requiresPasswordReset}`
    );

    if (typeof touchLastLoginAt === "function") {
      try {
        await touchLastLoginAt(user.id);
      } catch (err) {
        logger.warning(
          `[${moduleName}] touchLastLoginAt failed userId=${user.id} err=${err.message}`
        );
      }
    }

    const payload = {
      sub: String(user.id),
      username: user.username,
      type: user.is_service ? "service" : "user",
    };

    const token = signToken(payload);

    logger.info(
      `[${moduleName}] loginWithPassword OK per user=${user.username} (id=${user.id})`
    );

    return {
      token,
      requires_password_reset: requiresPasswordReset,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_active: user.is_active,
        is_service: user.is_service,
        last_login_at: lastLoginAt,
      },
    };
  }

  // ---------- API: login con API key ----------

  async function loginWithApiKey(apiKey) {
    if (typeof findUserByApiKey !== "function") {
      throw new Error(`[${moduleName}] findUserByApiKey non implementata`);
    }

    const user = await findUserByApiKey(apiKey);

    if (!user || !user.is_active) {
      const err = new Error("API key non valida");
      err.statusCode = 401;
      throw err;
    }

    const payload = {
      sub: String(user.id),
      username: user.username,
      type: user.is_service ? "service" : "user",
    };

    const token = signToken(payload);

    logger.info(
      `[${moduleName}] loginWithApiKey OK per user=${user.username} (id=${user.id})`
    );

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_active: user.is_active,
        is_service: user.is_service,
      },
    };
  }

  // ---------- API: validate per Traefik ForwardAuth ----------

  async function validateForwardAuth(requestInfo) {
    const { method, path, headers } = requestInfo;

    const token = extractBearerToken(headers || {});
    if (!token) {
      logger.warning(`[${moduleName}] validate: nessun Bearer token trovato`);
      return false;
    }

    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      logger.warning(
        `[${moduleName}] validate: token non valido - ${err.message}`
      );
      return false;
    }

    const userId = decoded.sub;
    if (!userId) {
      logger.warning(`[${moduleName}] validate: token senza sub`);
      return false;
    }

    if (typeof getPermissionsForUser !== "function") {
      logger.error(
        `[${moduleName}] validate: getPermissionsForUser non implementata`
      );
      return false;
    }

    const perms = await getPermissionsForUser(userId);

    if (!Array.isArray(perms) || perms.length === 0) {
      logger.warning(
        `[${moduleName}] validate: nessun permesso per userId=${userId} path=${path} method=${method}`
      );
      return false;
    }

    const reqPath = path || "/";
    const reqMethod = method || "GET";

    const allowed = perms.some((p) => matchPermission(p, reqPath, reqMethod));

    if (!allowed) {
      logger.warning(
        `[${moduleName}] validate: accesso NEGATO userId=${userId} method=${reqMethod} path=${reqPath}`
      );
      return false;
    }

    logger.info(
      `[${moduleName}] validate: accesso CONSENTITO userId=${userId} method=${reqMethod} path=${reqPath}`
    );
    return true;
  }

  // ----------------------- User Client Navigation ----------------------- //

  /**
 * Ritorna la navigazione client per un utente (array di record user_client_navigation).
 */

function sanitizeUser(user) {
  if (!user || typeof user !== "object") return user;
  const cleaned = { ...user };
  if ("password_hash" in cleaned) {
    delete cleaned.password_hash;
  }
  return cleaned;
}

function formatTokenPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;

  const out = { ...payload };

  // iat / exp sono in secondi → trasformiamo in ISO leggibili
  if (typeof payload.iat === "number") {
    out.iat_human = new Date(payload.iat * 1000).toISOString();
  }
  if (typeof payload.exp === "number") {
    out.exp_human = new Date(payload.exp * 1000).toISOString();
  }

  return out;
}

async function cliNav(userId) {
  logger.trace(`[auth.cliNav] Fetch client navigation for userId=${userId}`);

  if (typeof listUserClientNavigation !== "function") {
    const err = new Error("listUserClientNavigation non implementata");
    err.statusCode = 500;
    throw err;
  }

  try {
    const rows = await listUserClientNavigation(userId);
    const count = Array.isArray(rows) ? rows.length : 0;
    logger.trace(
      `[${moduleName}][auth.cliNav] userId=${userId} client-nav rows=${count}`
    );

    return rows || [];
  } catch (err) {
    logger.error(
      `[${moduleName}][auth.cliNav] Error for userId=${userId}: ${err.message || err}`
    );
    throw err;
  }
}


  return {
    loginWithPassword,
    loginWithApiKey,
    validateForwardAuth,
    renewTokenFromBearer,
    cliNav,
    sanitizeUser,
    formatTokenPayload
  };
}

module.exports = createAuthModule;
