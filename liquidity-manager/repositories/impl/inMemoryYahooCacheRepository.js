"use strict";

class InMemoryYahooCacheRepository {
  constructor() {
    this.map = new Map();
  }

  async get(key, nowMs = Date.now()) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= nowMs) {
      this.map.delete(key);
      return null;
    }
    return {
      payload: entry.payload,
      fetchedAt: entry.fetchedAt,
      expiresAt: entry.expiresAt,
      ttlMsRemaining: Math.max(0, entry.expiresAt - nowMs),
    };
  }

  async set(key, payload, ttlMs, nowMs = Date.now()) {
    const expiresAt = nowMs + Math.max(1, Number(ttlMs) || 1);
    this.map.set(key, {
      payload,
      fetchedAt: new Date(nowMs).toISOString(),
      expiresAt,
    });
    return true;
  }
}

module.exports = InMemoryYahooCacheRepository;

