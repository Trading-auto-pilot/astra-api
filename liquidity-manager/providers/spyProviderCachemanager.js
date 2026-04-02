"use strict";

const { requestRawDetailed } = require("./httpClient");
const { createProviderError } = require("./providerErrors");
const { getConfigString, getConfigNumber } = require("../../shared/loadSettings");

const PROVIDER_NAME = "spyTrend";
const SOURCE = "cachemanager:SPY";

// How many calendar days to request (need 210+ trading days ≈ ~300 calendar days)
const LOOKBACK_DAYS = getConfigNumber("SPY_CACHEMANAGER_LOOKBACK_DAYS", 400);

function toIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function formatDate(ts) {
  return new Date(ts).toISOString().split("T")[0];
}

/**
 * Fetch SPY daily candles from the cachemanager microservice.
 * Returns series in the shape expected by spyTrendNormalizer: [{ timestamp, value }]
 */
async function fetchFromCachemanager({ timeoutMs, logger } = {}) {
  const baseUrl = (
    getConfigString("CACHEMANAGER_URL", "http://cachemanager:3006")
  ).replace(/\/+$/, "");

  const endDate = formatDate(Date.now());
  const startDate = formatDate(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const url = `${baseUrl}/candles?symbol=SPY&startDate=${startDate}&endDate=${endDate}&tf=1Day`;

  const effectiveTimeout = Number(timeoutMs || getConfigNumber("LIQ_PROVIDER_TIMEOUT_MS", 5000)) || 5000;

  logger?.debug?.(
    `provider=${PROVIDER_NAME} source=cachemanager url=${url} startDate=${startDate} endDate=${endDate}`
  );

  const response = await requestRawDetailed(url, effectiveTimeout);

  let parsed;
  try {
    parsed = JSON.parse(response.body);
  } catch (err) {
    throw createProviderError("PARSE_ERROR", "Invalid JSON from cachemanager SPY", {
      source: "cachemanager",
      cause: err?.message || String(err),
    });
  }

  // cachemanager returns either an array directly or { data: [...] }
  const raw = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.data) ? parsed.data : null);
  if (!raw || raw.length === 0) {
    throw createProviderError("NO_DATA", "No SPY candles from cachemanager", {
      source: "cachemanager",
      startDate,
      endDate,
    });
  }

  // Normalise to { timestamp, value } expected by spyTrendNormalizer
  const series = raw
    .map((c) => {
      const ts = toIsoDate(c?.t ?? c?.timestamp ?? c?.time ?? c?.date);
      const value = Number(c?.c ?? c?.close ?? c?.Close);
      if (!ts || !Number.isFinite(value)) return null;
      return { timestamp: ts, value, source: SOURCE };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (series.length === 0) {
    throw createProviderError("NO_DATA", "No valid SPY candles from cachemanager", {
      source: "cachemanager",
      rawCount: raw.length,
    });
  }

  logger?.debug?.(
    `provider=${PROVIDER_NAME} source=cachemanager bars=${series.length} latest=${series[series.length - 1]?.timestamp}`
  );

  return series;
}

async function getLatest(opts = {}) {
  const series = await fetchFromCachemanager(opts);
  return series[series.length - 1];
}

async function getHistory(startDate, endDate, opts = {}) {
  const series = await fetchFromCachemanager(opts);
  const startTs = startDate ? new Date(startDate).getTime() : Number.NEGATIVE_INFINITY;
  const endTs = endDate ? new Date(endDate).getTime() : Number.POSITIVE_INFINITY;
  return series.filter((item) => {
    const ts = new Date(item.timestamp).getTime();
    return ts >= startTs && ts <= endTs;
  });
}

module.exports = { getLatest, getHistory };
