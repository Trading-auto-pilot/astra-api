"use strict";

function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class RateLimiter {
  constructor({
    requestsPerSecond = 1,
    requestsPerMinute = 30,
    jitterMinMs = 200,
    jitterMaxMs = 800,
    nowFn = () => Date.now(),
    sleepFn = sleep,
  } = {}) {
    this.rps = Math.max(0.1, Number(requestsPerSecond) || 1);
    this.rpm = Math.max(1, Number(requestsPerMinute) || 30);
    this.jitterMinMs = Math.max(0, Number(jitterMinMs) || 0);
    this.jitterMaxMs = Math.max(this.jitterMinMs, Number(jitterMaxMs) || this.jitterMinMs);
    this.nowFn = nowFn;
    this.sleepFn = sleepFn;
    this.queue = [];
    this.running = false;
    this.nextAllowedAt = 0;
    this.minuteTimestamps = [];
  }

  _jitterMs() {
    if (this.jitterMaxMs <= this.jitterMinMs) return this.jitterMinMs;
    return Math.floor(Math.random() * (this.jitterMaxMs - this.jitterMinMs + 1)) + this.jitterMinMs;
  }

  _pruneMinuteWindow(now) {
    const cutoff = now - 60 * 1000;
    this.minuteTimestamps = this.minuteTimestamps.filter((ts) => ts >= cutoff);
  }

  _computeWaitMs(now) {
    this._pruneMinuteWindow(now);
    const waitRps = Math.max(0, this.nextAllowedAt - now);
    let waitRpm = 0;
    if (this.minuteTimestamps.length >= this.rpm) {
      const oldest = this.minuteTimestamps[0];
      waitRpm = Math.max(0, oldest + 60 * 1000 - now);
    }
    return Math.max(waitRps, waitRpm);
  }

  state() {
    return {
      queued: this.queue.length,
      requestsPerSecond: this.rps,
      requestsPerMinute: this.rpm,
      minuteCount: this.minuteTimestamps.length,
      nextAllowedAt: this.nextAllowedAt,
    };
  }

  async _drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      const now = this.nowFn();
      const baseWaitMs = this._computeWaitMs(now);
      const jitterMs = this._jitterMs();
      const delayMs = baseWaitMs + jitterMs;
      if (delayMs > 0) {
        await this.sleepFn(delayMs);
      }

      const startedAt = this.nowFn();
      this.minuteTimestamps.push(startedAt);
      this.nextAllowedAt = startedAt + Math.ceil(1000 / this.rps);
      try {
        const result = await item.task();
        item.resolve({
          result,
          rateLimit: {
            queued: item.queuedAtSchedule,
            delayMs,
            limiterState: this.state(),
          },
        });
      } catch (err) {
        err.rateLimit = {
          queued: item.queuedAtSchedule,
          delayMs,
          limiterState: this.state(),
        };
        item.reject(err);
      }
    }
    this.running = false;
  }

  schedule(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        task,
        resolve,
        reject,
        queuedAtSchedule: this.queue.length,
      });
      this._drain().catch(reject);
    });
  }
}

module.exports = {
  RateLimiter,
  sleep,
};

