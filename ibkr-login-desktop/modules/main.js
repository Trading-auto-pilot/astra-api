// modules/main.js
"use strict";

const BaseService = require("../../shared/BaseService");

/**
 * IbkrLoginDesktop - ibkr-login-desktop microservice
 *
 * This service extends BaseService which provides:
 * - Redis Bus connection
 * - Logger with DB queuing
 * - Settings management
 * - Standard endpoints
 * - Metrics collection
 * - Graceful shutdown
 */
class IbkrLoginDesktop extends BaseService {
  constructor() {
    super({
      microservice: "ibkr-login-desktop",
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
  }

  /**
   * Custom initialization hook
   * Called after Redis connection and settings loading
   */
  async _onInit() {
    this.logger.info("[_onInit] Custom initialization...");

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

    // Add your cleanup logic here
    // Example:
    // this.data.clear();
    // await this._saveState();
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

module.exports = IbkrLoginDesktop;
