"use strict";

// ---------------------------------------------------------------------------
// modules/main.js — MarketSimulator business logic
//
// Extends BaseService for Redis, logger, settings, and service URLs.
// Business logic delegates to lib/ modules to keep this file lean.
// ---------------------------------------------------------------------------

const BaseService = require("../../shared/BaseService");
const { getConfigString } = require("../../shared/loadSettings");
const { createCandleFetcher } = require("../lib/candleFetcher");
const { publishSnapshot } = require("../lib/snapshotPublisher");
const simClock = require("../../shared/simClock");
const {
  state,
  configure,
  advance,
  stop,
  addTickers,
  removeTicker,
  clearTickers,
  getSnapshot,
  setPendingCandle,
  getPendingCandle,
  clearPendingCandle,
  markServedPassive,
  shouldAdvancePassive,
} = require("../lib/sessionState");

class MarketSimulator extends BaseService {
  constructor() {
    super({
      microservice: "simulator",
      moduleName: "main",
      moduleVersion: "1.0.0",
    });
    this._fetcher = null;
    this._injectTimer = null;
    this._applyResolvedConfig();
  }

  _applyResolvedConfig() {
    // Re-resolve config through shared settings helpers so simulator supports:
    // settings table -> process.env -> hardcoded fallback.
    this.dbmanagerUrl = getConfigString(["DATAHUB_URL", "DBMANAGER_URL"], "http://datahub:3000");
    this.marketsimulatorUrl = getConfigString(["MARKETSIMULATOR_URL", "SIMULATOR_URL"], "http://marketsimulator:3003");
    this.ordersimulatorUrl = getConfigString("ORDERSIMULATOR_URL", "http://ordersimulator:3004");
    this.orderlistnerUrl = getConfigString("ORDERLISTNER_URL", "http://orderlistner:3005");
    this.cachemanagerUrl = getConfigString("CACHEMANAGER_URL", "http://cachemanager:3006");
    this.strategyUtilsUrl = getConfigString("STRATEGYUTILS_URL", "http://strategyUtils:3007");
    this.alertingserviceUrl = getConfigString(["ALERTINGSERVICE_URL", "ALERTINGMANAGER_URL"], "http://alertingservice:3008");
    this.capitalmanagerUrl = getConfigString(["CAPITALMANAGER_URL", "CAPITAL_MANAGER_URL"], "http://capitalmanager:3009");
    this.smaUrl = getConfigString("SMA_URL", "http://sma:3010");
    this.sltpUrl = getConfigString("SLTP_URL", "http://sltp:3011");
    this.livemarketlistnerUrl = getConfigString("LIVEMARKETLISTNER_URL", "http://livemarketlistner:3012");
    this.tickerscannerUrl = getConfigString(["TICKERSCANNER_URL", "TICKERSCANNER"], "http://tickerscanner:3013");
    this.schedulerUrl = getConfigString("SCHEDULER_URL", "http://scheduler:3014");
    this.authServiceUrl = getConfigString("AUTHSERVICE_URL", "http://authService:3015");
    this.servicecontrolplaneUrl = getConfigString(["SERVICECONTROLPLANE_URL", "SERVICE_CONTROL_PLANE_URL"], "http://servicecontrolplane:3016");
    this.ibkrbridgeUrl = getConfigString(["IBKRBRIDGE_URL", "IBKR_BRIDGE_URL"], "http://ibkr-bridge:3017");
    this.decisionengineUrl = getConfigString(["DECISIONENGINE_URL", "DECISION_ENGINE_URL"], "http://decision-engine:3018");
    this.liquidityManagerUrl = getConfigString(["LIQUIDITYMANAGER_URL", "LIQUIDITY_MANAGER_URL"], "http://liquidity-manager:3001");
    this.ibkrkeepaliveUrl = getConfigString("IBKRKEEPALIVE_URL", "http://ibkr-keepalive:3019");
    this.marketdataserviceUrl = getConfigString("MARKETDATASERVICE_URL", "http://market-data-service:3020");
    this.mcpGatewayUrl = getConfigString(["MCPGATEWAY_URL", "MCP_GATEWAY_URL"], "http://mcp-gateway:3004");
    this.env = getConfigString(["ENV", "APP_ENV"], this.env || "DEV");

    // Must match decision-engine subscription channel exactly.
    this.marketDataChannel = `${this.env}.market-data-service.data`;
  }

