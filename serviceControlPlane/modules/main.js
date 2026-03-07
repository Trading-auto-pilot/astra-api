// modules/main.js
"use strict";

const BaseService = require("../../shared/BaseService");

class ServiceControlPlane extends BaseService {
  constructor() {
    super({
      microservice: "serviceControlPlane",
      moduleName: "main",
      moduleVersion: "1.0.0",
      defaultPort: 3016,
    });

    // =====================================================
    // URL DI TUTTI I MICROSERVIZI STANDARD DEL SISTEMA
    // =====================================================
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
  }

  /**
   * Hook custom per inizializzazione specifica del servizio
   */
  async _onInit() {
    this.logger.info("[_onInit] ServiceControlPlane initialization complete");
  }
}

module.exports = ServiceControlPlane;
