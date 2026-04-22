// modules/main.js
"use strict";

const BaseService = require("../../shared/BaseService");
const { getConfigString } = require("../../shared/loadSettings");

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
    this.dbmanagerUrl = getConfigString(["DATAHUB_URL", "DBMANAGER_URL"], "http://datahub:3000");
    this.marketsimulatorUrl = getConfigString(["MARKETSIMULATOR_URL", "SIMULATOR_URL"], "http://marketsimulator:3003");
    this.ordersimulatorUrl = getConfigString("ORDERSIMULATOR_URL", "http://ordersimulator:3004");
    this.orderlistnerUrl = getConfigString("ORDERLISTNER_URL", "http://orderlistner:3005");
    this.cachemanagerUrl = getConfigString("CACHEMANAGER_URL", "http://cachemanager:3006");
    this.strategyUtilsUrl = getConfigString("STRATEGYUTILS_URL", "http://strategyUtils:3007");
    this.alertingserviceUrl = getConfigString(["ALERTINGSERVICE_URL", "ALERTINGMANAGER_URL"], "http://alertingservice:3008");
    this.capitalmanagerUrl = getConfigString(["CAPITALMANAGER_URL", "CAPITAL_MANAGER_URL"], "http://capitalmanager:3009");
    this.smaUrl = getConfigString("SMA_URL", "http://sma:3010");
    this.sltpUrl = getConfigString("SLTP_URL", "http://sltp:3011");
    this.livemarketlistnerUrl = getConfigString("LIVEMARKETLISTNER_URL", "http://livemarketlistner:3012");
    this.tickerscannerUrl = getConfigString(["TICKERSCANNER_URL", "TICKERSCANNER"], "http://tickerscanner:3013");
    this.schedulerUrl = getConfigString("SCHEDULER_URL", "http://scheduler:3014");
    this.authServiceUrl = getConfigString("AUTHSERVICE_URL", "http://authService:3015");
    this.servicecontrolplaneUrl = getConfigString(["SERVICECONTROLPLANE_URL", "SERVICE_CONTROL_PLANE_URL"], "http://servicecontrolplane:3016");
  }

  /**
   * Hook custom per inizializzazione specifica del servizio
   */
  async _onInit() {
    this.logger.info("[_onInit] ServiceControlPlane initialization complete");
  }
}

module.exports = ServiceControlPlane;
