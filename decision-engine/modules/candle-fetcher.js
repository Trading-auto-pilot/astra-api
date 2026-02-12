"use strict";

// ---------------------------------------------------------------------------
// candle-fetcher – fetch + normalize + buildZones (elimina duplicazione 5x)
// ---------------------------------------------------------------------------

const axios = require("axios");
const { normalizeAndSortCandles } = require("./helpers");
const { buildZones } = require("./zones");

/**
 * Scarica candele da cachemanager, normalizza e (opzionalmente) calcola zone.
 *
 * @param {string} cachemanagerUrl   - URL base di cachemanager
 * @param {object} params            - query params per /candles (symbol, startDate, endDate, tf, exchange)
 * @param {number} timeoutMs         - timeout in ms
 * @param {object} [zoneOptions]     - se passato, chiama buildZones e include il risultato
 * @returns {Promise<{ candles, lastClose, ...zoneResult }|null>}
 */
async function fetchAndAnalyze(cachemanagerUrl, params, timeoutMs, zoneOptions) {
  const resp = await axios.get(`${cachemanagerUrl}/candles`, {
    params,
    timeout: timeoutMs,
  });

  const raw = resp.data;
  if (!Array.isArray(raw) || !raw.length) return null;

  const candles = normalizeAndSortCandles(raw);
  if (!candles.length) return null;

  const lastClose = candles[candles.length - 1]?.close ?? null;

  if (!zoneOptions) {
    return { candles, lastClose, rawCount: raw.length, filteredCount: candles.length };
  }

  const zoneResult = buildZones(candles, zoneOptions);
  return {
    candles,
    lastClose,
    rawCount: raw.length,
    filteredCount: candles.length,
    ...zoneResult,
  };
}

module.exports = { fetchAndAnalyze };
