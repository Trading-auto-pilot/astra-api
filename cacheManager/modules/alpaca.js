"use strict";

const axios = require("axios");

/**
 * AlpacaProvider
 * Gestisce il recupero delle candele da Alpaca Market Data (v2/stocks/bars).
 */
class AlpacaProvider {
  /**
   * @param {object} options
   * @param {string} options.restUrl   Base URL Alpaca (es. https://data.alpaca.markets)
   * @param {string} options.apiKey    APCA_API_KEY_ID
   * @param {string} options.apiSecret APCA_API_SECRET_KEY
   * @param {object} options.logger    Logger condiviso
   * @param {number} [options.timeout] Timeout richieste ms (default 10000)
   */
  constructor({ restUrl, apiKey, apiSecret, logger, timeout = 10000 }) {
    this.restUrl = restUrl || "https://data.alpaca.markets";
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.logger = logger;
    this.timeout = timeout;
  }

  buildHeaders() {
    return {
      "APCA-API-KEY-ID": this.apiKey,
      "APCA-API-SECRET-KEY": this.apiSecret,
    };
  }

  /**
   * Recupera tutte le barre daily tra start ed end (inclusi).
   * Gestisce la paginazione via next_page_token.
   *
   * @param {object} params
   * @param {string} params.symbol     Es. "NVDA"
   * @param {string} params.start      Es. "2024-01-01"
   * @param {string} params.end        Es. "2024-01-31"
   * @param {string} [params.timeframe] Es. "1Day" (default)
   * @returns {Promise<Array<object>>} Array di barre Alpaca
   */
  async fetchDailyBars({ symbol, start, end, timeframe = "1Day" }) {
    const allBars = [];
    let pageToken = "";

    const baseUrl = `${this.restUrl}/v2/stocks/bars`;

    do {
      const url =
        `${baseUrl}?symbols=${encodeURIComponent(symbol)}` +
        `&timeframe=${encodeURIComponent(timeframe)}` +
        `&start=${start}&end=${end}` +
        `&limit=5000&adjustment=raw&feed=sip&currency=USD&sort=asc` +
        (pageToken ? `&page_token=${pageToken}` : "");

      this.logger.info?.(
        `[AlpacaProvider] Fetch bars ${symbol} ${start}→${end} tf=${timeframe}` +
          (pageToken ? ` (page=${pageToken})` : "") +
          ` : ${url}`
      );

      let res;
      try {
        res = await axios.get(url, {
          headers: this.buildHeaders(),
          timeout: this.timeout,
        });
      } catch (err) {
        const status = err.response?.status;
        const data = err.response?.data;
        const msg = status
          ? `${status} - ${JSON.stringify(data)}`
          : err.message;

        this.logger.error?.(
          `[AlpacaProvider] Error fetching bars for ${symbol} ${start}→${end}: ${msg}`
        );
        throw new Error(
          `[API ERROR] Fallita richiesta per ${symbol} - range ${start}→${end}`
        );
      }

      const data = res.data || {};
      // Struttura Alpaca: { bars: { SYMBOL: [ ... ] }, next_page_token? }
      const bars = data.bars?.[symbol] || [];
      allBars.push(...bars);

      pageToken = data.next_page_token || "";
    } while (pageToken);

    this.logger.log?.(
      `[AlpacaProvider] Fetched ${allBars.length} bars for ${symbol} ${start}→${end}`
    );

    return allBars;
  }
}

/**
 * Helper per creare il provider leggendo da env (puoi adattarlo a loadSettings).
 */
function createAlpacaFromEnv(logger) {
  return new AlpacaProvider({
    restUrl: process.env.ALPACA_REST_URL || "https://data.alpaca.markets",
    apiKey: process.env.APCA_API_KEY_ID,
    apiSecret: process.env.APCA_API_SECRET_KEY,
    logger,
    timeout: parseInt(process.env.ALPACA_TIMEOUT || "10000", 10),
  });
}

module.exports = {
  AlpacaProvider,
  createAlpacaFromEnv,
  
};
