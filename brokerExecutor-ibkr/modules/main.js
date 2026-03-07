// modules/main.js
"use strict";

const BaseService = require("../../shared/BaseService");
const { createIbkrWsOrdersListenerModule } = require("./startup/ibkrWsOrdersListener.module");
const { IbkrOrdersService } = require("../services/ibkr/ibkrOrders.service");

/**
 * BrokerExecutorIbkr - brokerExecutor-ibkr microservice
 *
 * This service extends BaseService which provides:
 * - Redis Bus connection
 * - Logger with DB queuing
 * - Settings management
 * - Standard endpoints
 * - Metrics collection
 * - Graceful shutdown
 */
class BrokerExecutorIbkr extends BaseService {
  constructor() {
    super({
      microservice: "broker-executor-ibkr",
      moduleName: "main",
      moduleVersion: "1.0.0",
    });

    // =====================================================
    // SERVICE-SPECIFIC PROPERTIES
    // =====================================================

    // Add your custom properties here
    // Example:
    // this.data = new Map();
    // this.config = {};
    this.ibkrWsOrdersListener = null;
    this.ordersService = new IbkrOrdersService({ logger: this.logger });
  }

  /**
   * Custom initialization hook
   * Called after Redis connection and settings loading
   */
  async _onInit() {
    this.logger.info("[_onInit] Custom initialization...");
    this.ibkrWsOrdersListener = createIbkrWsOrdersListenerModule({
      service: this,
      logger: this.logger,
    });
    await this.ibkrWsOrdersListener.start();

    // Add your initialization logic here
    // Example:
    // await this._loadConfiguration();
    // await this._setupSubscriptions();
  }

  /**
   * Custom cleanup hook
   * Called during graceful shutdown, before Redis is closed
   */
  async _onShutdown() {
    this.logger.info("[_onShutdown] Cleaning up...");
    if (this.ibkrWsOrdersListener) {
      await this.ibkrWsOrdersListener.stop();
      this.ibkrWsOrdersListener = null;
    }

    // Add your cleanup logic here
    // Example:
    // this.data.clear();
    // await this._saveState();
  }

  getWsOrdersListenerStatus() {
    if (!this.ibkrWsOrdersListener) {
      return {
        connection: {
          listenerStatus: "not_initialized",
          connected: false,
        },
        messages: [],
        generatedAt: new Date().toISOString(),
      };
    }
    return this.ibkrWsOrdersListener.getStatus();
  }

  // =====================================================
  // SERVICE-SPECIFIC METHODS
  // =====================================================

  /**
   * Example method - replace with your business logic
   */
  async processData(data) {
    this.logger.info("[processData] Processing data...", { data });

    // Your logic here

    return { success: true };
  }
}

module.exports = BrokerExecutorIbkr;
