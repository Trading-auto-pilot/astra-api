"use strict";

class LiquidityScheduler {
  constructor({ service, logger, intervalMin = 15, historyDays = 365, enabled = true } = {}) {
    this.service = service;
    this.logger = logger || console;
    this.intervalMin = Number(intervalMin) > 0 ? Number(intervalMin) : 15;
    this.historyDays = Number(historyDays) > 0 ? Number(historyDays) : 365;
    this.enabled = Boolean(enabled);
    this.timer = null;
    this.running = false;
  }

  async tick(reason = "scheduled") {
    if (this.running) return;
    this.running = true;
    try {
      const snapshot = await this.service.recomputeLiquidityScore({ reason });
      await this.service.repository.prune({ historyDays: this.historyDays });
      this.logger?.info?.(
        `[liquidity-scheduler] recompute ok reason=${reason} score=${snapshot.score} regime=${snapshot.riskRegime}`
      );
    } catch (err) {
      this.logger?.error?.(
        `[liquidity-scheduler] recompute failed reason=${reason} err=${err?.message || String(err)}`
      );
    } finally {
      this.running = false;
    }
  }

  async start() {
    if (!this.enabled) {
      this.logger?.info?.("[liquidity-scheduler] disabled by configuration");
      return;
    }
    if (this.timer) return;

    await this.tick("startup");
    const intervalMs = this.intervalMin * 60 * 1000;
    this.timer = setInterval(() => {
      this.tick("interval").catch(() => {});
    }, intervalMs);
    this.logger?.info?.(`[liquidity-scheduler] started intervalMin=${this.intervalMin}`);
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger?.info?.("[liquidity-scheduler] stopped");
  }
}

module.exports = LiquidityScheduler;

