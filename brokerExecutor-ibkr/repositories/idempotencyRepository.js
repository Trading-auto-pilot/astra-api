"use strict";

class InMemoryIdempotencyRepository {
  constructor() {
    this.store = new Map();
  }

  _cleanup(now = Date.now()) {
    for (const [key, item] of this.store.entries()) {
      if (!item || item.expiresAt <= now) this.store.delete(key);
    }
  }

  get(key) {
    this._cleanup();
    return this.store.get(key) || null;
  }

  set(key, value, ttlMs) {
    const now = Date.now();
    this._cleanup(now);
    const expiresAt = now + Math.max(1000, Number(ttlMs) || 1000);
    this.store.set(key, { value, expiresAt, createdAt: now });
    return this.store.get(key);
  }
}

module.exports = {
  InMemoryIdempotencyRepository,
};
