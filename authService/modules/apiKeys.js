// modules/apiKeys.js
"use strict";

const axios = require("axios");
const { createDatahubAdapter } = require("../../shared/datahubAdapter");

/**
 * Client verso DBManager per gestione delle API keys e dei loro permessi.
 *
 * @param {object} deps
 * @param {object} deps.logger
 * @param {string} deps.dbManagerUrl - es: "http://dbmanager:3002"
 */
function createApiKeysClient({ logger, dbManagerUrl }) {
  const http = createDatahubAdapter(axios.create({
    baseURL: dbManagerUrl,
    timeout: 5000,
  }));

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

  async function listApiKeys() {
    // Usa endpoint dinamico di datahub per api_keys
    // createDatahubAdapter automatically converts { ok, data: [...] } to { items: [...] }
    const response = await get("/api/table/api_keys");
    return response.items || response;
  }

  async function getApiKeyById(id) {
    // Usa endpoint dinamico di datahub per api_keys
    // createDatahubAdapter automatically extracts data for single record
    const response = await get(`/api/table/api_keys/${encodeURIComponent(id)}`);
    return response;
  }

  function createApiKey(payload) {
    // Usa endpoint dinamico di datahub per api_keys
    return post("/api/table/api_keys", payload);
  }

  function updateApiKey(id, payload) {
    // Usa endpoint dinamico di datahub per api_keys
    return put(`/api/table/api_keys/${encodeURIComponent(id)}`, payload);
  }

  function deleteApiKey(id) {
    // Usa endpoint dinamico di datahub per api_keys
    return del(`/api/table/api_keys/${encodeURIComponent(id)}`);
  }

  async function findByValue(apiKeyValue) {
    // Usa endpoint dinamico di datahub per cercare per api_key
    // createDatahubAdapter automatically converts { ok, data: [...] } to { items: [...] }
    const response = await get(`/api/table/api_keys?api_key=${encodeURIComponent(apiKeyValue)}`);
    const results = response.items || response;
    // Restituisce il primo risultato o null
    return results && results.length > 0 ? results[0] : null;
  }

  // ==========================
  // PERMISSIONS per API KEY
  // ==========================

  async function listPermissionsForApiKey(apiKeyId) {
    // Usa endpoint dinamico di datahub per user_permissions filtrato per api_key_id
    // createDatahubAdapter automatically converts { ok, data: [...] } to { items: [...] }
    const response = await get(`/api/table/user_permissions?api_key_id=${encodeURIComponent(apiKeyId)}`);
    return response.items || response;
  }

  function addPermissionToApiKey(apiKeyId, payload) {
    // Usa endpoint dinamico di datahub per inserire in user_permissions
    return post(
      `/api/table/user_permissions`,
      { ...payload, api_key_id: apiKeyId }
    );
  }

  function updatePermissionForApiKey(apiKeyId, permId, payload) {
    // Usa endpoint dinamico di datahub per aggiornare user_permissions
    return put(
      `/api/table/user_permissions/${encodeURIComponent(permId)}`,
      payload
    );
  }

  function deletePermissionForApiKey(apiKeyId, permId) {
    // Usa endpoint dinamico di datahub per eliminare da user_permissions
    return del(
      `/api/table/user_permissions/${encodeURIComponent(permId)}`
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