  async _onInit() {
    this._applyResolvedConfig();
    this._fetcher = createCandleFetcher({ cachemanagerUrl: this.cachemanagerUrl });
    this.logger.info(
      `[_onInit] ready — channel=${this.marketDataChannel} cachemanager=${this.cachemanagerUrl}`
    );
  }

  async _onShutdown() {
    this._stopInjectLoop();
    stop();
    this.logger.info("[_onShutdown] session stopped");
  }

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  configureSession({ startDate, endDate, tf, dataSource, dataSourceConfig, mode, intervalMs }) {
    this._stopInjectLoop();
    configure({ startDate, endDate, tf, dataSource, dataSourceConfig, mode, intervalMs });
    this.logger.info(
      `[session] configured startDate=${startDate} endDate=${endDate} tf=${tf || "1Day"} source=${dataSource || "cachemanager"} mode=${mode || "passive"}`
    );
  }

  getSession() {
    return getSnapshot();
  }

  stopSession() {
    this._stopInjectLoop();
    stop();
    this._fetcher?.clearCache?.();
  }

  // -------------------------------------------------------------------------
  // Inject loop — Mode 2: auto-tick at intervalMs cadence
  // -------------------------------------------------------------------------

  startInjectLoop() {
    if (this._injectTimer) {
      this.logger.warning("[inject] loop already running — ignoring startInjectLoop");
      return;
    }
    const intervalMs = state.intervalMs || 1000;
    this.logger.info(
      `[inject] starting loop every ${intervalMs}ms channel=${this.marketDataChannel}`
    );
    this._injectTimer = setInterval(async () => {
      if (!state.active) {
        this._stopInjectLoop();
        return;
      }
      try {
        const result = await this.tick();
        if (!result.hasMore) {
          this.logger.info("[inject] reached end of session — stopping loop");
          this._stopInjectLoop();
        }
      } catch (err) {
        this.logger.warning(`[inject] tick error: ${err?.message}`);
        this._stopInjectLoop();
      }
    }, intervalMs);
  }

  _stopInjectLoop() {
    if (this._injectTimer) {
      clearInterval(this._injectTimer);
      this._injectTimer = null;
      this.logger.info("[inject] loop stopped");
    }
  }

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  addSubscriptions(tickers) {
    addTickers(tickers);
  }

  getSubscriptions() {
    return Array.from(state.tickers);
  }

  removeSubscription(symbol) {
    removeTicker(symbol);
  }

  clearSubscriptions() {
    clearTickers();
  }

  // -------------------------------------------------------------------------
  // Tick — advance clock and publish snapshots for all subscribed tickers
  // Used by: inject loop (auto-timer) and POST /session/tick (manual step)
  // -------------------------------------------------------------------------

  async tick() {
    if (!state.active) throw new Error("No active session — POST /session first");
    if (!state.tickers.size) {
      this.logger.warning("[tick] no tickers subscribed — waiting for subscriptions");
      return {
        publishedDate: state.currentDate,
        nextDate: state.currentDate,
        hasMore: true,
        tickCount: state.tickCount,
        channel: this.marketDataChannel,
        results: [],
        waitingForSubscriptions: true,
      };
    }

    const date = state.currentDate;
    const { tf, dataSource, dataSourceConfig } = state;

    const results = [];
    for (const ticker of state.tickers) {
      try {
        // Prefer preloaded cache (inject mode with preloaded series);
        // fall back to live cachemanager fetch (passive / on-demand).
        let candle = this._fetcher?.getCached?.(ticker, date, tf);
        if (!candle) {
          candle = await this._fetcher.getCandle(ticker, date, tf, dataSource, dataSourceConfig, this.bus);
        }

        if (candle) {
          // Inject virtual time before publishing so DE business logic runs at candle timestamp
          const candleTs = candle.t ? new Date(candle.t).getTime() : new Date(date).getTime();
          try { simClock.inject(candleTs); } catch (_) { /* non-fatal */ }

          await publishSnapshot(this.bus, this.marketDataChannel, ticker, candle);
          results.push({ ticker, ok: true, close: candle.c, date: candle.t });
          this.logger.info(
            `[tick] ${ticker} date=${date} close=${candle.c} channel=${this.marketDataChannel}`
          );
        } else {
          results.push({ ticker, ok: false, error: "candle not found" });
          this.logger.warning(`[tick] no candle for ${ticker} at ${date}`);
        }
      } catch (err) {
        results.push({ ticker, ok: false, error: err?.message });
        this.logger.warning(
          `[tick] error ${ticker}: ${err?.message} (cache miss or provider unavailable)`
        );
      }
    }

    // Advance the clock after publishing all tickers
    const hasMore = advance();

    return {
      publishedDate: date,
      nextDate: state.currentDate,
      hasMore,
      tickCount: state.tickCount,
      channel: this.marketDataChannel,
      results,
    };
  }

