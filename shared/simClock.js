"use strict";

// ---------------------------------------------------------------------------
// simClock — virtual clock for simulation / live trading
//
// In LIVE mode   : now() delegates to Date.now() (no overhead)
// In SIM mode    : now() returns the timestamp injected by sim-engine at each
//                  tick (last candle timestamp). This ensures all TTL checks,
//                  cooldowns, cache expiry and date calculations inside every
//                  microservice reflect simulation time rather than wall-clock.
//
// Usage:
//   const simClock = require("../../shared/simClock");
//
//   simClock.now()        // → Number ms epoch (live or sim)
//   simClock.inject(ts)   // called by sim-engine at every tick (sim mode only)
//   simClock.reset()      // back to live mode
//   simClock.isSimMode()  // → Boolean
//   simClock.dayOf()      // → "YYYY-MM-DD" UTC
//   simClock.hourOf()     // → 0-23 UTC
//   simClock.toDate()     // → Date object
// ---------------------------------------------------------------------------

let _injectedTs = null;

const simClock = {
  /**
   * Returns current timestamp in milliseconds.
   * Sim mode: returns the last injected candle timestamp.
   * Live mode: returns Date.now().
   */
  now() {
    return _injectedTs !== null ? _injectedTs : Date.now();
  },

  /**
   * Inject a simulated timestamp (called by sim-engine at each tick).
   * @param {number} ts - Unix timestamp in milliseconds
   */
  inject(ts) {
    if (!Number.isFinite(ts) || ts <= 0) {
      throw new Error(`simClock.inject: invalid timestamp ${ts}`);
    }
    _injectedTs = ts;
  },

  /**
   * Reset to live mode (now() will return Date.now() again).
   */
  reset() {
    _injectedTs = null;
  },

  /** Returns true when a timestamp has been injected (sim mode active). */
  isSimMode() {
    return _injectedTs !== null;
  },

  /** Current date as "YYYY-MM-DD" (UTC). */
  dayOf() {
    return new Date(this.now()).toISOString().split("T")[0];
  },

  /** Current UTC hour (0–23). */
  hourOf() {
    return new Date(this.now()).getUTCHours();
  },

  /** Current time as a Date object. */
  toDate() {
    return new Date(this.now());
  },
};

module.exports = simClock;
