"use strict";

const { createMicroserviceServer } = require("../shared/serverFactory");
const MarketSimulator = require("./modules/main");

const createSessionRouter         = require("./routes/session");
const createSubscriptionsRouter   = require("./routes/subscriptions");
const createCandleRouter          = require("./routes/candle");
const createSimRouter             = require("./routes/sim");
const createBrokerRouter          = require("./routes/broker");
const createCandleLibraryRouter   = require("./routes/candleLibrary");
const { createFlagAnalysisRouter } = require("./routes/flagAnalysis");
const createFullRunRouter          = require("./routes/fullRun");

createMicroserviceServer({
  ServiceClass:  MarketSimulator,
  microservice:  "simulator",
  moduleName:    "RESTServer",
  moduleVersion: "1.0.0",
  defaultPort:   3010,

  routes: [
    // --- Existing routes (passive/inject mode) ---
    { path: "/session",       router: createSessionRouter,       protected: true },
    { path: "/subscriptions", router: createSubscriptionsRouter, protected: true },
    { path: "/candle",        router: createCandleRouter,        protected: true },

    // --- Custom candle file library (must be BEFORE /sim to avoid prefix conflict) ---
    // GET /sim/library, POST /sim/library/upload, DELETE /sim/library/:id
    { path: "/sim/library",   router: createCandleLibraryRouter, protected: true },

    // --- Sim control plane (sync mode) ---
    // POST /sim/start, POST /sim/tick, POST /sim/stop
    // GET  /sim/status, GET /sim/results/:runId
    { path: "/sim",           router: createSimRouter,           protected: true },

    // --- Flag pattern analysis (rolling-window backtest su dati storici) ---
    // POST /flag-analysis/run, GET /flag-analysis/runs, GET /flag-analysis/events
    { path: "/flag-analysis",  router: createFlagAnalysisRouter,  protected: true },

    // --- Full multi-day simulation (must be BEFORE /sim to avoid prefix conflict) ---
    // POST /sim/fullrun/start, GET /sim/fullrun/status, POST /sim/fullrun/stop
    { path: "/sim/fullrun",    router: createFullRunRouter,        protected: true },

    // --- Broker emulator (replaces broker-executor-ibkr in sim mode) ---
    // Mounted at "/" because BROKER_EXECUTOR_IBKR_URL=http://sim-engine:3010
    // DE calls: POST /order, GET /orders, GET /positions, etc.
    { path: "/",              router: createBrokerRouter,        protected: true },
  ],
});
