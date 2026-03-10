// modules/main.js
"use strict";

const { randomUUID } = require("crypto");
const BaseService = require("../../shared/BaseService");
const { getSetting } = require("../../shared/loadSettings");
const IbkrConnectivity = require("./connectivity");

class IbkrBridge extends BaseService {
  constructor() {
    super({
      microservice: "ibkr-bridge",
      moduleName: "main",
      moduleVersion: "1.0.0",
      defaultPort: 3017,
    });

    // All microservice URLs
    // Support both DATAHUB_URL (preferred) and DBMANAGER_URL (backward compat)
    this.dbmanagerUrl = process.env.DATAHUB_URL || process.env.DBMANAGER_URL || "http://datahub:3000";
    this.marketsimulatorUrl = process.env.MARKETSIMULATOR_URL || "http://marketsimulator:3003";
    this.ordersimulatorUrl = process.env.ORDERSIMULATOR_URL || "http://ordersimulator:3004";
    this.orderlistnerUrl = process.env.ORDERLISTNER_URL || "http://orderlistner:3005";
    this.cachemanagerUrl = process.env.CACHEMANAGER_URL || "http://cachemanager:3006";
    this.strategyUtilsUrl = process.env.STRATEGYUTILS_URL || "http://strategyUtils:3007";
    this.alertingserviceUrl = process.env.ALERTINGSERVICE_URL || "http://alertingservice:3008";
    this.capitalmanagerUrl = process.env.CAPITALMANAGER_URL || "http://capitalmanager:3009";
    this.smaUrl = process.env.SMA_URL || "http://sma:3010";
    this.sltpUrl = process.env.SLTP_URL || "http://sltp:3011";
    this.livemarketlistnerUrl = process.env.LIVEMARKETLISTNER_URL || "http://livemarketlistner:3012";
    this.tickerscannerUrl = process.env.TICKERSCANNER_URL || "http://tickerscanner:3013";
    this.schedulerUrl = process.env.SCHEDULER_URL || "http://scheduler:3014";
    this.authServiceUrl = process.env.AUTHSERVICE_URL || "http://authService:3015";
    this.servicecontrolplaneUrl = process.env.SERVICECONTROLPLANE_URL || "http://servicecontrolplane:3016";
    this.ibkrbridgeUrl = process.env.IBKRBRIDGE_URL || "http://ibkr-bridge:3017";

    // Connectivity state machine
    this.connectivity = new IbkrConnectivity({
      logger: this.logger,
      getSetting,
      publishTelemetry: async (payload) =>
        this.bus.publish(this.redisTelemetryChannel, payload),
      publishHook: async (event, payload) =>
        this._publishHook(event, payload),
      getEnv: () => this.env,
      getStatus: () => this._status,
    });
  }

  /**
   * Publish a hook message to `${env}.hooks` channel (fail-soft).
   * @param {string} event
   * @param {object} payload
   */
  async _publishHook(event, payload = {}) {
    try {
      const channel = `${this.env}.hooks`;
      await this.bus.publish(channel, {
        event,
        source: "ibkr-bridge",
        ts: new Date().toISOString(),
        correlationId: randomUUID(),
        ...payload,
      });
    } catch (err) {
      this.logger.warning(
        `[_publishHook] ${event}: ${err?.message || String(err)}`
      );
    }
  }

  /**
   * Custom initialization logic for ibkr-bridge
   */
  async _onInit() {
    this.logger.info("[_onInit] Starting connectivity loop");
    this.connectivity.start();
  }

  /**
   * Get info with auth status
   */
  async getInfoWithAuth() {
    const info = this.getInfo();
    const authStatus = this.connectivity?.getAuthStatus
      ? await this.connectivity.getAuthStatus()
      : null;
    return {
      ...info,
      authStatus,
      Connectivity: this.connectivity?.getState?.() || null,
    };
  }

  /**
   * Override disconnect to also stop connectivity
   */
  async disconnect() {
    this.logger.info("[disconnect] Shutting down connectivity...");
    try {
      this.connectivity?.stop?.();
    } catch (e) {
      this.logger.error("[disconnect] Error stopping connectivity", e);
    }
    return await super.disconnect();
  }
}

module.exports = IbkrBridge;
