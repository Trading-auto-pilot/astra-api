"use strict";

const { CircuitBreaker } = require("./circuitBreaker");
const { getConfigNumber } = require("../../../shared/loadSettings");

const yahooCircuit = new CircuitBreaker({
  failThreshold: getConfigNumber("YAHOO_CIRCUIT_FAILS", 3),
  coolDownMs: getConfigNumber("YAHOO_CIRCUIT_COOLDOWN_MIN", 30) * 60 * 1000,
});

module.exports = {
  yahooCircuit,
};
