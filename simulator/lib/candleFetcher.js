"use strict";

// ---------------------------------------------------------------------------
// candleFetcher — abstract data retrieval from cachemanager / file / Redis
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { getConfigBoolean } = require("../../shared/loadSettings");

// Normalize various candle field names to { t, o, h, l, c, v }
function normalizeCandle(c) {
  if (!c) return null;
  return {
    t: c.t ?? c.timestamp ?? c.time ?? c.date ?? null,
    o: c.o ?? c.open ?? null,
    h: c.h ?? c.high ?? null,
    l: c.l ?? c.low ?? null,
    c: c.c ?? c.close ?? null,
    v: c.v ?? c.volume ?? null,
  };
}

// Find the candle closest to a target timestamp in an array
function closestCandle(candles, targetMs) {
  if (!candles.length) return null;
  return candles.reduce((best, c) => {
    const ct = new Date(c.t ?? c.timestamp ?? c.date ?? c.time ?? 0).getTime();
    const bt = new Date(best.t ?? best.timestamp ?? best.date ?? best.time ?? 0).getTime();
    return Math.abs(ct - targetMs) < Math.abs(bt - targetMs) ? c : best;
  });
}

function createCandleFetcher({ cachemanagerUrl }) {
  const cmAxios = axios.create({ baseURL: cachemanagerUrl, timeout: 10000 });
  const allowProviderFetch = getConfigBoolean("MARKET_SIMULATOR_ALLOW_PROVIDER_FETCH", false);

  // ---------------------------------------------------------------------------
  // Preload cache — for sync mode: fetch once, serve N ticks from memory.
  // Key: `${SYMBOL}::${tf}`, value: sorted array of normalized candles.
  // ---------------------------------------------------------------------------
  const _cache = new Map();
  const _index = new Map(); // cacheKey → current candle index (for sequential sync-mode iteration)

  function _cacheKey(symbol, tf) {
    return `${String(symbol).toUpperCase()}::${tf}`;
  }

  // Find candle closest to targetMs using binary search on sorted array.
  function _findClosest(candles, targetMs) {
    if (!candles.length) return null;
    let lo = 0, hi = candles.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const t = new Date(candles[mid].t).getTime();
      if (t < targetMs) lo = mid + 1;
      else hi = mid;
    }
    // Check both neighbors and return nearest
    const candidates = [candles[lo]];
    if (lo > 0) candidates.push(candles[lo - 1]);
    return candidates.reduce((best, c) => {
      const ct = new Date(c.t).getTime();
      const bt = new Date(best.t).getTime();
      return Math.abs(ct - targetMs) < Math.abs(bt - targetMs) ? c : best;
    });
  }

  const normalizeTf = (tf) => {
    const raw = String(tf || "1Day").trim().toLowerCase();
    if (raw === "1min" || raw === "1m") return "1min";
    if (raw === "5min" || raw === "5m") return "5min";
    if (raw === "15min" || raw === "15m") return "15min";
    if (raw === "30min" || raw === "30m") return "30min";
    if (raw === "1hour" || raw === "1h" || raw === "60min") return "1Hour";
    if (raw === "4hour" || raw === "4h" || raw === "240min") return "4Hour";
    if (raw === "1day" || raw === "1d") return "1Day";
    if (raw === "1week" || raw === "1w") return "1Week";
    if (raw === "1month" || raw === "1mo") return "1Month";
    return "1Day";
  };

  // Fetch all candles for a symbol/tf in a date range from cachemanager
  async function fetchRange(symbol, startDate, endDate, tf) {
    const resp = await cmAxios.get("/candles", {
      params: { symbol, startDate, endDate, tf },
      timeout: 120000,          // 2 min: range request può assemblare 20+ file mensili
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    const raw = Array.isArray(resp.data) ? resp.data : [];
    return raw.map(normalizeCandle).filter(Boolean);
  }

  // Fetch a single candle closest to 'date' from cachemanager
  async function fromCachemanager(symbol, dateMs, tf) {
    const tfKey = normalizeTf(tf);
    try {
      const latestResp = await cmAxios.get("/candles/latest", {
        params: { symbol, tf: tfKey },
      });
      const latest = latestResp?.data?.candle || null;
      const normalized = normalizeCandle(latest);
      if (!normalized) return null;
      // Align timestamp to requested simulation instant.
      normalized.t = new Date(dateMs).toISOString();
      return normalized;
    } catch (latestErr) {
      // By default do not trigger provider fetches from simulator.
      if (!allowProviderFetch) return null;
      try {
        const tfMs = require("./sessionState").TF_MS[tfKey] || 24 * 60 * 60 * 1000;
        const startDate = new Date(dateMs - tfMs).toISOString();
        const endDate   = new Date(dateMs + tfMs).toISOString();
        const candles = await fetchRange(symbol, startDate, endDate, tfKey);
        return normalizeCandle(closestCandle(candles, dateMs));
      } catch (rangeErr) {
        return null;
      }
    }
  }

  // Read candles from a local JSON file: {path}/{SYMBOL}/{tf}.json
  function fromFile(symbol, dateMs, tf, config) {
    const dir = config.path;
    if (!dir) throw new Error("dataSourceConfig.path required for file source");
    const filePath = path.join(dir, symbol, `${tf}.json`);
    const raw = fs.readFileSync(filePath, "utf-8");
    const candles = JSON.parse(raw);
    if (!Array.isArray(candles)) throw new Error(`${filePath} must be a JSON array`);
    return normalizeCandle(closestCandle(candles, dateMs));
  }

  // Read candles from Redis key: sim:candles:{SYMBOL}:{tf}
  async function fromRedis(symbol, dateMs, tf, bus) {
    const key = `sim:candles:${symbol}:${tf}`;
    const data = await bus.get(key);
    if (!data) return null;
    const candles = Array.isArray(data) ? data : [];
    return normalizeCandle(closestCandle(candles, dateMs));
  }

  return {
    async getCandle(symbol, date, tf, dataSource, dataSourceConfig, bus) {
      const dateMs = new Date(date).getTime();
      switch (dataSource) {
        case "file":  return fromFile(symbol, dateMs, tf, dataSourceConfig || {});
        case "redis": return fromRedis(symbol, dateMs, tf, bus);
        default:      return fromCachemanager(symbol, dateMs, tf);
      }
    },

    // Fetch full range from cachemanager (preload or range display)
    async getRange(symbol, startDate, endDate, tf) {
      return fetchRange(symbol, startDate, endDate, tf);
    },

    // -----------------------------------------------------------------------
    // Sync-mode helpers: preload entire series once, then serve from memory.
    // -----------------------------------------------------------------------

    /**
     * Directly populate the preload cache from a candle array (library mode).
     * Replaces any existing cached series for the symbol/tf.
     *
     * @param {string}   symbol
     * @param {string}   tf
     * @param {object[]} candles  raw or already-normalized candle objects
     * @returns {number}          number of candles loaded
     */
    preloadFromCandles(symbol, tf, candles) {
      const tfKey = normalizeTf(tf);
      const key   = _cacheKey(symbol, tfKey);
      const normalized = candles.map(normalizeCandle).filter(Boolean);
      normalized.sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
      _cache.set(key, normalized);
      _index.set(key, 0);
      return normalized.length;
    },

    /**
     * Fetch and cache a full candle series for a symbol/tf.
     * Idempotent: if already loaded, returns cached length without re-fetching.
     *
     * @param {string} symbol
     * @param {string} startDate  ISO date string
     * @param {string} endDate    ISO date string
     * @param {string} tf         normalized timeframe
     * @returns {number}          number of candles loaded
     */
    async preload(symbol, startDate, endDate, tf) {
      const tfKey = normalizeTf(tf);
      const key   = _cacheKey(symbol, tfKey);
      if (_cache.has(key)) return _cache.get(key).length;

      const candles = await fetchRange(symbol, startDate, endDate, tfKey);
      // Ensure sorted by timestamp ascending
      candles.sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
      _cache.set(key, candles);
      return candles.length;
    },

    /**
     * Serve a candle from the preloaded cache (closest to date).
     * Returns null if symbol not preloaded or no candle found.
     *
     * @param {string} symbol
     * @param {string|number} date  ISO string or epoch ms
     * @param {string} tf
     * @returns {object|null}       normalized candle { t, o, h, l, c, v }
     */
    getCached(symbol, date, tf) {
      const tfKey = normalizeTf(tf);
      const key   = _cacheKey(symbol, tfKey);
      const candles = _cache.get(key);
      if (!candles || !candles.length) return null;
      const dateMs = typeof date === "number" ? date : new Date(date).getTime();
      return _findClosest(candles, dateMs);
    },

    /** Clear the preload cache (call on session stop). */
    clearCache() {
      _cache.clear();
      _index.clear();
    },

    /** List symbols currently in cache. */
    getCacheKeys() {
      return Array.from(_cache.keys());
    },

    /**
     * Set the index for a symbol/tf to the first candle with timestamp >= fromDate.
     * Call this after preload() to ensure tick() starts from the correct candle.
     *
     * @param {string} symbol
     * @param {string} tf
     * @param {string|number} fromDate  ISO string or epoch ms
     */
    resetIndexToDate(symbol, tf, fromDate) {
      const tfKey  = normalizeTf(tf);
      const key    = _cacheKey(symbol, tfKey);
      const candles = _cache.get(key);
      if (!candles || !candles.length) {
        _index.set(key, 0);
        return;
      }
      const targetMs = typeof fromDate === "number" ? fromDate : new Date(fromDate).getTime();
      // Binary search for first candle with t >= targetMs
      let lo = 0, hi = candles.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (new Date(candles[mid].t).getTime() < targetMs) lo = mid + 1;
        else hi = mid;
      }
      _index.set(key, lo < candles.length ? lo : 0);
    },

    /**
     * Return the next sequential candle and advance the index.
     * Returns null if the symbol is not preloaded or all candles have been consumed.
     *
     * @param {string} symbol
     * @param {string} tf
     * @returns {object|null}  normalized candle { t, o, h, l, c, v }
     */
    getCachedNext(symbol, tf) {
      const tfKey  = normalizeTf(tf);
      const key    = _cacheKey(symbol, tfKey);
      const candles = _cache.get(key);
      if (!candles || !candles.length) return null;
      const idx = _index.get(key) ?? 0;
      if (idx >= candles.length) return null;
      _index.set(key, idx + 1);
      return candles[idx];
    },

    /**
     * Return the next sequential candle WITHOUT advancing the index (for preview).
     *
     * @param {string} symbol
     * @param {string} tf
     * @returns {object|null}
     */
    peekCachedNext(symbol, tf) {
      const tfKey  = normalizeTf(tf);
      const key    = _cacheKey(symbol, tfKey);
      const candles = _cache.get(key);
      if (!candles || !candles.length) return null;
      const idx = _index.get(key) ?? 0;
      if (idx >= candles.length) return null;
      return candles[idx];
    },
  };
}

module.exports = { createCandleFetcher, normalizeCandle };
