// modules/adapters/datahub.js
"use strict";

const https = require("https");
const http  = require("http");

const DATAHUB_URL      = (process.env.DATAHUB_URL || "http://datahub:3000").replace(/\/+$/, "");
const REQUEST_TIMEOUT  = parseInt(process.env.DATAHUB_ADAPTER_TIMEOUT_MS || "5000", 10);

const { countryToArea } = require("../utils/geoUtils");

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { timeout: REQUEST_TIMEOUT }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { reject(new Error(`datahub: invalid JSON from ${url}`)); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error(`datahub: timeout ${url}`)); });
  });
}

/**
 * Fetch fundamentals (sector, industry, country) for a single symbol.
 * Returns null if the symbol is not found or the request fails.
 * @param {string} symbol
 * @returns {Promise<{sector:string|null, industry:string|null, country:string|null}|null>}
 */
async function fetchFundamentals(symbol) {
  const url = `${DATAHUB_URL}/api/table/fundamentals/${encodeURIComponent(symbol.toUpperCase())}`;
  const { status, data } = await httpGet(url);
  if (status !== 200 || !data) return null;

  const d = (data?.data != null && typeof data.data === "object") ? data.data : data;
  if (!d || typeof d !== "object") return null;

  const pick = (...keys) => {
    for (const k of keys) {
      const v = d[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return null;
  };

  const sector   = pick("sector", "Sector", "SECTOR", "gics_sector", "sectorName");
  const industry = pick("industry", "Industry", "INDUSTRY", "industryName");
  const country  = pick("country", "Country", "COUNTRY", "countryCode", "countryISO");

  if (!sector && !industry && !country) return null;
  return { sector, industry, country, area: country ? countryToArea(country) : null };
}

/**
 * Fetch fundamentals for multiple symbols in parallel.
 * Returns only successfully fetched entries.
 * @param {string[]} symbols
 * @returns {Promise<Record<string, {sector:string|null, industry:string|null, country:string|null}>>}
 */
async function fetchFundamentalsMap(symbols) {
  const result = {};
  await Promise.all(
    [...new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean))].map(async (sym) => {
      try {
        const data = await fetchFundamentals(sym);
        if (data) result[sym] = data;
      } catch { /* fail-soft per symbol */ }
    })
  );
  return result;
}

module.exports = { fetchFundamentals, fetchFundamentalsMap };
