"use strict";

// ---------------------------------------------------------------------------
// candleFetcher — abstract data retrieval from cachemanager / file / Redis
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const axios = require("axios");

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
  const allowProviderFetch = String(process.env.MARKET_SIMULATOR_ALLOW_PROVIDER_FETCH || "false").toLowerCase() === "true";

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

    // Fetch full range (useful for preloading or frontend range display)
    async getRange(symbol, startDate, endDate, tf) {
      return fetchRange(symbol, startDate, endDate, tf);
    },
  };
}

module.exports = { createCandleFetcher, normalizeCandle };
