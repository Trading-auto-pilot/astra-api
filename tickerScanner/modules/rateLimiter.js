// modules/rateLimiter.js
"use strict";

/**
 * RateLimiter – adaptive throttling
 * FMP limit: 300 API/min = 5 requests/second
 * queue capacity: illimitata
 *
 * Su 429 il rate viene dimezzato (min 1 req/sec).
 * Dopo RECOVERY_SECONDS senza 429 il rate risale di +1 fino al baseRate.
 */

const RECOVERY_SECONDS = 30;

class RateLimiter {
  constructor({ maxPerSecond = 5, logger = console }) {
    this._baseRate = maxPerSecond;
    this._currentRate = maxPerSecond;
    this.logger = logger;

    this.queue = [];
    this.active = 0;

    this._lastRateLimitAt = 0;       // timestamp ultimo 429
    this._successSinceThrottle = 0;  // chiamate OK consecutive dopo un throttle

    setInterval(() => this._tick(), 1000);
  }

  get currentRate() {
    return this._currentRate;
  }

  /** Chiamata ogni secondo: processa la coda e tenta il recovery. */
  _tick() {
    this._tryRecover();
    this._processQueue();
  }

  _processQueue() {
    const toProcess = Math.min(this._currentRate, this.queue.length);
    for (let i = 0; i < toProcess; i++) {
      const job = this.queue.shift();
      this._execute(job);
    }
  }

  _tryRecover() {
    if (this._currentRate >= this._baseRate) return;
    const elapsed = (Date.now() - this._lastRateLimitAt) / 1000;
    if (elapsed >= RECOVERY_SECONDS) {
      this._currentRate = Math.min(this._currentRate + 1, this._baseRate);
      this.logger.info(
        `[RateLimiter] Recovery +1 -> ${this._currentRate}/${this._baseRate} req/sec`
      );
      this._lastRateLimitAt = Date.now(); // reset timer per il prossimo step
    }
  }

  /** Da chiamare quando si riceve un 429. Dimezza il rate. */
  notifyRateLimit() {
    const prev = this._currentRate;
    this._currentRate = Math.max(1, Math.floor(this._currentRate / 2));
    this._lastRateLimitAt = Date.now();
    this._successSinceThrottle = 0;
    this.logger.warning(
      `[RateLimiter] 429 received – rate ${prev} -> ${this._currentRate} req/sec`
    );
  }

  /** Da chiamare dopo ogni richiesta andata a buon fine. */
  notifySuccess() {
    this._successSinceThrottle++;
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
