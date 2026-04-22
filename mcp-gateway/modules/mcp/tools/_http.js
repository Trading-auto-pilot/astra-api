// modules/mcp/tools/_http.js
// Shared fetch helper for MCP tools — routes all calls through Traefik
// using TRADING_BASE_URL and TRADING_API_KEY environment variables.
"use strict";

const { getConfigString } = require("../../../../shared/loadSettings");

const BASE_URL = (getConfigString("TRADING_BASE_URL", "http://localhost:8080")).replace(/\/+$/, "");
const API_KEY  = getConfigString("TRADING_API_KEY", "");

/**
 * Authenticated request through Traefik.
 * @param {string} path       e.g. "/scheduler/jobs"
 * @param {"GET"|"POST"|"PUT"|"DELETE"} [method="GET"]
 * @param {object|null} [body=null]  JSON body for POST/PUT
 * @param {number} [timeoutMs=8000]
 * @returns {Promise<any>} parsed JSON body
 */
async function traefikFetch(path, method = "GET", body = null, timeoutMs = 8000) {
  const url = `${BASE_URL}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["x-api-key"] = API_KEY;

  const init = {
    method,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (body !== null && (method === "POST" || method === "PUT")) {
    init.body = JSON.stringify(body);
  }

  const resp = await fetch(url, init);

  if (!resp.ok) {
    throw new Error(`${resp.status} ${resp.statusText} — ${url}`);
  }

  return resp.json();
}

module.exports = { traefikFetch, BASE_URL };
