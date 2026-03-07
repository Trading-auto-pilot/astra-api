"use strict";

const { asInt } = require("../../../../shared/helpers");

class PositionsRefresher {
  constructor({ logger, ordersService, bus, eventsChannel, env }) {
    this.logger = logger;
    this.ordersService = ordersService;
    this.bus = bus;
    this.eventsChannel = eventsChannel;
    this.env = env || process.env.ENV || "DEV";
    this.debounceMs = asInt(process.env.IBKR_POSITIONS_REFRESH_DEBOUNCE_MS, 3000);
    this.lastRunAt = 0;
    this.pending = false;
  }

  async requestRefresh(reason = "unknown") {
    const now = Date.now();
    if (this.pending) return;
    if (now - this.lastRunAt < this.debounceMs) return;
    this.pending = true;
    try {
      this.lastRunAt = Date.now();
      const positions = await this.ordersService.listPositions();
      const payload = {
        eventType: "broker.ibkr.position.updated",
        broker: "IBKR",
        env: this.env,
        reason,
        count: positions.length,
        ts: new Date().toISOString(),
      };
      await this.bus.publish(this.eventsChannel, payload);
      this.logger.info(`[requestRefresh] positions refreshed count=${positions.length} reason=${reason}`);
    } catch (err) {
      this.logger.warning(`[requestRefresh] failed: ${err?.message || String(err)}`);
    } finally {
      this.pending = false;
    }
  }
}

module.exports = {
  PositionsRefresher,
};
