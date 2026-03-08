// server.js
"use strict";

const { createMicroserviceServer } = require("../shared/serverFactory");
const ibkrLoginDesktopService = require("./modules/main");

/**
 * ibkr-login-desktop REST Server
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

const buildCredentialsRouter = require("./routes/credentials");

const { app, getService, logger } = createMicroserviceServer({
  ServiceClass: ibkrLoginDesktopService,
  microservice: "ibkr-login-desktop",
  moduleName: "RESTServer",
  moduleVersion: "1.0.0",
  defaultPort: 3009,

  routes: [
    { path: "/credentials", router: buildCredentialsRouter, protected: true },
  ]
});

// Additional custom middleware or routes can be added here
// Example:
// app.get('/custom', (req, res) => {
//   const service = getService();
//   res.json({ custom: 'data' });
// });
