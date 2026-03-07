// module/users.js
"use strict";

const axios = require("axios");
const { createDatahubAdapter } = require("../../shared/datahubAdapter");

/**
 * Client verso DBManager per gestione utenti e permessi.
 *
 * @param {object} deps
 * @param {object} deps.logger
 * @param {string} deps.dbManagerUrl - es: "http://dbmanager:3002"
 */
function createUserClient({ logger, dbManagerUrl }) {
  const http = createDatahubAdapter(axios.create({
    baseURL: dbManagerUrl,
    timeout: 5000,
  }));

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
  // USERS (usa endpoint dinamici datahub)
  // ======================

  async function listUsers() {
    // createDatahubAdapter automatically converts { ok, data: [...] } to { items: [...] }
    const response = await get("/api/table/users");
    return response.items || response;
  }

  async function getUserById(id) {
    // createDatahubAdapter automatically extracts data for single record
    const response = await get(`/api/table/users/${encodeURIComponent(id)}`);
    return response;
  }

  async function getUserScoreWeights(id, pipeId = null) {
    // Usa endpoint dinamico per user_score_weights filtrato per user_id
    // createDatahubAdapter automatically converts { ok, data: [...] } to { items: [...] }
    const response = await get(`/api/table/user_score_weights?user_id=${encodeURIComponent(id)}`);
    const results = response.items || response;
    if (pipeId !== null && pipeId !== undefined) {
      return results.find(r => r.pipe_id === pipeId) || null;
    }
    return results;
  }

  async function createUser(payload) {
    return post("/api/table/users", payload);
  }

  async function updateUser(id, payload) {
    return put(`/api/table/users/${encodeURIComponent(id)}`, payload);
  }

  async function updateUserScoreWeights(id, payload) {
    // Aggiorna o inserisce in user_score_weights
    // createDatahubAdapter automatically converts { ok, data: [...] } to { items: [...] }
    const response = await get(`/api/table/user_score_weights?user_id=${encodeURIComponent(id)}`);
    const existing = response.items || response;
    if (existing && existing.length > 0) {
      // For PUT, adapter returns the data object directly
      const updateResponse = await put(`/api/table/user_score_weights/${existing[0].id}`, { ...payload, user_id: id });
      return updateResponse;
    } else {
      // For POST, adapter returns the data object with id
      const createResponse = await post(`/api/table/user_score_weights`, { ...payload, user_id: id });
      return createResponse;
    }
  }

  async function deleteUser(id) {
    return del(`/api/table/users/${encodeURIComponent(id)}`);
  }

  async function touchLastLoginAt(userId) {
    // Aggiorna il campo last_login_at nella tabella users
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    return put(
      `/api/table/users/${encodeURIComponent(userId)}`,
      { last_login_at: now }
    );
  }


  // ======================
  // USER CLIENT NAVIGATION (usa endpoint dinamici datahub)
  // ======================

  async function listUserClientNavigation(userId) {
    // createDatahubAdapter automatically converts { ok, data: [...] } to { items: [...] }
    const response = await get(`/api/table/user_client_navigation?user_id=${encodeURIComponent(userId)}`);
    return response.items || response;
  }

  async function addUserClientNavigation(userId, payload) {
    return post(`/api/table/user_client_navigation`, { ...payload, user_id: userId });
  }

  async function updateUserClientNavigation(userId, navId, payload) {
    return put(
      `/api/table/user_client_navigation/${encodeURIComponent(navId)}`,
      payload
    );
  }

  async function deleteUserClientNavigation(userId, navId) {
    return del(
      `/api/table/user_client_navigation/${encodeURIComponent(navId)}`
    );
  }

  // ======================
  // PERMISSIONS (usa endpoint dinamici datahub)
  // ======================

  async function listUserPermissions(userId) {
    // createDatahubAdapter automatically converts { ok, data: [...] } to { items: [...] }
    const response = await get(`/api/table/user_permissions?user_id=${encodeURIComponent(userId)}`);
    return response.items || response;
  }

  async function addUserPermission(userId, payload) {
    return post(
      `/api/table/user_permissions`,
      { ...payload, user_id: userId }
    );
  }

  async function updateUserPermission(userId, permId, payload) {
    return put(
      `/api/table/user_permissions/${encodeURIComponent(permId)}`,
      payload
    );
  }

  async function deleteUserPermission(userId, permId) {
    return del(
      `/api/table/user_permissions/${encodeURIComponent(permId)}`
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
    getUserScoreWeights,
    updateUserScoreWeights,
    deleteUser,
    touchLastLoginAt,

    // user client navigation
    listUserClientNavigation,
    addUserClientNavigation,
    updateUserClientNavigation,
    deleteUserClientNavigation,

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
