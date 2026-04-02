"use strict";

const { CircuitBreaker } = require("./circuitBreaker");
const { getConfigNumber } = require("../../../shared/loadSettings");

// Dedicated circuit breaker for SPY — isolated from DXY to avoid cross-contamination
const yahooSpyCircuit = new CircuitBreaker({
  failThreshold: getConfigNumber("YAHOO_SPY_CIRCUIT_FAILS", 3),
  coolDownMs: getConfigNumber("YAHOO_SPY_CIRCUIT_COOLDOWN_MIN", 30) * 60 * 1000,
});

module.exports = { yahooSpyCircuit };
