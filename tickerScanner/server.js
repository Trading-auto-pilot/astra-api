"use strict";

const { createMicroserviceServer } = require("../shared/serverFactory");
const TickerScanner = require("./modules/main");
const { buildInternalUserScoresRouter } = require("./routes/userScores");
const { buildInternalUniverseRouter } = require("./routes/universe");

createMicroserviceServer({
  ServiceClass: TickerScanner,
  microservice: "tickerScanner",
  moduleName: "RESTServer",
  moduleVersion: "1.0.0",
  defaultPort: 3013,
  routes: [
    // Universe routes (Phase 1): /universe, /universe/:symbol, /universe/scan, /universe/scan/*
    { path: "/universe",     router: require("./routes/universe"),   protected: true },
    // Scanner routes: /screener, /scan, /scan/*, /momentum/refresh, /glossary/:fileName
    { path: "/",             router: require("./routes/scanner"),    protected: true },
    // Fundamentals data routes: /ticker-scan-jobs, /scores-daily/*, /history
    { path: "/fundamentals", router: require("./routes/tickerData"), protected: true },
    // Market daily job routes: /update-market-daily, /market-daily/compare, /market-daily-jobs
    { path: "/fundamentals", router: require("./routes/marketDaily"), protected: true },
    // User daily score job routes: /user-daily-scores, /user-daily-score-jobs, /jobs
    { path: "/fundamentals", router: require("./routes/userScores"),  protected: true },
    // Ranking snapshot routes: /ranking/daily
    { path: "/fundamentals", router: require("./routes/rankingRoutes"), protected: true },
    // User data routes (LAST — contains /:symbol catch-all): /user-order, /user-filters,
    // /users/pipes, /user-fundamentals-view, /user/score-weights, /recalculate-user, /, /:symbol, /lastCandel
    { path: "/fundamentals", router: require("./routes/userData"),    protected: true },
    // Internal endpoint: POST /internal/fundamentals/user-daily-scores (auth via x-internal-token)
    { path: "/internal/fundamentals", router: buildInternalUserScoresRouter, protected: false },
    // Internal endpoint: POST /internal/universe/scan (auth via x-internal-token)
    { path: "/internal/universe", router: buildInternalUniverseRouter, protected: false },
  ],
});
