"use strict";

const { RateLimiter } = require("./rateLimiter");

const yahooLimiter = new RateLimiter({
  requestsPerSecond: Number(process.env.YAHOO_RATE_LIMIT_RPS) || 1,
  requestsPerMinute: Number(process.env.YAHOO_RATE_LIMIT_RPM) || 30,
  jitterMinMs: Number(process.env.YAHOO_JITTER_MIN_MS) || 200,
  jitterMaxMs: Number(process.env.YAHOO_JITTER_MAX_MS) || 800,
});

module.exports = {
  yahooLimiter,
};

