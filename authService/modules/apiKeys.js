// modules/apiKeys.js
"use strict";

const axios = require("axios");

/**
 * Client verso DBManager per gestione delle API keys e dei loro permessi.
 *
 * @param {object} deps
 * @param {object} deps.logger
 * @param {string} deps.dbManagerUrl - es: "http://dbmanager:3002"
 */
function createApiKeysClient({ logger, dbManagerUrl }) {
  const http = axios.create({
    baseURL: dbManagerUrl,
    timeout: 5000,
  });

  async function get(path, config = {}) {
    logger.log(`[ApiKeysClient] GET ${dbManagerUrl}${path}`);
    try {
      const res = await http.get(path, config);
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      logger.error(
        `[ApiKeysClient] GET ${dbManagerUrl}${path} failed: status=${status} data=${JSON.stringify(
          data
        )} err=${err.message}`
      );
      throw err;
    }
  }

  async function post(path, body, config = {}) {
    logger.log(`[ApiKeysClient] POST ${dbManagerUrl}${path}`);
    try {
      const res = await http.post(path, body, config);
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      logger.error(
        `[ApiKeysClient] POST ${dbManagerUrl}${path} failed: status=${status} data=${JSON.stringify(
          data
        )} err=${err.message}`
      );
      throw err;
    }
  }

  async function put(path, body, config = {}) {
    logger.log(`[ApiKeysClient] PUT ${dbManagerUrl}${path}`);
    try {
      const res = await http.put(path, body, config);
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      logger.error(
        `[ApiKeysClient] PUT ${dbManagerUrl}${path} failed: status=${status} data=${JSON.stringify(
          data
        )} err=${err.message}`
      );
      throw err;
    }
  }

  async function del(path, config = {}) {
    logger.log(`[ApiKeysClient] DELETE ${dbManagerUrl}${path}`);
    try {
      const res = await http.delete(path, config);
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      logger.error(
        `[ApiKeysClient] DELETE ${dbManagerUrl}${path} failed: status=${status} data=${JSON.stringify(
          data
        )} err=${err.message}`
      );
      throw err;
    }
  }

  // ==============
  // API KEYS CRUD
  // ==============

  function listApiKeys() {
    return get("/auth/api-keys");
  }

  function getApiKeyById(id) {
    return get(`/auth/api-keys/${encodeURIComponent(id)}`);
  }

  function createApiKey(payload) {
    return post("/auth/api-keys", payload);
  }

  function updateApiKey(id, payload) {
    return put(`/auth/api-keys/${encodeURIComponent(id)}`, payload);
  }

  function deleteApiKey(id) {
    return del(`/auth/api-keys/${encodeURIComponent(id)}`);
  }

  function findByValue(apiKeyValue) {
    return get(`/auth/api-keys/lookup?api_key=${encodeURIComponent(apiKeyValue)}`);
  }

  // ==========================
  // PERMISSIONS per API KEY
  // ==========================

  function listPermissionsForApiKey(apiKeyId) {
    return get(`/auth/api-keys/${encodeURIComponent(apiKeyId)}/permissions`);
  }

  function addPermissionToApiKey(apiKeyId, payload) {
    return post(
      `/auth/api-keys/${encodeURIComponent(apiKeyId)}/permissions`,
      payload
    );
  }

  function updatePermissionForApiKey(apiKeyId, permId, payload) {
    return put(
      `/auth/api-keys/${encodeURIComponent(
        apiKeyId
      )}/permissions/${encodeURIComponent(permId)}`,
      payload
    );
  }

  function deletePermissionForApiKey(apiKeyId, permId) {
    return del(
      `/auth/api-keys/${encodeURIComponent(
        apiKeyId
      )}/permissions/${encodeURIComponent(permId)}`
    );
  }

  return {
    // API keys
    listApiKeys,
    getApiKeyById,
    createApiKey,
    updateApiKey,
    deleteApiKey,
    findByValue,

    // Permessi
    listPermissionsForApiKey,
    addPermissionToApiKey,
    updatePermissionForApiKey,
    deletePermissionForApiKey,
  };
}

module.exports = createApiKeysClient;
