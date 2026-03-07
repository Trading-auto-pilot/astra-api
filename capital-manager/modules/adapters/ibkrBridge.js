// modules/adapters/ibkrBridge.js
"use strict";

const https = require("https");
const http = require("http");

const IBKR_BRIDGE_URL = process.env.IBKR_BRIDGE_URL || "http://ibkr-bridge:3017";
const REQUEST_TIMEOUT_MS = parseInt(process.env.IBKR_ADAPTER_TIMEOUT_MS || "5000", 10);

/**
 * Simple HTTP GET helper.
 * @param {string} url
 * @returns {Promise<object>}
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`ibkrBridge: invalid JSON from ${url}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`ibkrBridge: timeout calling ${url}`));
    });
  });
}

/**
 * Extract numeric amount from an IBKR summary field.
 * IBKR returns fields as { amount: N, currency: "USD", isNull: false } or plain numbers.
 */
function extractAmount(field) {
  if (field == null) return 0;
  if (typeof field === "number") return field;
  return Number(field?.amount ?? 0);
}

/**
 * Fetch the first accountId from ibkr-bridge via GET /mirror/portfolio/accounts.
 * @returns {Promise<string>}
 */
async function fetchAccountId() {
  const data = await httpGet(`${IBKR_BRIDGE_URL}/mirror/portfolio/accounts`);
  const accounts = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
  if (!accounts.length) throw new Error("ibkrBridge: no accounts returned");
  const accountId = String(
    accounts[0]?.accountId ?? accounts[0]?.id ?? accounts[0]?.acctId ?? ""
  );
  if (!accountId) throw new Error("ibkrBridge: accountId missing from accounts response");
  return accountId;
}

/**
 * Fetch account summary via GET /mirror/portfolio/accounts → GET /account?accountId=.
 * Returns: { accountId, cashAvailable, netLiq, buyingPower, currency }
 */
async function fetchAccountSummary() {
  const accountId = await fetchAccountId();
  const data = await httpGet(`${IBKR_BRIDGE_URL}/account?accountId=${encodeURIComponent(accountId)}`);
  const summary = data?.summary ?? data?.data?.summary ?? {};

  return {
    accountId,
    cashAvailable: extractAmount(summary?.settledcash ?? summary?.totalcashvalue ?? summary?.cashbalance),
    netLiq: extractAmount(summary?.netliquidation ?? summary?.NetLiquidation),
    buyingPower: extractAmount(summary?.buyingpower ?? summary?.BuyingPower),
    currency: summary?.netliquidation?.currency ?? summary?.currency?.currency ?? "USD",
  };
}

/**
 * Fetch open positions via GET /mirror/portfolio/{accountId}/positions/0.
 * @returns {Promise<Array>}
 */
async function fetchPositions() {
  const accountId = await fetchAccountId();
  const url = `${IBKR_BRIDGE_URL}/mirror/portfolio/${encodeURIComponent(accountId)}/positions/0`;
  const data = await httpGet(url);
  return Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
}

/**
 * Fetch open orders via GET /mirror/iserver/account/orders.
 * @returns {Promise<Array>}
 */
async function fetchOpenOrders() {
  const url = `${IBKR_BRIDGE_URL}/mirror/iserver/account/orders`;
  const data = await httpGet(url);
  return Array.isArray(data)
    ? data
    : (Array.isArray(data?.orders) ? data.orders : (Array.isArray(data?.data) ? data.data : []));
}

module.exports = { fetchAccountId, fetchAccountSummary, fetchPositions, fetchOpenOrders };
