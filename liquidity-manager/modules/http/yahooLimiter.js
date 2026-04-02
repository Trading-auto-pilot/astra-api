"use strict";

const { RateLimiter } = require("./rateLimiter");
const { getConfigNumber } = require("../../../shared/loadSettings");

const yahooLimiter = new RateLimiter({
  requestsPerSecond: getConfigNumber("YAHOO_RATE_LIMIT_RPS", 1),
  requestsPerMinute: getConfigNumber("YAHOO_RATE_LIMIT_RPM", 30),
  jitterMinMs: getConfigNumber("YAHOO_JITTER_MIN_MS", 200),
  jitterMaxMs: getConfigNumber("YAHOO_JITTER_MAX_MS", 800),
});

module.exports = {
  yahooLimiter,
};
