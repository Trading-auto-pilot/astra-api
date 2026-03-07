// modules/main.js
"use strict";

const BaseService = require("../../shared/BaseService");

class AuthService extends BaseService {
  constructor() {
    super({
      microservice: "authService",
      moduleName: "main",
      moduleVersion: "0.1.0",
      defaultPort: 3015,
    });
  }

  /**
   * Custom initialization logic for authService
   */
  async _onInit() {
    this.logger.info("[_onInit] Custom initialization...");
    // Add any custom auth service initialization here if needed
  }
}

module.exports = AuthService;
