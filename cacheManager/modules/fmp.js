// modules/fmp.js
"use strict";

const axios = require("axios");

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
   * Converte TF interno in timeFrame FMP
   * 1Day -> 1day, 1Hour -> 1hour, ecc.
   */
  mapTfToFmp(tf) {
    if (!tf) return "1day";
    const low = tf.toLowerCase();
    // es: "1Day" -> "1day"
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
   */
  async fetchDailyBars({ symbol, start, end, timeframe = "1Day", periodLength = 10 }) {
    const tf = this.mapTfToFmp(timeframe);

    // Intraday: usa historical-chart/<tf>/<symbol>
    if (this.isIntraday(tf)) {
      // Nota: FMP accetta il simbolo come query string (non nel path)
      const url = `${this.baseUrl}/historical-chart/${tf}`;
      const params = {
        symbol,
        ...(start ? { from: start } : {}),
        ...(end ? { to: end } : {}),
        apikey: this.apiKey,
      };

      this.logger.log(`[FMP] GET historical-chart (${symbol}) ${url}?${new URLSearchParams(params).toString()}`);

      const res = await axios.get(url, { params });
      const rows = Array.isArray(res.data) ? res.data : [];

      return rows
        .map((row) => ({
          t: row.date, // "2025-11-20 10:00:00"
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

    // Daily/weekly: endpoint SMA (daily)
    const url = `${this.baseUrl}/technical-indicators/sma`;
    const params = {
      symbol,
      periodLength,
      timeframe: tf,
      from: this.toDateOnly(start),
      to: this.toDateOnly(end),
      apikey: this.apiKey,
    };

    this.logger.log(
      `[FMP] GET SMA(${symbol}) ${url}?${new URLSearchParams(params).toString()}`
    );

    const res = await axios.get(url, { params });

    const rows = Array.isArray(res.data)
      ? res.data
      : Array.isArray(res.data?.historical)
        ? res.data.historical
        : [];

    return rows.map((row) => ({
      t: row.date,       // "2025-02-04 00:00:00"
      o: row.open,
      h: row.high,
      l: row.low,
      c: row.close,
      v: row.volume,
      tf: timeframe,
      symbol,
      sma: row.sma,     // lasciata con lo stesso nome
    }));
  }
}

module.exports = { FmpProvider };
