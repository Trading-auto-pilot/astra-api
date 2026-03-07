// shared/datahubAdapter.js
"use strict";

/**
 * DBManager-compatible adapter for datahub responses
 *
 * This adapter converts datahub response format to DBManager format
 * to allow transparent migration from DBManager to datahub.
 *
 * Response formats:
 *
 * DBManager (old):
 * - GET list: { items: [...], count: N }
 * - GET single: { id: X, field: "value", ... }
 * - POST: { id: insertedId, field: "value", ... }
 * - PUT: { id: X, field: "value", ... }
 * - DELETE: { affectedRows: N }
 *
 * Datahub (new):
 * - GET list: { ok: true, data: [...], count: N, total: N, limit: 100, offset: 0 }
 * - GET single: { ok: true, data: { id: X, field: "value", ... } }
 * - POST: { ok: true, insertedId: X, data: { id: X, field: "value", ... } }
 * - PUT: { ok: true, affectedRows: N, data: { id: X, field: "value", ... } }
 * - DELETE: { ok: true, affectedRows: N }
 *
 * Usage:
 * ```javascript
 * const { adaptDatahubResponse } = require('./datahubAdapter');
 *
 * // Convert datahub response to DBManager format
 * const dbManagerFormat = adaptDatahubResponse(datahubResponse);
 * ```
 */

/**
 * Adapt a datahub response to DBManager format
 *
 * @param {Object} response - Axios response object from datahub
 * @param {Object} options - Adaptation options
 * @param {string} options.type - Response type: 'list', 'single', 'post', 'put', 'delete', 'auto' (default: 'auto')
 * @returns {Object|Array} DBManager-compatible response
 */
function adaptDatahubResponse(response, options = {}) {
  const { type = 'auto' } = options;

  // Handle axios response structure
  // If response has status property, it's an axios response - extract data
  // Otherwise, assume it's already the data object
  const data = (response?.status !== undefined) ? response.data : response;

  // If not a datahub response (no 'ok' field), return as-is (already DBManager format)
  if (data?.ok === undefined) {
    return data;
  }

  // Detect response type automatically
  let detectedType = type;
  if (type === 'auto') {
    // Check data.data exists and is valid
    const hasDataField = data?.data !== undefined && data?.data !== null;

    if (hasDataField && Array.isArray(data.data)) {
      detectedType = 'list';
    } else if (data?.insertedId !== undefined) {
      detectedType = 'post';
    } else if (data?.affectedRows !== undefined && hasDataField) {
      detectedType = 'put';
    } else if (data?.affectedRows !== undefined && !hasDataField) {
      detectedType = 'delete';
    } else if (hasDataField && typeof data.data === 'object' && !Array.isArray(data.data)) {
      detectedType = 'single';
    } else {
      // Fallback to raw data
      return data;
    }
  }

  // Convert based on type
  switch (detectedType) {
    case 'list':
      // GET list: { ok, data: [...], count } -> { items: [...], count }
      return {
        items: data.data || [],
        count: data.count !== undefined ? data.count : (data.data?.length || 0),
      };

    case 'single':
      // GET single: { ok, data: {...} } -> {...}
      return data.data || {};

    case 'post':
      // POST: { ok, insertedId, data } -> { id: insertedId, ...data }
      // or just { ...data } if data already has id
      if (data.data && typeof data.data === 'object') {
        return {
          id: data.insertedId || data.data.id,
          ...data.data,
        };
      }
      return { id: data.insertedId };

    case 'put':
      // PUT: { ok, affectedRows, data } -> {...data}
      return data.data || {};

    case 'delete':
      // DELETE: { ok, affectedRows } -> { affectedRows }
      return {
        affectedRows: data.affectedRows || 0,
      };

    default:
      // Unknown type, return data as-is
      return data.data !== undefined ? data.data : data;
  }
}

/**
 * Create an axios instance wrapper that automatically adapts datahub responses to DBManager format
 *
 * @param {Object} axiosInstance - Axios instance
 * @param {Object} options - Adapter options
 * @returns {Object} Wrapped axios instance with automatic adaptation
 *
 * @example
 * const axios = require('axios');
 * const { createDatahubAdapter } = require('./datahubAdapter');
 *
 * const http = createDatahubAdapter(axios.create({
 *   baseURL: 'http://datahub:3000',
 *   timeout: 15000,
 * }));
 *
 * // Use like DBManager
 * const rulesResp = await http.get("/api/table/alerting-rules");
 * const rules = rulesResp.data.items; // DBManager format!
 */
function createDatahubAdapter(axiosInstance, options = {}) {
  const { autoAdapt = true } = options;

  if (!autoAdapt) {
    return axiosInstance;
  }

  // Create wrapper that intercepts responses
  const wrapper = {
    ...axiosInstance,

    async get(url, config) {
      const response = await axiosInstance.get(url, config);
      response.data = adaptDatahubResponse(response.data, { type: 'auto' });
      return response;
    },

    async post(url, data, config) {
      const response = await axiosInstance.post(url, data, config);
      response.data = adaptDatahubResponse(response.data, { type: 'post' });
      return response;
    },

    async put(url, data, config) {
      const response = await axiosInstance.put(url, data, config);
      response.data = adaptDatahubResponse(response.data, { type: 'put' });
      return response;
    },

    async delete(url, config) {
      const response = await axiosInstance.delete(url, config);
      response.data = adaptDatahubResponse(response.data, { type: 'delete' });
      return response;
    },

    async patch(url, data, config) {
      const response = await axiosInstance.patch(url, data, config);
      response.data = adaptDatahubResponse(response.data, { type: 'put' });
      return response;
    },
  };

  return wrapper;
}

/**
 * Convert datahub endpoint path to DBManager format
 *
 * @param {string} path - DBManager path (e.g., "/alerting-rules")
 * @returns {string} Datahub path (e.g., "/api/table/alerting_rules")
 *
 * @example
 * const path = convertPathToDatahub("/alerting-rules");
 * // Returns: "/api/table/alerting_rules"
 */
function convertPathToDatahub(path) {
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;

  // Special cases (standard endpoints)
  if (cleanPath === 'settings') {
    return '/settings'; // Uses DBManager-compatible endpoint
  }

  if (cleanPath.startsWith('status/')) {
    return `/${cleanPath}`; // Standard status endpoints
  }

  // Convert hyphens to underscores for MySQL table names
  // DBManager uses hyphens in URLs but MySQL uses underscores in table names
  const tableName = cleanPath.replace(/-/g, '_');

  // Default: table endpoints
  return `/api/table/${tableName}`;
}

module.exports = {
  adaptDatahubResponse,
  createDatahubAdapter,
  convertPathToDatahub,
};
