// modules/fmp.js
"use strict";

const axios = require("axios");

// Mapping exchange code → FMP symbol suffix for non-US markets.
// US exchanges (NYSE, NASDAQ, ARCA, …) need no suffix — symbol is used as-is.
const FMP_EXCHANGE_SUFFIX = {
  // Europe
  LSE: ".L",
  LON: ".L",
  XETRA: ".DE",
  FRA: ".DE",
  EPA: ".PA",
  EURONEXT: ".PA",
  SBF: ".PA",      // Société des Bourses Françaises (Euronext Paris)
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

// US exchange codes: no suffix needed, FMP uses the raw ticker.
const US_EXCHANGES = new Set([
  "NYSE", "NASDAQ", "ARCA", "BATS", "IEX", "CBOE", "AMEX",
  "EDGX", "EDGA", "MEMX", "LTSE", "MIAX", "BOX", "PHLX",
]);

class FmpProvider {
  /**
   * @param {Object} opts
   * @param {string} opts.apiKey  -> FMP_API_KEY
   * @param {Object} opts.logger
   */
  constructor({ apiKey, logger }) {
    this.apiKey = apiKey;
    this.logger = logger;
    this.baseUrl = "https://financialmodelingprep.com/stable";
  }

  /**
   * Trasforma il simbolo aggiungendo il suffisso FMP per mercati non-US.
   * Es: ("EZJ", "LSE") → "EZJ.L"
   *     ("AAPL", "NASDAQ") → "AAPL"
   *     ("EZJ", undefined) → "EZJ" (nessun contesto, usa as-is)
   */
  resolveSymbol(symbol, exchange) {
    if (!exchange) return symbol;
    const ex = String(exchange).toUpperCase().trim();
    if (US_EXCHANGES.has(ex)) return symbol;
    const suffix = FMP_EXCHANGE_SUFFIX[ex];
    if (!suffix) {
      this.logger?.warning?.(
        `[FMP] Exchange "${ex}" non mappato in FMP_EXCHANGE_SUFFIX — uso simbolo as-is: ${symbol}`
      );
      return symbol;
    }
    // Evita doppio suffisso se il simbolo lo ha già (es. "EZJ.L" + LSE)
    if (symbol.includes(".")) return symbol;
    return `${symbol}${suffix}`;
  }

  /**
   * Converte TF interno in timeFrame FMP
   * 1Day -> 1day, 1Hour -> 1hour, ecc.
   */
  mapTfToFmp(tf) {
    if (!tf) return "1day";
    const low = tf.toLowerCase();
    return low.replace("day", "day").replace("hour", "hour");
  }

  isIntraday(tf) {
    const low = (tf || "").toLowerCase();
    return low.includes("min") || low.includes("hour");
  }

  toDateOnly(value) {
    if (!value) return value;
    return String(value).split("T")[0];
  }

  /**
   * Recupera barre da FMP.
   * Per tf intraday usa historical-chart, per daily/weekly usa SMA endpoint.
   * @param {string} [params.exchange]  Exchange opzionale — trasforma il simbolo se non-US
   */
  async fetchDailyBars({ symbol, exchange, start, end, timeframe = "1Day" }) {
    const fmpSymbol = this.resolveSymbol(symbol, exchange);
    const tf = this.mapTfToFmp(timeframe);

    // Intraday: usa historical-chart/<tf>/<symbol>
    if (this.isIntraday(tf)) {
      const url = `${this.baseUrl}/historical-chart/${tf}`;
      const params = {
        symbol: fmpSymbol,
        ...(start ? { from: start } : {}),
        ...(end ? { to: end } : {}),
        apikey: this.apiKey,
      };

      const safeParams = { ...params, apikey: params.apikey ? "***" : "(missing)" };
      this.logger.trace?.(`[FMP] → GET ${url}?${new URLSearchParams(safeParams).toString()}`);

      const res = await axios.get(url, { params });
      const rows = Array.isArray(res.data) ? res.data : [];

      return rows
        .map((row) => ({
          t: row.date,
          o: row.open,
          h: row.high,
          l: row.low,
          c: row.close,
          v: row.volume,
          tf: timeframe,
          symbol,
        }))
        .filter((r) => r.t);
    }

    // Daily/weekly: endpoint historical-price-eod/full (no premium required)
    const url = `${this.baseUrl}/historical-price-eod/full`;
    const params = {
      symbol: fmpSymbol,
      ...(start ? { from: this.toDateOnly(start) } : {}),
      ...(end   ? { to:   this.toDateOnly(end)   } : {}),
      apikey: this.apiKey,
    };

    const safeParams = { ...params, apikey: params.apikey ? "***" : "(missing)" };
    this.logger.trace?.(`[FMP] → GET ${url}?${new URLSearchParams(safeParams).toString()}`);

    const res = await axios.get(url, { params });

    const rows = Array.isArray(res.data?.historical)
      ? res.data.historical
      : Array.isArray(res.data)
        ? res.data
        : [];

    return rows.map((row) => ({
      t: row.date,
      o: row.open,
      h: row.high,
      l: row.low,
      c: row.close,
      v: row.volume,
      tf: timeframe,
      symbol,
    }));
  }
}

module.exports = { FmpProvider };
