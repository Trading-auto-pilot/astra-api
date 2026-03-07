// server.js
"use strict";

const { createMicroserviceServer } = require("../shared/serverFactory");
const AuthService = require("./modules/main");
const buildAuthRouter = require("./auth");

/**
 * authService REST Server
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
  ServiceClass: AuthService,
  microservice: "authService",
  moduleName: "RESTServer",
  moduleVersion: "1.0.0",
  defaultPort: 3015,

  // Custom routes (auth endpoints)
  routes: [
    {
      path: "/auth",
      router: ({ logger, getService }) => buildAuthRouter({
        logger,
        moduleName: "auth",
        getService,
      }),
      protected: false, // Auth routes handle their own auth logic
    },
  ]
});
