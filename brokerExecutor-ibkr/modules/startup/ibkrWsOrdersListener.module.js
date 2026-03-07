"use strict";

const { IbkrOrdersService } = require("../../services/ibkr/ibkrOrders.service");
const { IbkrWsClient } = require("../ibkr/ws/ibkrWsClient");
const { extractLiveOrderEvents } = require("../ibkr/ws/handlers/liveOrders.handler");
const { OrdersStateUpdater } = require("../ibkr/sync/ordersStateUpdater");
const { PositionsRefresher } = require("../ibkr/sync/positionsRefresher");
const { OrdersReconciler } = require("../ibkr/reconcile/ordersReconciler");

function mapOrderToUpdate(order = {}) {
  const orderId = String(order?.orderId || "").trim();
  if (!orderId) return null;

  const parentOrderId = String(order?.parentOrderId || "").trim();
  return {
    orderId,
    parentOrderId: parentOrderId || null,
    symbol: order?.symbol || null,
    side: order?.side || null,
    status: order?.status || "UNKNOWN",
    filledQty: Number(order?.filledQty || 0) || 0,
    avgFillPrice: Number.isFinite(Number(order?.avgFillPrice)) ? Number(order.avgFillPrice) : null,
    limitPrice: Number.isFinite(Number(order?.limitPrice)) ? Number(order.limitPrice) : null,
    stopLossPrice: Number.isFinite(Number(order?.stopLossPrice)) ? Number(order.stopLossPrice) : null,
    decisionEngineRunId: order?.decisionEngineRunId || null,
    externalCorrelationId: order?.externalCorrelationId || null,
    bracketRole: order?.bracketRole || null,
    ts: new Date().toISOString(),
    raw: order,
  };
}

class IbkrWsOrdersListenerModule {
  constructor({ service, logger }) {
    this.service = service;
    this.logger = logger;
    this.ordersService = new IbkrOrdersService({ logger });
    this.stateUpdater = new OrdersStateUpdater({
      logger,
      bus: service.bus,
      eventsChannel: service.redisEventsChannel,
      env: service.env,
    });
    this.positionsRefresher = new PositionsRefresher({
      logger,
      ordersService: this.ordersService,
      bus: service.bus,
      eventsChannel: service.redisEventsChannel,
      env: service.env,
    });
    this.reconciler = new OrdersReconciler({
      logger,
      ordersService: this.ordersService,
      onOrdersSnapshot: async (orders, reason) => {
        const updates = orders.map(mapOrderToUpdate).filter(Boolean);
        await this.stateUpdater.applyUpdates(updates);
        this.logger.trace?.(`[onOrdersSnapshot] applied=${updates.length} reason=${reason}`);
      },
    });
    this.connectionStatus = "idle";
    this.statusDetails = null;
    this.recentMessages = [];
    this.maxRecentMessages = 100;

    this.wsClient = new IbkrWsClient({
      logger,
      onLiveOrderMessage: async (payload) => {
        const updates = extractLiveOrderEvents(payload, logger);
        if (!updates.length) return;
        const effective = await this.stateUpdater.applyUpdates(updates);
        this._pushMessages(effective, "ws");
        if (effective.some((item) => item.status === "FILLED" || item.status === "PARTIALLY_FILLED")) {
          await this.positionsRefresher.requestRefresh("ws-fill");
        }
      },
      onStatus: async (status, detail) => {
        this.connectionStatus = status;
        this.statusDetails = detail || null;
        if (status === "connected") {
          await this.reconciler.runOnce("ws-connected");
        }
      },
    });
  }

  async start() {
    this.logger.info("[start] starting IBKR WS orders listener");
    await this.reconciler.start();
    await this.wsClient.start();
  }

  async stop() {
    this.logger.info("[stop] stopping IBKR WS orders listener");
    await this.wsClient.stop();
    await this.reconciler.stop();
  }

  _pushMessages(updates, source) {
    const now = new Date().toISOString();
    for (const item of updates) {
      this.recentMessages.push({
        ts: now,
        source: source || "ws",
        orderId: item.orderId,
        parentOrderId: item.parentOrderId || null,
        symbol: item.symbol || null,
        status: item.status || "UNKNOWN",
        filledQty: Number(item.filledQty || 0) || 0,
        avgFillPrice: item.avgFillPrice ?? null,
        bracketRole: item.bracketRole || null,
      });
    }
    if (this.recentMessages.length > this.maxRecentMessages) {
      this.recentMessages.splice(0, this.recentMessages.length - this.maxRecentMessages);
    }
  }

  getStatus() {
    return {
      connection: {
        listenerStatus: this.connectionStatus,
        details: this.statusDetails,
        ...this.wsClient.getStatus(),
      },
      messages: [...this.recentMessages].reverse(),
      generatedAt: new Date().toISOString(),
    };
  }
}

function createIbkrWsOrdersListenerModule({ service, logger }) {
  return new IbkrWsOrdersListenerModule({ service, logger });
}

module.exports = {
  createIbkrWsOrdersListenerModule,
};
