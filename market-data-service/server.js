// server.js
"use strict";

const { createMicroserviceServer } = require("../shared/serverFactory");
const marketDataServiceService = require("./modules/main");
const ibkrMarketDataModule = require("./modules/ibkrMarketData");

/**
 * market-data-service REST Server
 *
 * Uses serverFactory which provides:
 * - Express setup with JSON middleware
 * - CORS configuration (Traefik-compatible)
 * - Service initialization
 * - requireReady middleware
 * - Standard routes (/release, /settings, /connect, /dbLogger)
 * - Status router (/status/*)
 * - Graceful shutdown
 */

const { app, getService, logger } = createMicroserviceServer({
  ServiceClass: marketDataServiceService,
  microservice: "market-data-service",
  moduleName: "RESTServer",
  moduleVersion: "1.0.0",
  defaultPort: 3020,

  // Custom routes (add your API endpoints here)
  routes: [
    // Example:
    // { path: '/api', router: apiRouter, protected: true }
  ]
});

// Initialize and start IBKR Market Data module
let ibkrMarketData;

(async () => {
  try {
    // Wait for service to be initialized
    let service;
    await new Promise((resolve) => {
      const checkReady = setInterval(() => {
        service = getService();
        if (service && service.status === "READY") {
          clearInterval(checkReady);
          resolve();
        }
      }, 100);
    });

    ibkrMarketData = await ibkrMarketDataModule.init({
      app,
      redisClient: service.bus,
      redisBus: service.bus,
      redisDataChannel: service.redisDataChannel,
      logger,
    });

    await ibkrMarketData.start();
    logger.info("[market-data-service] IBKR Market Data module initialized successfully");
  } catch (err) {
    logger.error(
      `[market-data-service] Error initializing IBKR Market Data: ${err?.message || String(err)}`
    );
  }
})();
