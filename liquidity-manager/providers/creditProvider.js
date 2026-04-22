"use strict";

const { requestRawDetailed } = require("./httpClient");
const { createProviderError } = require("./providerErrors");
const { markSuccess, markFailure } = require("./providerHealthRegistry");
const { getConfigNumber, getConfigString } = require("../../shared/loadSettings");
const simClock = require("../../shared/simClock");

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";
const PROVIDER_NAME = "credit";

function createMockSeries(days = 90) {
  const now = simClock.now();
  const out = [];
  let spread = 3.8;
  for (let i = days; i >= 0; i -= 1) {
    spread = Math.max(2, spread + Math.sin(i / 11) * 0.03);
    out.push({
      timestamp: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      value: Number(spread.toFixed(3)),
      source: "mock:credit",
    });
  }
  return out;
}

function logDebug(logger, msg) {
  logger?.debug?.(msg);
}

function logWarn(logger, msg) {
  if (logger?.warn) logger.warn(msg);
  else logger?.warning?.(msg);
}

function getCreditProviderMode() {
  return String(getConfigString("LIQ_CREDIT_PROVIDER", "fred")).toLowerCase();
}

async function fetchFromFred({ timeoutMs, logger }) {
  const seriesId = getConfigString("LIQ_CREDIT_SERIES", "BAA10Y");
  const apiKey = getConfigString("FRED_API_KEY", "");
  if (!apiKey) {
    throw createProviderError("CONFIG_MISSING", "FRED_API_KEY not set for credit provider", {
      provider: "fred",
      seriesId,
    });
  }

  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
  });
  const url = `${FRED_BASE}?${params.toString()}`;
  const startedAt = new Date().toISOString();
  logDebug(
    logger,
    `provider=${PROVIDER_NAME} requestUrl=${url} series=${seriesId} timeoutMs=${timeoutMs} startTimestamp=${startedAt}`
  );
  const response = await requestRawDetailed(url, timeoutMs);
  logDebug(
    logger,
    `provider=${PROVIDER_NAME} statusCode=${response.statusCode} latencyMs=${response.latencyMs} payloadBytes=${response.payloadBytes} source=fred`
  );

  let parsed;
  try {
    parsed = JSON.parse(response.body);
  } catch (err) {
    throw createProviderError("PARSE_ERROR", "Invalid JSON from FRED credit series", {
      source: "fred",
      seriesId,
      cause: err?.message || String(err),
    });
  }
  const observations = Array.isArray(parsed?.observations) ? parsed.observations : [];
  logDebug(
    logger,
    `provider=${PROVIDER_NAME} parse observations=${observations.length} source=fred series=${seriesId}`
  );

  const series = observations
    .map((obs) => {
      const value = Number(obs?.value);
      const d = new Date(obs?.date);
      return {
        timestamp: Number.isFinite(d.getTime()) ? d.toISOString() : null,
        value: Number.isFinite(value) ? value : null,
        source: `fred:${seriesId}`,
      };
    })
    .filter((item) => item.timestamp && item.value != null)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (!series.length) {
    throw createProviderError("NO_DATA", "Credit spread data unavailable from FRED", {
      source: "fred",
      seriesId,
    });
  }
  const latest = series[series.length - 1];
  logDebug(
    logger,
    `provider=${PROVIDER_NAME} extracted value=${latest.value} timestamp=${latest.timestamp} source=${latest.source}`
  );
  return series;
}

async function loadSeries({ mode = getConfigString("LIQUIDITY_PROVIDER_MODE", "live"), timeoutMs, logger } = {}) {
  if (mode === "mock") {
    const series = createMockSeries();
    markSuccess(PROVIDER_NAME, { timestamp: series[series.length - 1]?.timestamp });
    return series;
  }

  const providerMode = getCreditProviderMode();
  if (providerMode === "none") {
    const err = createProviderError("CONFIG_DISABLED", "Credit provider disabled (LIQ_CREDIT_PROVIDER=none)");
    markFailure(PROVIDER_NAME, err);
    throw err;
  }

  const effectiveTimeout = Number(timeoutMs || getConfigNumber("LIQ_PROVIDER_TIMEOUT_MS", 5000)) || 5000;
  try {
    const series = await fetchFromFred({ timeoutMs: effectiveTimeout, logger });
    markSuccess(PROVIDER_NAME, { timestamp: series[series.length - 1]?.timestamp });
    return series;
  } catch (err) {
    logWarn(
      logger,
      `provider=${PROVIDER_NAME} source=fred code=${err?.code || "UNKNOWN"} message=${err?.message || String(err)}`
    );
    logDebug(logger, err?.stack || String(err));
    markFailure(PROVIDER_NAME, err);
    throw err;
  }
}

async function getLatest(opts = {}) {
  const series = await loadSeries(opts);
  const latest = series[series.length - 1];
  if (!latest) {
    const err = createProviderError("NO_DATA", "No credit spread data available");
    markFailure(PROVIDER_NAME, err);
    throw err;
  }
  return latest;
}

async function getHistory(startDate, endDate, opts = {}) {
  const startTs = startDate ? new Date(startDate).getTime() : Number.NEGATIVE_INFINITY;
  const endTs = endDate ? new Date(endDate).getTime() : Number.POSITIVE_INFINITY;
  const series = await loadSeries(opts);
  return series.filter((item) => {
    const ts = new Date(item.timestamp).getTime();
    return ts >= startTs && ts <= endTs;
  });
}

module.exports = {
  getLatest,
  getHistory,
};
