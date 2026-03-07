// server.js
"use strict";

const { createMicroserviceServer } = require("../shared/serverFactory");
const IbkrBridge = require("./modules/main");
const buildIbkrRouter = require("./ibkrRoutes");

/**
 * ibkr-bridge REST Server
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
  ServiceClass: IbkrBridge,
  microservice: "ibkr-bridge",
  moduleName: "RESTServer",
  moduleVersion: "1.0.0",
  defaultPort: 3017,

  // Custom routes (IBKR proxy endpoints)
  routes: [
    {
      path: "/",
      router: ({ getService, logger }) => buildIbkrRouter(getService, logger),
      protected: true,
    },
  ]
});
