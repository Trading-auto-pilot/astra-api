// modules/store/fundamentalsStore.js
"use strict";

// Redis key: cm:sym:{SYMBOL}
const KEY_SYM = (s) => `cm:sym:${String(s).toUpperCase()}`;
const TTL_SEC = 7 * 24 * 3600; // 7 days

/**
 * Get cached fundamentals for a single symbol.
 * @param {string} symbol
 * @param {object} bus - RedisBus instance
 * @returns {Promise<{sector:string, industry:string, area:string, country:string}|null>}
 */
async function getFundamentals(symbol, bus) {
  const raw = await bus.get(KEY_SYM(symbol));
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
}

/**
 * Cache fundamentals for a single symbol.
 * @param {string} symbol
 * @param {{sector?:string, industry?:string, area?:string, country?:string}} data
 * @param {object} bus
 */
async function setFundamentals(symbol, data, bus) {
  await bus.set(KEY_SYM(symbol), JSON.stringify(data), { EX: TTL_SEC });
}

/**
 * Bulk-cache fundamentals.
 * @param {Record<string, {sector?:string, industry?:string, area?:string, country?:string}>} map
 * @param {object} bus
 */
async function setFundamentalsMap(map, bus) {
  const entries = Object.entries(map || {}).filter(([sym, data]) => sym && data);
  await Promise.all(entries.map(([sym, data]) => setFundamentals(sym, data, bus)));
}

/**
 * Bulk-get fundamentals for a list of symbols.
 * @param {string[]} symbols
 * @param {object} bus
 * @returns {Promise<Record<string, {sector:string, industry:string, area:string, country:string}>>}
 */
async function getFundamentalsMap(symbols, bus) {
  const result = {};
  await Promise.all(
    [...new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean))].map(async (sym) => {
      const data = await getFundamentals(sym, bus);
      if (data) result[sym] = data;
    })
  );
  return result;
}

module.exports = { getFundamentals, setFundamentals, setFundamentalsMap, getFundamentalsMap };
