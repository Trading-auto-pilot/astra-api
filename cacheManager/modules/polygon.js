// modules/polygon.js
"use strict";

const axios = require("axios");

class PolygonProvider {
  /**
   * @param {object} options
   * @param {string} options.apiKey        POLYGON_API_KEY
   * @param {object} options.logger
   * @param {number} [options.timeout]     Timeout ms (default 15000)
   */
  constructor({ apiKey, logger, timeout = 15000 }) {
    this.apiKey  = apiKey;
    this.logger  = logger;
    this.timeout = timeout;
    this.baseUrl = "https://api.polygon.io";
  }

  _mapTimespan(tf) {
    const v = String(tf || "1day").toLowerCase();
    if (["1min", "1m"].includes(v))    return { multiplier: 1,  timespan: "minute" };
    if (["5min", "5m"].includes(v))    return { multiplier: 5,  timespan: "minute" };
    if (["15min", "15m"].includes(v))  return { multiplier: 15, timespan: "minute" };
    if (["30min", "30m"].includes(v))  return { multiplier: 30, timespan: "minute" };
    if (["1h", "1hour"].includes(v))   return { multiplier: 1,  timespan: "hour"   };
    if (["2h", "2hour"].includes(v))   return { multiplier: 2,  timespan: "hour"   };
    if (["4h", "4hour"].includes(v))   return { multiplier: 4,  timespan: "hour"   };
    if (["1day", "1d"].includes(v))    return { multiplier: 1,  timespan: "day"    };
    if (["1week", "1w"].includes(v))   return { multiplier: 1,  timespan: "week"   };
    if (["1month", "1mo"].includes(v)) return { multiplier: 1,  timespan: "month"  };
    return { multiplier: 1, timespan: "day" }; // default
  }

  _normalizeBar(raw, symbol, tf) {
    const ts = raw?.t;
    if (!Number.isFinite(ts)) return null;
    return {
      t:      new Date(ts).toISOString(), // da ms a ISO UTC
      o:      raw.o,
      h:      raw.h,
      l:      raw.l,
      c:      raw.c,
      v:      raw.v  ?? null,
      vw:     raw.vw ?? null, // VWAP — campo bonus Polygon
      n:      raw.n  ?? null, // numero transazioni — campo bonus Polygon
      tf,
      symbol,
    };
  }

  /**
   * Clamp endDate a T-1: Polygon copre solo fino alla chiusura del giorno precedente.
   */
  _clampEndDate(endDate) {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const end = String(endDate).slice(0, 10);
    if (end > yesterdayStr) {
      this.logger.info(
        `[PolygonProvider] endDate ${end} > T-1 (${yesterdayStr}), clamp a ${yesterdayStr}`
      );
      return yesterdayStr;
    }
    return end;
  }

  async fetchDailyBars({ symbol, start, end, timeframe = "1day" }) {
    const { multiplier, timespan } = this._mapTimespan(timeframe);
    const from    = String(start).slice(0, 10);
    const to      = this._clampEndDate(end);
    const allBars = [];

    // Avviso se il range supera il limite di 2 anni di Polygon
    const twoYearsAgo = new Date();
    twoYearsAgo.setUTCFullYear(twoYearsAgo.getUTCFullYear() - 2);
    if (from < twoYearsAgo.toISOString().slice(0, 10)) {
      this.logger.warning(
        `[PolygonProvider] from=${from} è oltre il limite di 2 anni — Polygon potrebbe non avere dati così vecchi`
      );
    }

    let url =
      `${this.baseUrl}/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
      `/range/${multiplier}/${timespan}/${from}/${to}` +
      `?adjusted=true&sort=asc&limit=50000&apiKey=${this.apiKey}`;

    // Paginazione via next_url nel body della risposta
    while (url) {
      this.logger.info(
        `[PolygonProvider] Fetch ${symbol} ${from}→${to} tf=${timeframe}: ${url.replace(this.apiKey, "***")}`
      );

      let res;
      try {
        res = await axios.get(url, { timeout: this.timeout });
      } catch (err) {
        const status  = err.response?.status;
        const errBody = err.response?.data || {};
        const errMsg  = errBody?.error || errBody?.message || err.message;
        this.logger.error(
          `[PolygonProvider] Error fetching bars for ${symbol} ${from}→${to}: ` +
          `${status ? status + " " : ""}${errMsg}`
        );
        throw new Error(`[POLYGON ERROR] ${symbol} ${from}→${to}: ${errMsg}`);
      }

      const data = res.data || {};

      // Polygon ritorna status "ERROR" nel body anche con HTTP 200
      if (data.status === "ERROR" || data.status === "NOT_AUTHORIZED") {
        const errMsg = data.error || data.message || data.status;
        this.logger.error(`[PolygonProvider] API error per ${symbol}: ${errMsg}`);
        throw new Error(`[POLYGON API ERROR] ${symbol}: ${errMsg}`);
      }

      const bars = Array.isArray(data.results) ? data.results : [];
      allBars.push(...bars);

      // next_url include già tutti i parametri tranne apiKey
      url = data.next_url ? `${data.next_url}&apiKey=${this.apiKey}` : null;
    }

    const normalized = allBars
      .map((row) => this._normalizeBar(row, symbol, timeframe))
      .filter(Boolean);

    this.logger.log(
      `[PolygonProvider] Fetched ${allBars.length} raw bars ` +
      `(${normalized.length} normalized) for ${symbol} ${from}→${to}`
    );

    return normalized;
  }
}

module.exports = { PolygonProvider };
