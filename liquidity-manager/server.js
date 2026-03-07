// server.js
"use strict";

const { createMicroserviceServer } = require("../shared/serverFactory");
const liquidityManagerService = require("./modules/main");
const createLiquidityScoreRouter = require("./routes/liquidityScoreRoutes");

/**
 * liquidity-manager REST Server
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
  ServiceClass: liquidityManagerService,
  microservice: "liquidity-manager",
  moduleName: "RESTServer",
  moduleVersion: "1.0.0",
  defaultPort: 3001,

  // Custom routes (add your API endpoints here)
  routes: [
    {
      path: "/",
      router: ({ getService, logger }) => createLiquidityScoreRouter({ getService, logger }),
      protected: true,
    },
  ]
});

// Keep simple health alias for orchestrators expecting /health.
app.get("/health", (_req, res) => {
  const service = getService();
  if (!service) return res.status(503).json({ ok: false, status: "STARTING" });
  return res.json({
    ok: true,
    status: service.status || "READY",
    timestamp: new Date().toISOString(),
  });
});
