"use strict";

const { createMicroserviceServer } = require("../shared/serverFactory");
const MarketSimulator = require("./modules/main");

const createSessionRouter       = require("./routes/session");
const createSubscriptionsRouter = require("./routes/subscriptions");
const createCandleRouter        = require("./routes/candle");

createMicroserviceServer({
  ServiceClass:  MarketSimulator,
  microservice:  "market-simulator",
  moduleName:    "RESTServer",
  moduleVersion: "1.0.0",
  defaultPort:   3010,

  routes: [
    { path: "/session",       router: createSessionRouter,       protected: true },
    { path: "/subscriptions", router: createSubscriptionsRouter, protected: true },
    { path: "/candle",        router: createCandleRouter,        protected: true },
  ],
});
