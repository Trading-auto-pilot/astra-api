"use strict";

// ---------------------------------------------------------------------------
// modules/main.js — MarketSimulator business logic
//
// Extends BaseService for Redis, logger, settings, and service URLs.
// Business logic delegates to lib/ modules to keep this file lean.
// ---------------------------------------------------------------------------

const BaseService = require("../../shared/BaseService");
const { createCandleFetcher } = require("../lib/candleFetcher");
const { publishSnapshot } = require("../lib/snapshotPublisher");
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
} = require("../lib/sessionState");

class MarketSimulator extends BaseService {
  constructor() {
    super({
      microservice: "market-simulator",
      moduleName: "main",
      moduleVersion: "1.0.0",
    });
    this._fetcher = null;
    this._injectTimer = null;
    // Must match decision-engine subscription channel exactly.
    this.marketDataChannel = `${this.env}.market-data-service.data`;
  }

  async _onInit() {
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
        const candle = await this._fetcher.getCandle(ticker, date, tf, dataSource, dataSourceConfig, this.bus);
        if (candle) {
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

    // Advance the clock after publishing
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
  // Pending candle (Mode 1) — store override candle for next GET /candle request
  // -------------------------------------------------------------------------

  setPendingCandle(symbol, candle) {
    setPendingCandle(symbol, candle);
  }

  // -------------------------------------------------------------------------
  // Candle helpers
  // -------------------------------------------------------------------------

  async fetchCandle({ symbol, date, tf, dataSource }) {
    // Mode 1: serve pending candle override if set, then clear it
    const sym = String(symbol).toUpperCase();
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
