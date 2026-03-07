"use strict";

function buildEventType(status) {
  if (status === "FILLED" || status === "PARTIALLY_FILLED") return "broker.ibkr.order.filled";
  if (status === "CANCELLED") return "broker.ibkr.order.cancelled";
  return "broker.ibkr.order.updated";
}

class OrdersStateUpdater {
  constructor({ logger, bus, eventsChannel, env }) {
    this.logger = logger;
    this.bus = bus;
    this.eventsChannel = eventsChannel;
    this.env = env || process.env.ENV || "DEV";
    this.state = new Map(); // orderId -> { status, filledQty, ts }
  }

  _isDuplicate(update) {
    const prev = this.state.get(update.orderId);
    if (!prev) return false;
    return (
      String(prev.status || "") === String(update.status || "") &&
      Number(prev.filledQty || 0) === Number(update.filledQty || 0)
    );
  }

  async applyUpdates(updates = []) {
    const effective = [];
    for (const update of updates) {
      if (!update?.orderId) continue;
      if (this._isDuplicate(update)) continue;

      this.state.set(update.orderId, {
        status: update.status,
        filledQty: update.filledQty,
        ts: update.ts || new Date().toISOString(),
      });
      effective.push(update);
    }

    for (const update of effective) {
      const eventType = buildEventType(update.status);
      const payload = {
        eventType,
        broker: "IBKR",
        env: this.env,
        parentOrderId: update.parentOrderId || update.orderId,
        orderId: update.orderId,
        childOrderIds: update.parentOrderId ? [update.orderId] : [],
        symbol: update.symbol,
        status: update.status,
        filledQty: update.filledQty,
        avgFillPrice: update.avgFillPrice,
        decisionEngineRunId: update.decisionEngineRunId,
        externalCorrelationId: update.externalCorrelationId,
        ts: update.ts || new Date().toISOString(),
      };

      try {
        await this.bus.publish(this.eventsChannel, payload);
      } catch (err) {
        this.logger.warning(
          `[applyUpdates] publish failed orderId=${update.orderId}: ${err?.message || String(err)}`
        );
      }
    }

    return effective;
  }
}

module.exports = {
  OrdersStateUpdater,
};
