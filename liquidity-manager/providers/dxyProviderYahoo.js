"use strict";

const { yahooGet } = require("../modules/http/yahooHttpClient");
const { yahooLimiter } = require("../modules/http/yahooLimiter");
const { sleep } = require("../modules/http/rateLimiter");
const { yahooCircuit } = require("../modules/resilience/yahooCircuit");
const { createYahooCacheRepository } = require("../repositories/yahooCacheRepository");
const { createProviderError } = require("./providerErrors");

const SOURCE = "yahoo:query1.finance.yahoo.com";
const DEFAULT_SYMBOL = "DX-Y.NYB";
const DEFAULT_RANGE = "2y";
const DEFAULT_INTERVAL = "1d";

function logWithJson(logger, level, message, payload) {
  const line = `${message} | ${JSON.stringify(payload || {})}`;
  const fn =
    logger && typeof logger[level] === "function"
      ? logger[level]
      : level === "warn" && logger && typeof logger.warning === "function"
        ? logger.warning
        : logger && typeof logger.info === "function"
          ? logger.info
          : console.log;
  fn.call(logger || console, line);
}

function pickSeries(rawParsed, symbol, range, interval) {
  const result = rawParsed?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = Array.isArray(result?.indicators?.quote?.[0]?.close)
    ? result.indicators.quote[0].close
    : [];
  const length = Math.min(timestamps.length, closes.length);
  const series = [];
  for (let i = 0; i < length; i += 1) {
    const ts = Number(timestamps[i]);
    const close = Number(closes[i]);
    if (!Number.isFinite(ts) || !Number.isFinite(close)) continue;
    series.push({
      timestamp: new Date(ts * 1000).toISOString(),
      value: close,
      source: `${SOURCE}:${symbol}`,
      meta: { range, interval },
    });
  }
  series.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return series;
}

function parseRetryAfterMs(err, maxMs) {
  const retryAfterSec = Number(err?.details?.retryAfterSec);
  if (!Number.isFinite(retryAfterSec) || retryAfterSec < 0) return null;
  return Math.min(maxMs, Math.max(0, retryAfterSec * 1000));
}

function isRetryable(err) {
  const code = String(err?.code || "").toUpperCase();
  const statusCode = Number(err?.statusCode || err?.details?.statusCode);
  if (code === "TIMEOUT" || code === "NETWORK_ERROR") return true;
  if (statusCode === 429) return true;
  if (statusCode >= 500 && statusCode <= 599) return true;
  return false;
}

function cacheKey({ symbol, range, interval }) {
  return `yahoo:chart:${symbol}:${range}:${interval}`;
}

function filterByRange(series, startDate, endDate) {
  const startTs = startDate ? new Date(startDate).getTime() : Number.NEGATIVE_INFINITY;
  const endTs = endDate ? new Date(endDate).getTime() : Number.POSITIVE_INFINITY;
  return series.filter((it) => {
    const ts = new Date(it.timestamp).getTime();
    return ts >= startTs && ts <= endTs;
  });
}

