// modules/rateLimiter.js
"use strict";

/**
 * RateLimiter
 * FMP limit: 300 API/min = 5 requests/second
 * queue capacity: illimitata
 */

class RateLimiter {
  constructor({ maxPerSecond = 5, logger = console }) {
    this.maxPerSecond = maxPerSecond;
    this.logger = logger;

    this.queue = [];
    this.active = 0;

    setInterval(() => this._processQueue(), 1000);
  }

  _processQueue() {
    const toProcess = Math.min(this.maxPerSecond, this.queue.length);

    for (let i = 0; i < toProcess; i++) {
      const job = this.queue.shift();
      this._execute(job);
    }
  }

  async _execute(job) {
    this.active++;
    try {
      const res = await job.fn();
      job.resolve(res);
    } catch (e) {
      job.reject(e);
    } finally {
      this.active--;
    }
  }

  /**
   * wrapper per funzioni async che generano una singola API call
   */
  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
    });
  }
}

module.exports = RateLimiter;
