"use strict";

class InMemoryLiquidityScoreRepository {
  constructor({ logger } = {}) {
    this.logger = logger || console;
    this.latest = null;
    this.history = [];
  }

  async init() {
    return true;
  }

  async getLatest() {
    return this.latest;
  }

  async saveSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return null;
    this.latest = { ...snapshot };
    this.history.push({ ...snapshot });
    return this.latest;
  }

  async getHistory({ days = 30 } = {}) {
    const maxDays = Number(days);
    const rangeDays = Number.isFinite(maxDays) && maxDays > 0 ? maxDays : 30;
    const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
    return this.history.filter((item) => {
      const ts = new Date(item.timestamp).getTime();
      return Number.isFinite(ts) && ts >= cutoff;
    });
  }

  async prune({ historyDays }) {
    const days = Number(historyDays);
    if (!Number.isFinite(days) || days <= 0) return this.history.length;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    this.history = this.history.filter((item) => {
      const ts = new Date(item.timestamp).getTime();
      return Number.isFinite(ts) && ts >= cutoff;
    });
    return this.history.length;
  }
}

module.exports = InMemoryLiquidityScoreRepository;

