// server.js
"use strict";

const { createMicroserviceServer } = require("../shared/serverFactory");
const capitalManagerService = require("./modules/main");
const buildAllocationRouter = require("./routes.allocation");

const { app, getService, logger } = createMicroserviceServer({
  ServiceClass: capitalManagerService,
  microservice: "capital-manager",
  moduleName: "RESTServer",
  moduleVersion: "1.0.0",
  defaultPort: 3010,

  routes: [
    {
      path: "/allocation",
      router: buildAllocationRouter, // factory fn — serverFactory calls it with { logger, getService }
      protected: true,
    },
  ],
});
