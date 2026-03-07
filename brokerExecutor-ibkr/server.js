// server.js
"use strict";

const { createMicroserviceServer } = require("../shared/serverFactory");
const brokerExecutorIbkrService = require("./modules/main");
const brokerExecutorIbkrRouter = require("./routes/brokerExecutorIbkr.routes");

/**
 * brokerExecutor-ibkr REST Server
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
  ServiceClass: brokerExecutorIbkrService,
  microservice: "broker-executor-ibkr",
  moduleName: "RESTServer",
  moduleVersion: "1.0.0",
  defaultPort: 3003,

  // Custom routes (add your API endpoints here)
  routes: [
    {
      path: "/",
      router: ({ logger, getService }) => brokerExecutorIbkrRouter({ logger, getService }),
      protected: true
    },
  ]
});

// Additional custom middleware or routes can be added here
// Example:
// app.get('/custom', (req, res) => {
//   const service = getService();
//   res.json({ custom: 'data' });
// });
