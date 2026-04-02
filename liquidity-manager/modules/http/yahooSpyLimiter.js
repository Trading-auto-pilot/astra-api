"use strict";

const { RateLimiter } = require("./rateLimiter");
const { getConfigNumber } = require("../../../shared/loadSettings");

// Dedicated rate limiter for SPY — isolated from DXY to avoid shared quota exhaustion
const yahooSpyLimiter = new RateLimiter({
  requestsPerSecond: getConfigNumber("YAHOO_SPY_RATE_LIMIT_RPS", 1),
  requestsPerMinute: getConfigNumber("YAHOO_SPY_RATE_LIMIT_RPM", 10),
  jitterMinMs: getConfigNumber("YAHOO_SPY_JITTER_MIN_MS", 300),
  jitterMaxMs: getConfigNumber("YAHOO_SPY_JITTER_MAX_MS", 1200),
});

module.exports = { yahooSpyLimiter };
