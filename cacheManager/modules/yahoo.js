// modules/yahoo.js
"use strict";

const axios = require("axios");

// Stesso mapping di fmp.js — Yahoo usa suffissi identici a FMP (dot notation).
const YAHOO_EXCHANGE_SUFFIX = {
  // Europe
  LSE: ".L",
  LON: ".L",
  XETRA: ".DE",
  FRA: ".DE",
  EPA: ".PA",
  SBF: ".PA",       // Euronext Paris (vecchia denominazione)
  EURONEXT: ".PA",
  AMS: ".AS",
  MIL: ".MI",
  MCE: ".MC",
  BME: ".MC",
  VIE: ".VI",
  STO: ".ST",
  HEL: ".HE",
  CPH: ".CO",
  OSL: ".OL",
  BRU: ".BR",
  LIS: ".LS",
  WAR: ".WA",
  ATH: ".AT",
  // Americas
  TSX: ".TO",
  TSXV: ".V",
  SAO: ".SA",
  // Asia-Pacific
  HKEX: ".HK",
  TSE: ".T",
  OSE: ".T",
  ASX: ".AX",
  SGX: ".SI",
  NSE: ".NS",
  BSE: ".BO",
  KRX: ".KS",
  TWSE: ".TW",
  // Other
  JSE: ".JO",
  TADAWUL: ".SR",
  TASE: ".TA",
  NZX: ".NZ",
};

const US_EXCHANGES = new Set([
  "NYSE", "NASDAQ", "ARCA", "BATS", "IEX", "CBOE", "AMEX",
  "EDGX", "EDGA", "MEMX", "LTSE", "MIAX", "BOX", "PHLX",
]);

class YahooProvider {
  /**
   * @param {object} opts
   * @param {object} opts.logger
   * @param {number} [opts.timeout]  ms (default 12000)
   */
  constructor({ logger, timeout = 12000 }) {
    this.logger = logger;
    this.timeout = timeout;
    this.baseUrl = "https://query1.finance.yahoo.com/v8/finance/chart";
  }

  /**
   * Trasforma il simbolo aggiungendo il suffisso Yahoo per mercati non-US.
   * Stessa logica di FmpProvider.resolveSymbol.
   */
  resolveSymbol(symbol, exchange) {
    if (!exchange) return symbol;
    const ex = String(exchange).toUpperCase().trim();
    if (US_EXCHANGES.has(ex)) return symbol;
    const suffix = YAHOO_EXCHANGE_SUFFIX[ex];
    if (!suffix) {
      this.logger?.warning?.(
        `[Yahoo] Exchange "${ex}" non mappato in YAHOO_EXCHANGE_SUFFIX — uso simbolo as-is: ${symbol}`
      );
      return symbol;
    }
    // Evita doppio suffisso se il simbolo lo ha già (es. "BNP.PA" + SBF)
    if (symbol.includes(".")) return symbol;
    return `${symbol}${suffix}`;
  }

  /**
   * Mappa il timeframe interno all'interval Yahoo.
   * Daily/weekly/monthly usano "1d"/"1wk"/"1mo".
   * Intraday: minuti → "Nm", ore → "Nh" (Yahoo supporta 1m,2m,5m,15m,30m,60m,90m,1h).
   */
  mapInterval(timeframe) {
    const tf = String(timeframe || "1Day").toLowerCase().trim();
    if (tf === "1day"  || tf === "1d")  return "1d";
    if (tf === "1week" || tf === "1wk" || tf === "1w") return "1wk";
    if (tf === "1month"|| tf === "1mo") return "1mo";
    if (tf.includes("min")) {
      const n = parseInt(tf, 10) || 1;
      return `${n}m`;
    }
    if (tf.includes("hour") || tf.includes("hr") || /^\d+h$/.test(tf)) {
      const n = parseInt(tf, 10) || 1;
      return `${n}h`;
    }
    return "1d";
  }

  /**
   * Recupera barre OHLCV da Yahoo Finance (v8/finance/chart).
   * Non richiede API key.
   *
   * @param {object} params
   * @param {string} params.symbol     Es. "BNP"
   * @param {string} [params.exchange] Es. "SBF" → risolto in "BNP.PA"
   * @param {string} params.start      ISO 8601
   * @param {string} params.end        ISO 8601
   * @param {string} [params.timeframe] Es. "1Day"
   * @returns {Promise<Array>}
   */
  async fetchDailyBars({ symbol, exchange, start, end, timeframe = "1Day" }) {
    const yahooSymbol = this.resolveSymbol(symbol, exchange);
    const interval    = this.mapInterval(timeframe);
    const period1     = Math.floor(new Date(start).getTime() / 1000);
    const period2     = Math.floor(new Date(end).getTime() / 1000);

    const url = `${this.baseUrl}/${encodeURIComponent(yahooSymbol)}`;
    const params = { interval, period1, period2, includePrePost: false };

    this.logger.trace?.(
      `[Yahoo] → GET ${url}?${new URLSearchParams(
        Object.entries(params).map(([k, v]) => [k, String(v)])
      ).toString()}`
    );

    const res = await axios.get(url, {
      params,
      timeout: this.timeout,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; trading-system/1.0)",
        Accept: "application/json",
      },
    });

    const result = res.data?.chart?.result?.[0];
    if (!result) {
      const errMsg = res.data?.chart?.error?.description || "Risposta vuota da Yahoo Finance";
      throw new Error(`[Yahoo] ${errMsg}`);
    }

    const timestamps = result.timestamp || [];
    const quote      = result.indicators?.quote?.[0] || {};
    const { open = [], high = [], low = [], close = [], volume = [] } = quote;

    const bars = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = close[i];
      if (!timestamps[i] || c == null || !Number.isFinite(c)) continue;
      bars.push({
        t: new Date(timestamps[i] * 1000).toISOString(),
        o: open[i],
        h: high[i],
        l: low[i],
        c,
        v: volume[i],
        tf: timeframe,
        symbol,
      });
    }

    return bars;
  }
}

module.exports = { YahooProvider };
