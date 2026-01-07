"use strict";

const { getDbConnection } = require("./core");
const crypto = require("crypto");
const createLogger = require("../../shared/logger");

const MICROSERVICE = "DBManager";
const MODULE_NAME = "auth";
const MODULE_VERSION = "1.0";

const logger = createLogger(
  MICROSERVICE,
  MODULE_NAME,
  MODULE_VERSION,
  process.env.LOG_LEVEL || "info"
);

/**
 * Mapping riga utente → oggetto “pulito”
 */
function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    password_hash: row.password_hash,
    is_active: !!row.is_active,
    is_service: !!row.is_service,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
  };
}

/**
 * Restituisce tutti gli utenti (uso amministrativo).
 */
async function getAllUsers() {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query(
      "SELECT id, username, email, password_hash, is_active, is_service, created_at, updated_at, last_login_at FROM users ORDER BY id"
    );
    logger.info(`[getAllUsers] rows=${rows.length}`);
    return rows.map(mapUserRow);
  } catch (err) {
    logger.error("[getAllUsers] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Restituisce un utente per id.
 */
async function getUserById(userId) {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query(
      "SELECT id, username, email, password_hash, is_active, is_service, created_at, updated_at, last_login_at FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (!rows.length) {
      logger.info(`[getUserById] userId=${userId} not found`);
      return null;
    }
    return mapUserRow(rows[0]);
  } catch (err) {
    logger.error("[getUserById] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Aggiorna il timestamp di last_login_at per un utente.
 * (usato dopo login riuscito)
 */
async function updateLastLoginAt(userId) {
  const conn = await getDbConnection();
  try {
    const [res] = await conn.query(
      "UPDATE users SET last_login_at = NOW() WHERE id = ?",
      [userId]
    );

    logger.info(
      `[updateLastLoginAt] userId=${userId} affectedRows=${res.affectedRows}`
    );
    return { ok: true, updated: res.affectedRows };
  } catch (err) {
    logger.error("[updateLastLoginAt] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Crea un nuovo utente.
 * ATTENZIONE: ci si aspetta che password_hash sia già hashata (bcrypt) lato chiamante.
 * payload: { username, email, password_hash, is_active?, is_service? }
 */
async function createUser(payload) {
  const conn = await getDbConnection();
  try {
    const {
      username,
      email = null,
      password_hash,
      is_active = true,
      is_service = false,
    } = payload;

    const [res] = await conn.query(
      `INSERT INTO users
         (username, email, password_hash, is_active, is_service)
       VALUES (?, ?, ?, ?, ?)`,
      [username, email, password_hash, is_active ? 1 : 0, is_service ? 1 : 0]
    );

    logger.info(`[createUser] username=${username} id=${res.insertId}`);

    // Inserisce la riga di default in user_score_weights con i default della tabella
    try {
      await conn.query(
        "INSERT IGNORE INTO user_score_weights (user_id) VALUES (?)",
        [res.insertId]
      );
    } catch (e) {
      logger.warn(`[createUser] Impossibile inserire user_score_weights per user_id=${res.insertId}: ${e.message}`);
    }

    return { ok: true, id: res.insertId };
  } catch (err) {
    logger.error("[createUser] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Aggiorna un utente esistente.
 * payload: { username?, email?, password_hash?, is_active?, is_service? }
 */
async function updateUser(userId, payload) {
  const conn = await getDbConnection();
  try {
    // Costruiamo dinamicamente i campi da aggiornare
    const fields = [];
    const params = [];

    if (payload.username !== undefined) {
      fields.push("username = ?");
      params.push(payload.username);
    }
    if (payload.email !== undefined) {
      fields.push("email = ?");
      params.push(payload.email);
    }
    if (payload.password_hash !== undefined) {
      fields.push("password_hash = ?");
      params.push(payload.password_hash);
    }
    if (payload.is_active !== undefined) {
      fields.push("is_active = ?");
      params.push(payload.is_active ? 1 : 0);
    }
    if (payload.is_service !== undefined) {
      fields.push("is_service = ?");
      params.push(payload.is_service ? 1 : 0);
    }

    if (!fields.length) {
      logger.warning(`[updateUser] userId=${userId} nothing to update`);
      return { ok: false, updated: 0 };
    }

    params.push(userId);

    const sql = `
      UPDATE users
         SET ${fields.join(", ")}
       WHERE id = ?
    `;

    const [res] = await conn.query(sql, params);
    logger.info(
      `[updateUser] userId=${userId} affectedRows=${res.affectedRows}`
    );
    return { ok: true, updated: res.affectedRows };
  } catch (err) {
    logger.error("[updateUser] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Cancella un utente (user_permissions va in CASCADE).
 */
async function deleteUser(userId) {
  const conn = await getDbConnection();
  try {
    // Cancella prima i pesi (silenziosamente se la tabella non esiste)
    try {
      await conn.query("DELETE FROM user_score_weights WHERE user_id = ?", [userId]);
    } catch (e) {
      logger.warn(`[deleteUser] impossibile cancellare user_score_weights per userId=${userId}: ${e.message}`);
    }

    const [res] = await conn.query("DELETE FROM users WHERE id = ?", [userId]);
    logger.info(`[deleteUser] userId=${userId} affectedRows=${res.affectedRows}`);
    return { ok: true, deleted: res.affectedRows };
  } catch (err) {
    logger.error("[deleteUser] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Restituisce TUTTI i permessi di un utente (uso amministrativo).
 */
async function getUserPermissions(userId) {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query(
      `SELECT
         id,
         user_id,
         permission_code,
         resource_pattern,
         http_method,
         is_allowed,
         created_at,
         updated_at
       FROM user_permissions
       WHERE user_id = ?
       ORDER BY id`,
      [userId]
    );

    logger.info(
      `[getUserPermissions] userId=${userId} perms=${rows.length}`
    );
    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      permission_code: r.permission_code,
      resource_pattern: r.resource_pattern,
      http_method: r.http_method,
      is_allowed: !!r.is_allowed,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  } catch (err) {
    logger.error("[getUserPermissions] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Restituisce SOLO i permessi “attivi” in forma adatta all'auth-service.
 * (usata dal microservizio auth)
 */
async function getPermissionsForUser(userId) {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query(
      `SELECT
         permission_code,
         resource_pattern,
         http_method,
         is_allowed
       FROM user_permissions
       WHERE user_id = ?`,
      [userId]
    );

    logger.info(
      `[getPermissionsForUser] userId=${userId} perms=${rows.length}`
    );

    return rows.map((r) => ({
      permission_code: r.permission_code,
      resource_pattern: r.resource_pattern,
      http_method: r.http_method,
      is_allowed: !!r.is_allowed,
    }));
  } catch (err) {
    logger.error("[getPermissionsForUser] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Crea un nuovo permesso per un utente.
 * payload: { permission_code, resource_pattern?, http_method?, is_allowed? }
 */
async function addUserPermission(userId, payload) {
  const conn = await getDbConnection();
  try {
    const {
      permission_code,
      resource_pattern = null,
      http_method = "ANY",
      is_allowed = true,
    } = payload;

    const [res] = await conn.query(
      `INSERT INTO user_permissions
         (user_id, permission_code, resource_pattern, http_method, is_allowed)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, permission_code, resource_pattern, http_method, is_allowed ? 1 : 0]
    );

    logger.info(
      `[addUserPermission] userId=${userId} permId=${res.insertId}`
    );
    return { ok: true, id: res.insertId };
  } catch (err) {
    logger.error("[addUserPermission] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Aggiorna un permesso esistente per un utente.
 * payload: { permission_code?, resource_pattern?, http_method?, is_allowed? }
 */
async function updateUserPermission(userId, permId, payload) {
  const conn = await getDbConnection();
  try {
    const fields = [];
    const params = [];

    if (payload.permission_code !== undefined) {
      fields.push("permission_code = ?");
      params.push(payload.permission_code);
    }
    if (payload.resource_pattern !== undefined) {
      fields.push("resource_pattern = ?");
      params.push(payload.resource_pattern);
    }
    if (payload.http_method !== undefined) {
      fields.push("http_method = ?");
      params.push(payload.http_method);
    }
    if (payload.is_allowed !== undefined) {
      fields.push("is_allowed = ?");
      params.push(payload.is_allowed ? 1 : 0);
    }

    if (!fields.length) {
      logger.warning(
        `[updateUserPermission] userId=${userId} permId=${permId} nothing to update`
      );
      return { ok: false, updated: 0 };
    }

    params.push(userId);
    params.push(permId);

    const sql = `
      UPDATE user_permissions
         SET ${fields.join(", ")}
       WHERE user_id = ?
         AND id = ?
    `;

    const [res] = await conn.query(sql, params);
    logger.info(
      `[updateUserPermission] userId=${userId} permId=${permId} affectedRows=${res.affectedRows}`
    );
    return { ok: true, updated: res.affectedRows };
  } catch (err) {
    logger.error("[updateUserPermission] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Cancella un permesso di un utente.
 */
async function deleteUserPermission(userId, permId) {
  const conn = await getDbConnection();
  try {
    const [res] = await conn.query(
      "DELETE FROM user_permissions WHERE user_id = ? AND id = ?",
      [userId, permId]
    );
    logger.info(
      `[deleteUserPermission] userId=${userId} permId=${permId} affectedRows=${res.affectedRows}`
    );
    return { ok: true, deleted: res.affectedRows };
  } catch (err) {
    logger.error("[deleteUserPermission] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}


// Navigazione Client

/**
 * Ritorna la navigazione client per un utente.
 */
async function getUserClientNavigation(userId) {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query(
      `
      SELECT
        id,
        user_id,
        page,
        created_at
      FROM user_client_navigation
      WHERE user_id = ?
      ORDER BY id ASC
      `,
      [userId]
    );
    logger.info(
      `[getUserClientNavigation] userId=${userId} rows=${rows.length}`
    );
    return rows;
  } catch (err) {
    logger.error("[getUserClientNavigation] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Inserisce una nuova pagina di navigazione per l'utente.
 */
async function addUserClientNavigation(userId, page) {
  const conn = await getDbConnection();
  try {
    const [res] = await conn.query(
      `
      INSERT INTO user_client_navigation (user_id, page)
      VALUES (?, ?)
      `,
      [userId, page]
    );
    logger.info(
      `[addUserClientNavigation] userId=${userId} page="${page}" insertId=${res.insertId}`
    );
    return { ok: true, id: res.insertId };
  } catch (err) {
    logger.error("[addUserClientNavigation] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Aggiorna una pagina di navigazione esistente.
 */
async function updateUserClientNavigation(userId, navId, page) {
  const conn = await getDbConnection();
  try {
    const [res] = await conn.query(
      `
      UPDATE user_client_navigation
      SET page = ?
      WHERE id = ? AND user_id = ?
      `,
      [page, navId, userId]
    );
    logger.info(
      `[updateUserClientNavigation] userId=${userId} navId=${navId} affectedRows=${res.affectedRows}`
    );
    return { ok: true, updated: res.affectedRows };
  } catch (err) {
    logger.error("[updateUserClientNavigation] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Cancella una pagina di navigazione dell'utente.
 */
async function deleteUserClientNavigation(userId, navId) {
  const conn = await getDbConnection();
  try {
    const [res] = await conn.query(
      `
      DELETE FROM user_client_navigation
      WHERE id = ? AND user_id = ?
      `,
      [navId, userId]
    );
    logger.info(
      `[deleteUserClientNavigation] userId=${userId} navId=${navId} affectedRows=${res.affectedRows}`
    );
    return { ok: true, deleted: res.affectedRows };
  } catch (err) {
    logger.error("[deleteUserClientNavigation] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}



/**
 * API KEYS
 * Tabelle:
 *   - api_keys
 *   - user_permissions (con api_key_id)
 */

// ---- API KEYS CRUD ----

async function getApiKeyByValue(apiKeyValue) {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query(
      "SELECT * FROM api_keys WHERE api_key = ? LIMIT 1",
      [apiKeyValue]
    );
    if (!rows.length) {
      logger.info(`[getApiKeyByValue] not found api_key=${apiKeyValue}`);
      return null;
    }
    return rows[0];
  } catch (err) {
    logger.error("[getApiKeyByValue] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}


async function getAllApiKeys() {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query("SELECT * FROM api_keys ORDER BY id");
    logger.info(`[getAllApiKeys] rows=${rows.length}`);
    return rows;
  } catch (err) {
    logger.error("[getAllApiKeys] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function getApiKeyById(id) {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query(
      "SELECT * FROM api_keys WHERE id = ?",
      [id]
    );
    if (!rows.length) {
      logger.info(`[getApiKeyById] not found id=${id}`);
      return null;
    }
    return rows[0];
  } catch (err) {
    logger.error("[getApiKeyById] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function createApiKey(payload) {
  const conn = await getDbConnection();
  try {
    const {
      name,
      api_key,
      owner_user_id = null,
      description = null,
      is_active = true,
      expires_at = null,
    } = payload || {};

    if (!name) {
      const msg = "name è obbligatorio";
      logger.warning(`[createApiKey] ${msg}`);
      const err = new Error(msg);
      err.statusCode = 400;
      throw err;
    }

    const finalApiKey =
      api_key || `ak_${crypto.randomBytes(24).toString("hex")}`;

    const [res] = await conn.query(
      `INSERT INTO api_keys
         (name, api_key, owner_user_id, description, is_active, expires_at)
       VALUES (?,?,?,?,?,?)`,
      [
        name,
        finalApiKey,
        owner_user_id,
        description,
        is_active ? 1 : 0,
        expires_at,
      ]
    );

    logger.info(`[createApiKey] created id=${res.insertId}`);
    return { ok: true, id: res.insertId, api_key: finalApiKey };
  } catch (err) {
    logger.error("[createApiKey] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function updateApiKey(id, payload) {
  const conn = await getDbConnection();
  try {
    // costruiamo dinamicamente SET
    const fields = [];
    const values = [];

    const allowed = [
      "name",
      "api_key",
      "owner_user_id",
      "description",
      "is_active",
      "expires_at",
    ];

    for (const key of allowed) {
      if (payload.hasOwnProperty(key)) {
        fields.push(`${key} = ?`);
        if (key === "is_active") {
          values.push(payload[key] ? 1 : 0);
        } else {
          values.push(payload[key]);
        }
      }
    }

    if (!fields.length) {
      logger.warning("[updateApiKey] niente da aggiornare");
      return { ok: false, updated: 0 };
    }

    values.push(id);

    const [res] = await conn.query(
      `UPDATE api_keys SET ${fields.join(", ")} WHERE id = ?`,
      values
    );

    logger.info(
      `[updateApiKey] id=${id} affectedRows=${res.affectedRows}`
    );
    return { ok: true, updated: res.affectedRows };
  } catch (err) {
    logger.error("[updateApiKey] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteApiKey(id) {
  const conn = await getDbConnection();
  try {
    const [res] = await conn.query(
      "DELETE FROM api_keys WHERE id = ?",
      [id]
    );
    logger.info(
      `[deleteApiKey] id=${id} affectedRows=${res.affectedRows}`
    );
    return { ok: true, deleted: res.affectedRows };
  } catch (err) {
    logger.error("[deleteApiKey] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

// ---- PERMISSIONS per API KEY (tabella user_permissions) ----

async function getPermissionsForApiKey(apiKeyId) {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query(
      `
      SELECT *
      FROM user_permissions
      WHERE api_key_id = ?
      ORDER BY id
      `,
      [apiKeyId]
    );
    logger.info(
      `[getPermissionsForApiKey] apiKeyId=${apiKeyId} rows=${rows.length}`
    );
    return rows;
  } catch (err) {
    logger.error(
      "[getPermissionsForApiKey] Error",
      err.message || err
    );
    throw err;
  } finally {
    conn.release();
  }
}

async function addPermissionToApiKey(apiKeyId, payload) {
  const conn = await getDbConnection();
  try {
    const {
      permission_code,
      resource_pattern,
      http_method,
      is_allowed = true,
    } = payload || {};

    if (!permission_code || !resource_pattern) {
      const msg = "permission_code e resource_pattern sono obbligatori";
      logger.warning(`[addPermissionToApiKey] ${msg}`);
      const err = new Error(msg);
      err.statusCode = 400;
      throw err;
    }

    const [res] = await conn.query(
      `
      INSERT INTO user_permissions
        (user_id, api_key_id, permission_code, resource_pattern, http_method, is_allowed)
      VALUES (NULL, ?, ?, ?, ?, ?)
      `,
      [
        apiKeyId,
        permission_code,
        resource_pattern,
        http_method || null,
        is_allowed ? 1 : 0,
      ]
    );

    logger.info(
      `[addPermissionToApiKey] apiKeyId=${apiKeyId} permId=${res.insertId}`
    );
    return { ok: true, id: res.insertId };
  } catch (err) {
    logger.error(
      "[addPermissionToApiKey] Error",
      err.message || err
    );
    throw err;
  } finally {
    conn.release();
  }
}

async function updatePermissionForApiKey(apiKeyId, permId, payload) {
  const conn = await getDbConnection();
  try {
    const fields = [];
    const values = [];

    const allowed = [
      "permission_code",
      "resource_pattern",
      "http_method",
      "is_allowed",
    ];

    for (const key of allowed) {
      if (payload.hasOwnProperty(key)) {
        fields.push(`${key} = ?`);
        if (key === "is_allowed") {
          values.push(payload[key] ? 1 : 0);
        } else {
          values.push(payload[key]);
        }
      }
    }

    if (!fields.length) {
      logger.warning("[updatePermissionForApiKey] niente da aggiornare");
      return { ok: false, updated: 0 };
    }

    values.push(apiKeyId, permId);

    const [res] = await conn.query(
      `
      UPDATE user_permissions
      SET ${fields.join(", ")}
      WHERE api_key_id = ? AND id = ?
      `,
      values
    );

    logger.info(
      `[updatePermissionForApiKey] apiKeyId=${apiKeyId} permId=${permId} affectedRows=${res.affectedRows}`
    );
    return { ok: true, updated: res.affectedRows };
  } catch (err) {
    logger.error(
      "[updatePermissionForApiKey] Error",
      err.message || err
    );
    throw err;
  } finally {
    conn.release();
  }
}

async function deletePermissionForApiKey(apiKeyId, permId) {
  const conn = await getDbConnection();
  try {
    const [res] = await conn.query(
      `
      DELETE FROM user_permissions
      WHERE api_key_id = ? AND id = ?
      `,
      [apiKeyId, permId]
    );
    logger.info(
      `[deletePermissionForApiKey] apiKeyId=${apiKeyId} permId=${permId} affectedRows=${res.affectedRows}`
    );
    return { ok: true, deleted: res.affectedRows };
  } catch (err) {
    logger.error(
      "[deletePermissionForApiKey] Error",
      err.message || err
    );
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Restituisce i pesi personalizzati per uno user_id dalla tabella user_score_weights.
 */
async function getUserScoreWeights(userId, pipeId = null) {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query(
      "SELECT * FROM user_score_weights WHERE user_id = ? AND pipe_id <=> ? LIMIT 1",
      [userId, pipeId]
    );
    if (!rows.length) {
      logger.info(`[getUserScoreWeights] userId=${userId} pipeId=${pipeId ?? "NULL"} non trovato`);
      return null;
    }
    return rows[0];
  } catch (err) {
    logger.error("[getUserScoreWeights] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function getUserScoreWeightsList(userId) {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query(
      "SELECT * FROM user_score_weights WHERE user_id = ? ORDER BY pipe_id ASC",
      [userId]
    );
    return rows;
  } catch (err) {
    logger.error("[getUserScoreWeightsList] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Aggiorna i pesi personalizzati per un utente nella tabella user_score_weights.
 * payload: oggetto con le colonne da aggiornare (es. { wt_growth_momentum: 0.5 })
 */
async function updateUserScoreWeights(userId, payload = {}, pipeId = null) {
  const conn = await getDbConnection();
  try {
    const fields = [];
    const params = [];

    Object.entries(payload || {}).forEach(([key, value]) => {
      if (value !== undefined) {
        if (key === "pipeId") return; // ignora alias camelCase
        fields.push(`${key} = ?`);
        params.push(value);
      }
    });

    if (!fields.length) {
      return { ok: false, updated: 0, error: "Nessun campo da aggiornare" };
    }

    params.push(userId, pipeId);

    const sql = `
      UPDATE user_score_weights
         SET ${fields.join(", ")}
       WHERE user_id = ?
         AND pipe_id <=> ?
    `;

    const [res] = await conn.query(sql, params);
    logger.info(
      `[updateUserScoreWeights] userId=${userId} pipeId=${pipeId ?? "NULL"} updated=${res.affectedRows}`
    );
    return { ok: true, updated: res.affectedRows };
  } catch (err) {
    logger.error("[updateUserScoreWeights] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Inserisce una riga in user_score_weights per userId/pipeId (se non esiste).
 */
async function insertUserScoreWeights(userId, pipeId = null) {
  const conn = await getDbConnection();
  try {
    const sql = `
      INSERT INTO user_score_weights (user_id, pipe_id)
      VALUES (?, ?)
    `;
    const [res] = await conn.query(sql, [userId, pipeId]);
    logger.info(`[insertUserScoreWeights] userId=${userId} pipeId=${pipeId ?? "NULL"} inserted=${res.affectedRows}`);
    return { ok: true, inserted: res.affectedRows, insertId: res.insertId };
  } catch (err) {
    logger.error("[insertUserScoreWeights] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteUserScoreWeights(userId, pipeId = null) {
  const conn = await getDbConnection();
  try {
    const sql = `
      DELETE FROM user_score_weights
       WHERE user_id = ?
         AND pipe_id <=> ?
    `;
    const [res] = await conn.query(sql, [userId, pipeId]);
    logger.info(
      `[deleteUserScoreWeights] userId=${userId} pipeId=${pipeId ?? "NULL"} deleted=${res.affectedRows}`
    );
    return { ok: true, deleted: res.affectedRows };
  } catch (err) {
    logger.error("[deleteUserScoreWeights] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  // API keys
  getAllApiKeys,
  getApiKeyById,
  createApiKey,
  updateApiKey,
  deleteApiKey,
  getApiKeyByValue,

  // Permessi API key
  getPermissionsForApiKey,
  addPermissionToApiKey,
  updatePermissionForApiKey,
  deletePermissionForApiKey,
  
  // utenti
  getAllUsers,
  getUserById,
  updateLastLoginAt,
  createUser,
  updateUser,
  deleteUser,

  //Navigazione utente lato client
  getUserClientNavigation,
  addUserClientNavigation,
  updateUserClientNavigation,
  deleteUserClientNavigation,

  // permessi
  getUserPermissions,
  getPermissionsForUser, // per auth-service
  addUserPermission,
  updateUserPermission,
  deleteUserPermission,
  // pesi personalizzati
  getUserScoreWeights,
  getUserScoreWeightsList,
  insertUserScoreWeights,
  deleteUserScoreWeights,
  updateUserScoreWeights,
};
