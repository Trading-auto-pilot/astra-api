// modules/adapters/liquidityManager.js
"use strict";

const https = require("https");
const http = require("http");

const LIQUIDITY_MANAGER_URL = process.env.LIQUIDITY_MANAGER_URL || "http://liquidity-manager:3001";
const LIQUIDITY_SCORE_PATH = process.env.LIQUIDITY_SCORE_PATH || "/liquidity-score";

const REQUEST_TIMEOUT_MS = parseInt(process.env.LIQUIDITY_ADAPTER_TIMEOUT_MS || "5000", 10);

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
          reject(new Error(`liquidityManager: invalid JSON from ${url}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`liquidityManager: timeout calling ${url}`));
    });
  });
}

/**
 * Fetch liquidity/risk score from liquidity-manager.
 * Expected response: { score, riskRegime, volatility, confidence }
 * where riskRegime: "ON"|"OFF"|"NEUTRAL"
 * @param {string} [market="US"]
 * @returns {Promise<{score:number, riskRegime:string, volatility:number, confidence:number}>}
 */
async function fetchLiquidityScore(market = "US") {
  const url = `${LIQUIDITY_MANAGER_URL}${LIQUIDITY_SCORE_PATH}?market=${encodeURIComponent(market)}`;
  const data = await httpGet(url);
  const payload = data?.data ?? data;

  // confidence: liquidity-manager returns 0-1 scale, formula uses 0-100 scale
  const rawConfidence = Number(payload?.confidence ?? 0);
  const confidence = rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence;

  return {
    score: Number(payload?.score ?? payload?.liquidityScore ?? 50),
    riskRegime: String(payload?.riskRegime ?? payload?.regime ?? "NEUTRAL"),
    volatility: Number(payload?.volatility ?? payload?.vol ?? 0),
    confidence,
  };
}

module.exports = { fetchLiquidityScore };
