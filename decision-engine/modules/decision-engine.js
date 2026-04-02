"use strict";

/**
 * decision-engine.js  — thin router factory
 *
 * Responsibilities:
 *  1. Resolve all runtime dependencies (URLs, timeouts, bus accessor, resolveUserId)
 *  2. Create the shared deps context object passed to route builders and orchestrator
 *  3. Attach the lazy market-data handler middleware (once per service instance)
 *  4. Mount sub-routers in correct order (live before /:pipeId to avoid wildcard clash)
 *  5. Expose internal route arrays on the router object for server.js to mount
 *
 * Business logic lives in:
 *  - modules/spotFinderOrchestrator.js
 *  - modules/spotFinderAnalysis.js
 *  - routes/spotFinder.js
 *  - routes/live.js
 *  - routes/internal.js
 */

const express = require("express");
const C = require("./constants");
const { fetchUserId } = require("./helpers");
const { createMarketDataHandler } = require("./live-manager");
const { buildSpotFinderRouter } = require("../routes/spotFinder");
const { buildLiveRouter } = require("../routes/live");
const { buildInternalRouteHandlers } = require("../routes/internal");

// --- Relaxed params (query overrides for fallback when no zones found) ------
const relaxedSpotFinderParams = {
  lookbackDays: C.RELAXED_LOOKBACK_DAYS,
  minTouches: C.RELAXED_MIN_TOUCHES,
  minScore: C.RELAXED_MIN_SCORE,
  minRecentBars: C.RELAXED_RECENT_BARS,
  swingWindow: C.RELAXED_SWING_WINDOW,
  clusterMultiplier: C.RELAXED_CLUSTER_MULTIPLIER,
};

module.exports = function buildDecisionEngineRouter({ service: _service, getService, logger }) {
  // service può essere undefined se buildDecisionEngineRouter è chiamato prima che
  // serviceInstance sia inizializzato (pattern comune nei template). resolveService()
  // restituisce sempre l'istanza aggiornata grazie a getService.
  const resolveService = typeof getService === "function" ? getService : () => _service;
  const service = _service; // usato solo per le URL di init (che hanno già fallback su process.env)

  // --- URL config ------------------------------------------------------------
  const cachemanagerUrl = (
    service?.cachemanagerUrl ||
    process.env.CACHEMANAGER_URL ||
    "http://cachemanager:3006"
  ).replace(/\/+$/, "");
  const authServiceUrl =
    service?.authServiceUrl ||
    process.env.AUTHSERVICE_URL ||
    "http://authService:3015";
  const tickerscannerUrl = (
    service?.tickerscannerUrl ||
    process.env.TICKERSCANNER_URL ||
    "http://tickerscanner:3013"
  ).replace(/\/+$/, "");
  const decisionengineUrl = (
    service?.decisionengineUrl ||
    process.env.DECISIONENGINE_URL ||
    "http://decision-engine:3018"
  ).replace(/\/+$/, "");
  const serviceName = process.env.MICROSERVICE_NAME || "decision-engine";
  const envName = process.env.ENV || process.env.APP_ENV || "DEV";
  const eventsChannel =
    service?.redisEventsChannel ||
    `${envName}.${serviceName}.events`;
  const marketdataserviceUrl = (
    service?.marketdataserviceUrl ||
    process.env.MARKETDATASERVICE_URL ||
    "http://market-data-service:3020"
  ).replace(/\/+$/, "");
  const cacheManagerTimeoutMs = Number(process.env.CACHEMANAGER_TIMEOUT_MS) || C.CACHEMANAGER_TIMEOUT_MS;
  const tickerscannerTimeoutMs = Number(process.env.TICKERSCANNER_TIMEOUT_MS) || C.TICKERSCANNER_TIMEOUT_MS;

  // --- Shared dependency context --------------------------------------------
  const deps = {
    resolveService,
    bus: () => resolveService()?.bus,
    logger,
    cachemanagerUrl,
    authServiceUrl,
    tickerscannerUrl,
    decisionengineUrl,
    serviceName,
    envName,
    eventsChannel,
    marketdataserviceUrl,
    cacheManagerTimeoutMs,
    tickerscannerTimeoutMs,
    relaxedSpotFinderParams,
    resolveUserId: (req) =>
      req?._internalUserId ??
      req?.internalAuth?.userId ??
      fetchUserId(req, authServiceUrl, C.AUTH_TIMEOUT_MS, logger),
  };

  // --- Lazy market-data handler setup ---------------------------------------
  // Cannot run immediately because buildDecisionEngineRouter is called synchronously
  // before serviceInstance is fully initialised. resolveService() ensures we read
  // the updated instance at execution time.
  const ensureMarketDataHandler = (() => {
    let attached = false;
    return () => {
      if (attached) return;
      const svc = resolveService();
      if (!svc?.addMarketDataHandler || svc.__liveMarketHandlerAttached) {
        if (svc?.__liveMarketHandlerAttached) attached = true;
        return;
      }
      const hooksChannel = `${envName}.hooks`;
      const liquidityManagerUrl = (
        svc.liquidityManagerUrl ||
        process.env.LIQUIDITYMANAGER_URL ||
        "http://liquidity-manager:3001"
      ).replace(/\/+$/, "");
      const brokerExecutorUrl = (
        svc.brokerExecutorUrl ||
        process.env.BROKER_EXECUTOR_IBKR_URL ||
        process.env.BROKER_EXECUTOR_URL ||
        "http://broker-executor-ibkr:3003"
      ).replace(/\/+$/, "");
      const capitalManagerUrl = (
        (svc.capitalmanagerUrl || process.env.CAPITALMANAGER_URL || "").replace(/\/+$/, "")
      ) || null;
      const ibkrBridgeUrl = (
        svc.ibkrbridgeUrl ||
        process.env.IBKRBRIDGE_URL ||
        "http://ibkr-bridge:3017"
      ).replace(/\/+$/, "");
      const handler = createMarketDataHandler({
        bus: svc.bus,
        eventsChannel,
        hooksChannel,
        serviceName,
        envName,
        logger,
        liquidityManagerUrl,
        cachemanagerUrl,
        brokerExecutorUrl,
        capitalManagerUrl,
        ibkrBridgeUrl,
      });
      svc.addMarketDataHandler(handler);
      svc.__liveMarketHandlerAttached = true;
      attached = true;
      logger?.info?.("[decision-engine] market data handler attached (lazy init)");
    };
  })();

  // --- Build router ---------------------------------------------------------
  const router = express.Router();

  // Middleware: attach market data handler on first request
  router.use((req, res, next) => { ensureMarketDataHandler(); next(); });

  // Mount live routes BEFORE spot-finder so /live/:pipeId/* is matched first
  // (otherwise GET /:pipeId would greedily match /live/5 as pipeId="live")
  router.use(buildLiveRouter(deps));
  router.use(buildSpotFinderRouter(deps));

  // --- Internal routes (arrays for server.js mounting) ----------------------
  const internalHandlers = buildInternalRouteHandlers(deps);
  router._internalSpotFinder = internalHandlers.spotFinder;
  router._internalSpotFinderLive = internalHandlers.live;
  router._internalSpotFinderLiveStop = internalHandlers.liveStop;

  return router;
};
