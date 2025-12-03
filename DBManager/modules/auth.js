"use strict";

const { getDbConnection } = require("./core");
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
    const [res] = await conn.query("DELETE FROM users WHERE id = ?", [userId]);
    logger.info(
      `[deleteUser] userId=${userId} affectedRows=${res.affectedRows}`
    );
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

module.exports = {
  // utenti
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,

  // permessi
  getUserPermissions,
  getPermissionsForUser, // per auth-service
  addUserPermission,
  updateUserPermission,
  deleteUserPermission,
};
