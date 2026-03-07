"use strict";

const { requestRawDetailed, parseCsv } = require("./httpClient");
const { createProviderError } = require("./providerErrors");
const { markSuccess, markFailure } = require("./providerHealthRegistry");

const PROVIDER_NAME = "spyTrend";
const SOURCE = "stooq:spy.us";
const STOOQ_SPY_CSV_URL = "https://stooq.com/q/d/l/?s=spy.us&i=d";

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

function createMockSeries(days = 260) {
  const now = Date.now();
  const out = [];
  let price = 420;
  for (let i = days; i >= 0; i -= 1) {
    const drift = 0.03;
    const seasonal = Math.sin(i / 10) * 0.8;
    price = Math.max(120, price + drift + seasonal);
    out.push({
      timestamp: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      value: Number(price.toFixed(2)),
      source: "mock:spy",
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

async function loadSeries({ mode = process.env.LIQUIDITY_PROVIDER_MODE || "live", timeoutMs, logger } = {}) {
  if (mode === "mock") {
    const series = createMockSeries();
    markSuccess(PROVIDER_NAME, { timestamp: series[series.length - 1]?.timestamp });
    return series;
  }

  const effectiveTimeout = Number(timeoutMs || process.env.LIQ_PROVIDER_TIMEOUT_MS) || 5000;
  const startedAt = new Date().toISOString();
  logDebug(
    logger,
    `provider=${PROVIDER_NAME} requestUrl=${STOOQ_SPY_CSV_URL} symbol=spy.us timeoutMs=${effectiveTimeout} startTimestamp=${startedAt}`
  );
  try {
    const response = await requestRawDetailed(STOOQ_SPY_CSV_URL, effectiveTimeout);
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
      source: SOURCE,
    }))
    .filter((item) => item.timestamp && item.value != null)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    if (!series.length) {
      throw createProviderError("NO_DATA", "No SPY data available from stooq");
    }
    const latest = series[series.length - 1];
    logDebug(
      logger,
      `provider=${PROVIDER_NAME} extracted value=${latest.value} timestamp=${latest.timestamp} source=${latest.source}`
    );
    markSuccess(PROVIDER_NAME, { timestamp: latest.timestamp });
    return series;
  } catch (err) {
    logWarn(
      logger,
      `provider=${PROVIDER_NAME} code=${err?.code || "UNKNOWN"} message=${err?.message || String(err)}`
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
    const err = createProviderError("NO_DATA", "No SPY data available");
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
