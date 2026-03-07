// modules/utils/hash.js
"use strict";

const { randomBytes } = require("crypto");

/**
 * Generates a unique reservation ID.
 * Format: res_{timestamp}_{random8hex}
 * @returns {string}
 */
function generateReservationId() {
  const ts = Date.now().toString(36);
  const rand = randomBytes(4).toString("hex");
  return `res_${ts}_${rand}`;
}

module.exports = { generateReservationId };
