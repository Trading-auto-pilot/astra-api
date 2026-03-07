"use strict";

class CircuitBreaker {
  constructor({ failThreshold = 3, coolDownMs = 30 * 60 * 1000, nowFn = () => Date.now() } = {}) {
    this.failThreshold = Math.max(1, Number(failThreshold) || 3);
    this.coolDownMs = Math.max(1000, Number(coolDownMs) || 30 * 60 * 1000);
    this.nowFn = nowFn;
    this.consecutiveFailures = 0;
    this.openUntil = 0;
  }

  state() {
    const now = this.nowFn();
    return {
      state: this.openUntil > now ? "OPEN" : "CLOSED",
      consecutiveFailures: this.consecutiveFailures,
      openUntil: this.openUntil > now ? new Date(this.openUntil).toISOString() : null,
    };
  }

  isOpen() {
    return this.openUntil > this.nowFn();
  }

  onSuccess() {
    this.consecutiveFailures = 0;
    this.openUntil = 0;
  }

  onFailure({ countForOpen = true } = {}) {
    if (!countForOpen) return this.state();
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failThreshold) {
      this.openUntil = this.nowFn() + this.coolDownMs;
    }
    return this.state();
  }
}

module.exports = {
  CircuitBreaker,
};

