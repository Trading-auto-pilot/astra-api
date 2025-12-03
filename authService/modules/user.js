// module/users.js
"use strict";

const axios = require("axios");

/**
 * Client verso DBManager per gestione utenti e permessi.
 *
 * @param {object} deps
 * @param {object} deps.logger
 * @param {string} deps.dbManagerUrl - es: "http://dbmanager:3002"
 */
function createUserClient({ logger, dbManagerUrl }) {
  const http = axios.create({
    baseURL: dbManagerUrl,
    timeout: 5000,
  });

  async function get(path, config = {}) {
    logger.log(`[UserClient] GET ${dbManagerUrl}${path}`);
    try {
      const res = await http.get(path, config);
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      logger.error(
        `[UserClient] GET ${dbManagerUrl}${path} failed: status=${status} data=${JSON.stringify(
          data
        )} err=${err.message}`
      );
      throw err;
    }
  }

  async function post(path, body, config = {}) {
    logger.log(`[UserClient] POST ${dbManagerUrl}${path}`);
    try {
      const res = await http.post(path, body, config);
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      logger.error(
        `[UserClient] POST ${dbManagerUrl}${path} failed: status=${status} data=${JSON.stringify(
          data
        )} err=${err.message}`
      );
      throw err;
    }
  }

  async function put(path, body, config = {}) {
    logger.log(`[UserClient] PUT ${dbManagerUrl}${path}`);
    try {
      const res = await http.put(path, body, config);
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      logger.error(
        `[UserClient] PUT ${dbManagerUrl}${path} failed: status=${status} data=${JSON.stringify(
          data
        )} err=${err.message}`
      );
      throw err;
    }
  }

  async function del(path, config = {}) {
    logger.log(`[UserClient] DELETE ${dbManagerUrl}${path}`);
    try {
      const res = await http.delete(path, config);
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      logger.error(
        `[UserClient] DELETE ${dbManagerUrl}${path} failed: status=${status} data=${JSON.stringify(
          data
        )} err=${err.message}`
      );
      throw err;
    }
  }

  // ======================
  // USERS (proxy puro verso DBManager /auth/users...)
  // ======================

  async function listUsers() {
    return get("/auth/users");
  }

  async function getUserById(id) {
    return get(`/auth/users/${encodeURIComponent(id)}`);
  }

  async function createUser(payload) {
    // routing puro: passa tutto a DBManager
    return post("/auth/users", payload);
  }

  async function updateUser(id, payload) {
    return put(`/auth/users/${encodeURIComponent(id)}`, payload);
  }

  async function deleteUser(id) {
    return del(`/auth/users/${encodeURIComponent(id)}`);
  }

  // ======================
  // PERMISSIONS (proxy verso DBManager /auth/users/:id/permissions...)
  // ======================

  async function listUserPermissions(userId) {
    return get(`/auth/users/${encodeURIComponent(userId)}/permissions`);
  }

  async function addUserPermission(userId, payload) {
    return post(
      `/auth/users/${encodeURIComponent(userId)}/permissions`,
      payload
    );
  }

  async function updateUserPermission(userId, permId, payload) {
    return put(
      `/auth/users/${encodeURIComponent(
        userId
      )}/permissions/${encodeURIComponent(permId)}`,
      payload
    );
  }

  async function deleteUserPermission(userId, permId) {
    return del(
      `/auth/users/${encodeURIComponent(
        userId
      )}/permissions/${encodeURIComponent(permId)}`
    );
  }

  // ======================
  // Metodi usati da modulo auth (login/validate)
  // ======================

  async function findUserByUsername(username) {
    logger.info(`[UserClient] findUserByUsername username=${username}`);
    const users = await listUsers();
    if (!Array.isArray(users)) {
      logger.warning("[UserClient] /auth/users non ha restituito un array");
      return null;
    }

    const user = users.find((u) => u.username === username) || null;

    if (!user) {
      logger.warning(
        `[UserClient] utente non trovato username=${username}`
      );
    } else {
      logger.log(
        `[UserClient] utente trovato id=${user.id} username=${user.username}`
      );
    }

    return user;
  }

  async function getPermissionsForUser(userId) {
    logger.info(`[UserClient] getPermissionsForUser userId=${userId}`);
    const perms = await listUserPermissions(userId);

    if (!Array.isArray(perms)) {
      logger.warning(
        `[UserClient] /auth/users/${userId}/permissions non ha restituito un array`
      );
      return [];
    }

    logger.log(
      `[UserClient] getPermissionsForUser userId=${userId} perms=${perms.length}`
    );

    return perms.map((p) => ({
      permission_code: p.permission_code,
      resource_pattern: p.resource_pattern,
      http_method: p.http_method,
      is_allowed: !!p.is_allowed,
    }));
  }

  async function findUserByApiKey(apiKey) {
    logger.warning(
      "[UserClient] findUserByApiKey chiamato ma non ancora implementato"
    );
    const err = new Error("API key auth non ancora implementata");
    err.statusCode = 501;
    throw err;
  }

  return {
    // admin / management
    listUsers,
    getUserById,
    createUser,
    updateUser,
    deleteUser,

    listUserPermissions,
    addUserPermission,
    updateUserPermission,
    deleteUserPermission,

    // per login / validate
    findUserByUsername,
    findUserByApiKey,
    getPermissionsForUser,
  };
}

module.exports = createUserClient;