function createYahooDxyProvider({
  yahooGetFn = yahooGet,
  limiter = yahooLimiter,
  cacheRepository = createYahooCacheRepository(),
  circuit = yahooCircuit,
  sleepFn = sleep,
  nowFn = () => Date.now(),
} = {}) {
  async function fetchHistory(startDate, endDate, opts = {}) {
    const logger = opts.logger || console;
    const requestId = opts.requestId || opts.correlationId || null;
    const symbol = opts.symbol || DEFAULT_SYMBOL;
    const range = opts.range || DEFAULT_RANGE;
    const interval = opts.interval || DEFAULT_INTERVAL;
    const timeoutMs = Number(opts.timeoutMs || process.env.YAHOO_TIMEOUT_MS) || 8000;
    const retryMaxAttempts = Number(process.env.YAHOO_RETRY_MAX_ATTEMPTS) || 5;
    const retryBaseMs = Number(process.env.YAHOO_RETRY_BASE_MS) || 1000;
    const retryMaxMs = Number(process.env.YAHOO_RETRY_MAX_MS) || 15000;
    const cacheTtlMin = Number(process.env.YAHOO_CACHE_TTL_MIN) || 360;
    const ttlMs = Math.max(1000, cacheTtlMin * 60 * 1000);
    const key = cacheKey({ symbol, range, interval });
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;

    const circuitStateAtStart = typeof circuit.state === "function" ? circuit.state() : {};
    const circuitOpen = typeof circuit.isOpen === "function" ? circuit.isOpen() : false;
    if (circuitOpen) {
      const err = createProviderError("CIRCUIT_OPEN", "Yahoo circuit is open for DXY provider", {
        symbol,
        range,
        interval,
        circuit: circuitStateAtStart,
      });
      logWithJson(logger, "warn", "Yahoo DXY request blocked by open circuit", {
        provider: "dxy",
        source: "yahoo",
        url,
        method: "GET",
        symbol,
        range,
        interval,
        requestId,
        circuit: circuitStateAtStart,
        error: { code: err.code, message: err.message },
      });
      throw err;
    }

    const cached = await cacheRepository.get(key, nowFn());
    if (cached?.payload?.series && Array.isArray(cached.payload.series)) {
      logWithJson(logger, "info", "Yahoo DXY cache hit", {
        provider: "dxy",
        source: "yahoo",
        url,
        method: "GET",
        symbol,
        range,
        interval,
        requestId,
        cache: { hit: true, ttlMsRemaining: cached.ttlMsRemaining || 0 },
        circuit: typeof circuit.state === "function" ? circuit.state() : {},
      });
      return filterByRange(cached.payload.series, startDate, endDate);
    }

    logWithJson(logger, "info", "Yahoo DXY cache miss", {
      provider: "dxy",
      source: "yahoo",
      url,
      method: "GET",
      symbol,
      range,
      interval,
      requestId,
      cache: { hit: false, ttlMsRemaining: 0 },
      circuit: typeof circuit.state === "function" ? circuit.state() : {},
    });

    let lastErr = null;
    for (let attempt = 1; attempt <= retryMaxAttempts; attempt += 1) {
      try {
        const scheduled = await limiter.schedule(() => yahooGetFn(url, { timeoutMs, requestId }));
        const response = scheduled?.result || scheduled;
        let parsed;
        try {
          parsed = JSON.parse(response.body);
        } catch (parseErr) {
          throw createProviderError("PARSE_ERROR", "Invalid Yahoo DXY JSON payload", {
            symbol,
            range,
            interval,
            cause: parseErr?.message || String(parseErr),
          });
        }
        const series = pickSeries(parsed, symbol, range, interval);
        if (!series.length) {
          throw createProviderError("NO_DATA", "Yahoo DXY payload has no valid series", {
            symbol,
            range,
            interval,
          });
        }
        if (typeof circuit.onSuccess === "function") circuit.onSuccess();
        await cacheRepository.set(
          key,
          {
            series,
            source: SOURCE,
            fetchedAt: new Date(nowFn()).toISOString(),
            meta: { symbol, range, interval },
          },
          ttlMs,
          nowFn()
        );
        logWithJson(logger, "info", "Yahoo DXY fetch completed", {
          provider: "dxy",
          source: "yahoo",
          url,
          method: "GET",
          symbol,
          range,
          interval,
          attempt,
          maxAttempts: retryMaxAttempts,
          latencyMs: response.latencyMs || null,
          statusCode: response.statusCode || null,
          requestId,
          rateLimit: scheduled?.rateLimit || null,
          cache: { hit: false, ttlMsRemaining: ttlMs },
          circuit: typeof circuit.state === "function" ? circuit.state() : {},
        });
        return filterByRange(series, startDate, endDate);
      } catch (err) {
        lastErr = err;
        const statusCode = Number(err?.statusCode || err?.details?.statusCode);
        if (statusCode === 429) {
          if (typeof circuit.onFailure === "function") circuit.onFailure({ countForOpen: true });
          const headers = err?.details?.headers || {};
          logWithJson(logger, "debug", "Yahoo DXY response headers on 429", {
            provider: "dxy",
            source: "yahoo",
            url,
            method: "GET",
            symbol,
            range,
            interval,
            attempt,
            maxAttempts: retryMaxAttempts,
            statusCode,
            headers: {
              "retry-after": headers["retry-after"] || null,
              "x-request-id": headers["x-request-id"] || null,
            },
            requestId,
          });
        }

        const circuitState = typeof circuit.state === "function" ? circuit.state() : {};
        const opened = typeof circuit.isOpen === "function" ? circuit.isOpen() : false;
        if (opened) {
          const openErr = createProviderError("CIRCUIT_OPEN", "Yahoo circuit opened after repeated 429", {
            symbol,
            range,
            interval,
            circuit: circuitState,
            lastError: {
              code: err?.code || "UNKNOWN",
              message: err?.message || String(err),
            },
          });
          logWithJson(logger, "warn", "Yahoo DXY circuit opened", {
            provider: "dxy",
            source: "yahoo",
            url,
            method: "GET",
            symbol,
            range,
            interval,
            attempt,
            maxAttempts: retryMaxAttempts,
            statusCode: Number(err?.statusCode || err?.details?.statusCode) || null,
            requestId,
            circuit: circuitState,
            error: {
              code: openErr.code,
              message: openErr.message,
            },
          });
          throw openErr;
        }

        const retryable = isRetryable(err);
        const retryAfterMs = parseRetryAfterMs(err, retryMaxMs);
        const backoffMs = Math.min(retryMaxMs, retryBaseMs * 2 ** (attempt - 1));
        const waitMs = retryAfterMs == null ? backoffMs : Math.min(retryMaxMs, Math.max(backoffMs, retryAfterMs));

        if (retryable && attempt < retryMaxAttempts) {
          logWithJson(logger, "warn", "Yahoo DXY request failed, scheduling retry", {
            provider: "dxy",
            source: "yahoo",
            url,
            method: "GET",
            symbol,
            range,
            interval,
            attempt,
            maxAttempts: retryMaxAttempts,
            latencyMs: err?.details?.latencyMs || null,
            statusCode: Number(err?.statusCode || err?.details?.statusCode) || null,
            retryAfterSec: Number(err?.details?.retryAfterSec) || null,
            waitMs,
            requestId,
            rateLimit: err?.rateLimit || null,
            circuit: circuitState,
            error: {
              code: err?.code || "UNKNOWN",
              message: err?.message || String(err),
              name: err?.name || "Error",
            },
          });
          await sleepFn(waitMs);
          continue;
        }

        const finalErr = createProviderError("YAHOO_FETCH_FAILED", "Yahoo DXY fetch failed", {
          symbol,
          range,
          interval,
          attempt,
          maxAttempts: retryMaxAttempts,
          statusCode: Number(err?.statusCode || err?.details?.statusCode) || null,
          retryAfterSec: Number(err?.details?.retryAfterSec) || null,
          circuit: circuitState,
          cause: {
            code: err?.code || "UNKNOWN",
            message: err?.message || String(err),
          },
        });
        logWithJson(logger, "error", "Yahoo DXY request failed after retries", {
          provider: "dxy",
          source: "yahoo",
          url,
          method: "GET",
          symbol,
          range,
          interval,
          attempt,
          maxAttempts: retryMaxAttempts,
          latencyMs: err?.details?.latencyMs || null,
          statusCode: Number(err?.statusCode || err?.details?.statusCode) || null,
          requestId,
          rateLimit: err?.rateLimit || null,
          circuit: circuitState,
          error: {
            code: finalErr.code,
            message: finalErr.message,
            name: finalErr.name || "Error",
          },
        });
        logWithJson(logger, "debug", "Yahoo DXY failure stack trace", {
          provider: "dxy",
          source: "yahoo",
          requestId,
          error: {
            code: err?.code || "UNKNOWN",
            message: err?.message || String(err),
            name: err?.name || "Error",
            stack: err?.stack || null,
          },
        });
        throw finalErr;
      }
    }

    const fallbackErr = createProviderError("YAHOO_FETCH_FAILED", "Yahoo DXY exhausted retries", {
      cause: {
        code: lastErr?.code || "UNKNOWN",
        message: lastErr?.message || String(lastErr || "unknown"),
      },
    });
    throw fallbackErr;
  }

  async function getLatest(opts = {}) {
    const series = await fetchHistory(undefined, undefined, opts);
    const latest = series[series.length - 1];
    if (!latest) {
      throw createProviderError("NO_DATA", "No DXY data from Yahoo");
    }
    return latest;
  }

  async function getHistory(startDate, endDate, opts = {}) {
    return fetchHistory(startDate, endDate, opts);
  }

  return {
    getLatest,
    getHistory,
  };
}

const defaultProvider = createYahooDxyProvider();

module.exports = {
  createYahooDxyProvider,
  getLatest: (opts) => defaultProvider.getLatest(opts),
  getHistory: (startDate, endDate, opts) => defaultProvider.getHistory(startDate, endDate, opts),
};

