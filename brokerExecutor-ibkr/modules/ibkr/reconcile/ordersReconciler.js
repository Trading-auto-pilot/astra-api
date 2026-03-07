"use strict";

const { asInt } = require("../../../../shared/helpers");

class OrdersReconciler {
  constructor({ logger, ordersService, onOrdersSnapshot }) {
    this.logger = logger;
    this.ordersService = ordersService;
    this.onOrdersSnapshot = onOrdersSnapshot;
    this.pollMs = asInt(process.env.IBKR_WS_RECONCILE_POLL_MS, 60000);
    this.timer = null;
    this.running = false;
  }

  async start() {
    if (this.timer || this.pollMs <= 0) return;
    await this.runOnce("startup");
    this.timer = setInterval(() => this.runOnce("interval"), this.pollMs);
    this.logger.info(`[start] orders reconciler started pollMs=${this.pollMs}`);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(reason = "manual") {
    if (this.running) return;
    this.running = true;
    try {
      const orders = await this.ordersService.listOpenOrders();
      await this.onOrdersSnapshot?.(orders, reason);
      this.logger.trace?.(`[runOnce] reconcile ok count=${orders.length} reason=${reason}`);
    } catch (err) {
      this.logger.warning(`[runOnce] reconcile failed: ${err?.message || String(err)} reason=${reason}`);
    } finally {
      this.running = false;
    }
  }
}

module.exports = {
  OrdersReconciler,
};