  // -------------------------------------------------------------------------
  // Preload — fetch and cache candle series for inject mode
  // -------------------------------------------------------------------------

  async preloadTickers({ tickers, startDate, endDate, tf }) {
    const preloaded = {};
    await Promise.all(
      tickers.map(async (sym) => {
        const count = await this._fetcher.preload(sym, startDate, endDate, tf || "1Day");
        preloaded[sym] = count;
        this.logger.info(`[inject] preloaded ${sym} count=${count}`);
      })
    );
    return preloaded;
  }

  // -------------------------------------------------------------------------
  // Pending candle (Mode 1) — store override candle for next GET /candle request
  // -------------------------------------------------------------------------

  setPendingCandle(symbol, candle) {
    setPendingCandle(symbol, candle);
  }

  // -------------------------------------------------------------------------
  // Candle helpers
  // -------------------------------------------------------------------------

  async fetchCandle({ symbol, date, tf, dataSource }) {
    const sym = String(symbol).toUpperCase();

    // Passive mode: serve from preloaded cache (if available) or cachemanager at currentDate.
    // SimClock is injected immediately so DE business logic runs at virtual time.
    // Auto-advance when all subscribed tickers have been served.
    if (state.mode === "passive" && state.active) {
      const effectiveTf = tf || state.tf || "1Day";
      const effectiveDate = state.currentDate;

      // Prefer preloaded cache (populated if /sim/start was called before passive use)
      let candle = this._fetcher?.getCached?.(sym, effectiveDate, effectiveTf);

      // Fallback to live cachemanager fetch
      if (!candle) {
        candle = await this._fetcher.getCandle(
          sym, effectiveDate, effectiveTf,
          dataSource || state.dataSource,
          state.dataSourceConfig,
          this.bus
        );
      }

      if (candle) {
        // Inject virtual time so DE sees the candle's timestamp
        const candleTs = candle.t ? new Date(candle.t).getTime() : new Date(effectiveDate).getTime();
        try { simClock.inject(candleTs); } catch (_) { /* non-fatal */ }

        // Track served tickers — advance when all subscribed tickers done
        if (state.tickers.has(sym)) {
          markServedPassive(sym);
          if (shouldAdvancePassive()) {
            const advanced = advance();
            this.logger.info(
              `[passive] all tickers served at ${effectiveDate} — advanced clock hasMore=${advanced}`
            );
          }
        }
      }

      return candle;
    }

    // Pending candle override (inject mode / manual testing)
    const pending = getPendingCandle(sym);
    if (pending) {
      clearPendingCandle(sym);
      this.logger.info(`[candle] serving pending override for ${sym}`);
      return pending;
    }

    return this._fetcher.getCandle(
      symbol, date, tf || "1Day",
      dataSource || state.dataSource,
      state.dataSourceConfig,
      this.bus
    );
  }

  async fetchRange({ symbol, startDate, endDate, tf }) {
    return this._fetcher.getRange(symbol, startDate, endDate, tf || "1Day");
  }

  // Push an arbitrary candle as a snapshot (for custom scenario injection)
  async pushCustomCandle(symbol, candle) {
    return publishSnapshot(this.bus, this.marketDataChannel, symbol, candle);
  }
}

module.exports = MarketSimulator;
