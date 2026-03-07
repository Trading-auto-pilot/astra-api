"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createYahooDxyProvider } = require("../providers/dxyProviderYahoo");
const { CircuitBreaker } = require("../modules/resilience/circuitBreaker");
const InMemoryYahooCacheRepository = require("../repositories/impl/inMemoryYahooCacheRepository");

function makeYahooBody(closeValue = 103.2) {
  return JSON.stringify({
    chart: {
      result: [
        {
          timestamp: [1730419200, 1730505600],
          indicators: {
            quote: [
              {
                close: [closeValue - 0.1, closeValue],
              },
            ],
          },
        },
      ],
    },
  });
}

test("Yahoo DXY provider uses cache on second call", async () => {
  let networkCalls = 0;
  const provider = createYahooDxyProvider({
    yahooGetFn: async () => {
      networkCalls += 1;
      return {
        body: makeYahooBody(104.5),
        statusCode: 200,
        latencyMs: 12,
        headers: {},
      };
    },
    limiter: {
      async schedule(task) {
        const result = await task();
        return { result, rateLimit: { queued: 0, delayMs: 0, limiterState: {} } };
      },
    },
    cacheRepository: new InMemoryYahooCacheRepository(),
    circuit: new CircuitBreaker({ failThreshold: 3, coolDownMs: 1000 }),
    sleepFn: async () => {},
  });

  const first = await provider.getHistory(undefined, undefined, { logger: console });
  const second = await provider.getHistory(undefined, undefined, { logger: console });

  assert.equal(networkCalls, 1);
  assert.equal(first.length > 0, true);
  assert.equal(second.length > 0, true);
  assert.equal(first[first.length - 1].value, second[second.length - 1].value);
});

test("Yahoo DXY provider retries on 429 and opens circuit", async () => {
  const originalMaxAttempts = process.env.YAHOO_RETRY_MAX_ATTEMPTS;
  const originalBaseMs = process.env.YAHOO_RETRY_BASE_MS;
  const originalMaxMs = process.env.YAHOO_RETRY_MAX_MS;
  process.env.YAHOO_RETRY_MAX_ATTEMPTS = "5";
  process.env.YAHOO_RETRY_BASE_MS = "1";
  process.env.YAHOO_RETRY_MAX_MS = "5";

  try {
    let networkCalls = 0;
    const provider = createYahooDxyProvider({
      yahooGetFn: async () => {
        networkCalls += 1;
        const err = new Error("HTTP 429");
        err.code = "HTTP_ERROR";
        err.statusCode = 429;
        err.details = {
          statusCode: 429,
          retryAfterSec: 0,
          headers: { "retry-after": "0" },
        };
        throw err;
      },
      limiter: {
        async schedule(task) {
          const result = await task();
          return { result, rateLimit: { queued: 0, delayMs: 0, limiterState: {} } };
        },
      },
      cacheRepository: new InMemoryYahooCacheRepository(),
      circuit: new CircuitBreaker({ failThreshold: 3, coolDownMs: 30 * 60 * 1000 }),
      sleepFn: async () => {},
    });

    await assert.rejects(
      async () => provider.getHistory(undefined, undefined, { logger: console }),
      (err) => err && (err.code === "CIRCUIT_OPEN" || err.code === "YAHOO_FETCH_FAILED")
    );
    const callsAfterFirst = networkCalls;
    assert.equal(callsAfterFirst >= 3, true);

    await assert.rejects(
      async () => provider.getHistory(undefined, undefined, { logger: console }),
      (err) => err && err.code === "CIRCUIT_OPEN"
    );
    assert.equal(networkCalls, callsAfterFirst);
  } finally {
    if (originalMaxAttempts == null) delete process.env.YAHOO_RETRY_MAX_ATTEMPTS;
    else process.env.YAHOO_RETRY_MAX_ATTEMPTS = originalMaxAttempts;
    if (originalBaseMs == null) delete process.env.YAHOO_RETRY_BASE_MS;
    else process.env.YAHOO_RETRY_BASE_MS = originalBaseMs;
    if (originalMaxMs == null) delete process.env.YAHOO_RETRY_MAX_MS;
    else process.env.YAHOO_RETRY_MAX_MS = originalMaxMs;
  }
});
