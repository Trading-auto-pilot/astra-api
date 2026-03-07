"use strict";

const { requestRawDetailed, parseCsv } = require("./httpClient");
const { createProviderError } = require("./providerErrors");
const { markSuccess, markFailure } = require("./providerHealthRegistry");

const PROVIDER_NAME = "vix";
const STOOQ_SYMBOL = "^vix";
const STOOQ_URL = "https://stooq.com/q/d/l/?s=%5Evix&i=d";
const FRED_URL = "https://api.stlouisfed.org/fred/series/observations";
const FRED_SERIES = "VIXCLS";

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function createMockSeries(days = 120) {
  const now = Date.now();
  const out = [];
  for (let i = days; i >= 0; i -= 1) {
    const ts = now - i * 24 * 60 * 60 * 1000;
    const base = 18 + Math.sin(i / 8) * 4;
    out.push({
      timestamp: new Date(ts).toISOString(),
      value: Number(base.toFixed(2)),
      source: "mock:vix",
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

async function fetchFromStooq({ timeoutMs, logger }) {
  const startedAt = new Date().toISOString();
  logDebug(
    logger,
    `provider=${PROVIDER_NAME} requestUrl=${STOOQ_URL} symbol=${STOOQ_SYMBOL} timeoutMs=${timeoutMs} startTimestamp=${startedAt}`
  );
  const response = await requestRawDetailed(STOOQ_URL, timeoutMs);
  logDebug(
    logger,
    `provider=${PROVIDER_NAME} statusCode=${response.statusCode} latencyMs=${response.latencyMs} payloadBytes=${response.payloadBytes} source=stooq`
  );
  const rows = parseCsv(response.body);
  logDebug(logger, `provider=${PROVIDER_NAME} parse rows=${rows.length} source=stooq`);

  const series = rows
    .map((row) => ({
      timestamp: toIsoDate(row.Date),
      value: toNumber(row.Close),
      source: `stooq:${STOOQ_SYMBOL}`,
    }))
    .filter((item) => item.timestamp && item.value != null)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (!series.length) {
    throw createProviderError("NO_DATA", "No VIX data from stooq", {
      source: "stooq",
      symbol: STOOQ_SYMBOL,
    });
  }
  const latest = series[series.length - 1];
  logDebug(
    logger,
    `provider=${PROVIDER_NAME} extracted value=${latest.value} timestamp=${latest.timestamp} source=${latest.source}`
  );
  return series;
}

async function fetchFromFred({ timeoutMs, logger }) {
  const params = new URLSearchParams({
    series_id: FRED_SERIES,
    file_type: "json",
  });
  const fredApiKey = process.env.FRED_API_KEY || "";
  if (fredApiKey) params.set("api_key", fredApiKey);
  const url = `${FRED_URL}?${params.toString()}`;

  const startedAt = new Date().toISOString();
  logDebug(
    logger,
    `provider=${PROVIDER_NAME} requestUrl=${url} series=${FRED_SERIES} timeoutMs=${timeoutMs} startTimestamp=${startedAt}`
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
    throw createProviderError("PARSE_ERROR", "Invalid JSON from FRED VIX", {
      source: "fred",
      cause: err?.message || String(err),
    });
  }

  const observations = Array.isArray(parsed?.observations) ? parsed.observations : [];
  logDebug(logger, `provider=${PROVIDER_NAME} parse observations=${observations.length} source=fred`);

  const series = observations
    .map((obs) => {
      const value = Number(obs?.value);
      const d = new Date(obs?.date);
      return {
        timestamp: Number.isFinite(d.getTime()) ? d.toISOString() : null,
        value: Number.isFinite(value) ? value : null,
        source: `fred:${FRED_SERIES}`,
      };
    })
    .filter((item) => item.timestamp && item.value != null)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (!series.length) {
    throw createProviderError("NO_DATA", "No VIX data from FRED", {
      source: "fred",
      series: FRED_SERIES,
    });
  }
  const latest = series[series.length - 1];
  logDebug(
    logger,
    `provider=${PROVIDER_NAME} extracted value=${latest.value} timestamp=${latest.timestamp} source=${latest.source}`
  );
  return series;
}

function attemptOrder() {
  const mode = String(process.env.LIQ_VIX_PROVIDER || "auto").toLowerCase();
  if (mode === "stooq") return ["stooq"];
  if (mode === "fred") return ["fred"];
  return ["stooq", "fred"];
}

async function loadSeries({ mode = process.env.LIQUIDITY_PROVIDER_MODE || "live", timeoutMs, logger } = {}) {
  if (mode === "mock") {
    const series = createMockSeries();
    markSuccess(PROVIDER_NAME, { timestamp: series[series.length - 1]?.timestamp });
    return series;
  }

  const effectiveTimeout = Number(timeoutMs || process.env.LIQ_PROVIDER_TIMEOUT_MS) || 5000;
  const attempts = [];

  for (const source of attemptOrder()) {
    try {
      const series =
        source === "fred"
          ? await fetchFromFred({ timeoutMs: effectiveTimeout, logger })
          : await fetchFromStooq({ timeoutMs: effectiveTimeout, logger });
      markSuccess(PROVIDER_NAME, { timestamp: series[series.length - 1]?.timestamp });
      return series;
    } catch (err) {
      attempts.push({ source, code: err?.code || "UNKNOWN", message: err?.message || String(err) });
      logWarn(
        logger,
        `provider=${PROVIDER_NAME} source=${source} code=${err?.code || "UNKNOWN"} message=${err?.message || String(err)}`
      );
      logDebug(logger, err?.stack || String(err));
    }
  }

  const chainError = createProviderError("PROVIDER_CHAIN_FAILED", "VIX provider chain failed", { attempts });
  markFailure(PROVIDER_NAME, chainError);
  throw chainError;
}

async function getLatest(opts = {}) {
  const series = await loadSeries(opts);
  const latest = series[series.length - 1];
  if (!latest) {
    const err = createProviderError("NO_DATA", "No VIX data available");
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
