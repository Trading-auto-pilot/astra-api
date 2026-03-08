// server.js
"use strict";

const { createMicroserviceServer } = require("../shared/serverFactory");
const ServiceControlPlane = require("./modules/main");
const buildServiceFlagsRouter = require("./serviceFlags");

/**
 * serviceControlPlane REST Server
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

const buildContainersRouter = require("./routes/containers");

const { app, getService, logger } = createMicroserviceServer({
  ServiceClass: ServiceControlPlane,
  microservice: "serviceControlPlane",
  moduleName: "RESTServer",
  moduleVersion: "1.0.0",
  defaultPort: 3016,

  // Custom routes
  routes: [
    {
      path: "/service-flags",
      router: ({ getService, logger }) => buildServiceFlagsRouter(getService, logger),
      protected: true,
    },
    {
      path: "/containers",
      router: buildContainersRouter,
      protected: true,
    },
  ]
});
