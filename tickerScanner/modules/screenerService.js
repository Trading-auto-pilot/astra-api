// modules/screenerService.js
"use strict";

/**
 * ScreenerService
 *
 * - legge FMP_API_KEY e TICKSCANNER_SCREENER_FILTERS dai settings (DBManager)
 * - costruisce la query per /stable/company-screener
 * - chiama l'API FMP usando fetch (Node 20)
 */
class ScreenerService {
  /**
   * @param {object} deps
   * @param {object} deps.logger      logger condiviso
   * @param {function} deps.getSetting funzione getSetting(key)
   */
  constructor({ logger, getSetting }) {
    this.logger = logger;
    this.getSetting = getSetting;
    this.baseUrl =
      process.env.FMP_BASE_URL ||
      "https://financialmodelingprep.com"; // base FMP
  }

  /**
   * Legge da DB:
   *  - FMP_API_KEY
   *  - TICKSCANNER_SCREENER_FILTERS (JSON con i parametri FMP)
   *
   * Esegue la chiamata a:
   *   GET /stable/company-screener
   *
   * Restituisce:
   *  { url, params, count, data }
   */
  async runScreener() {
    const apiKey = this.getSetting("FMP_API_KEY");
    if (!apiKey) {
      throw new Error("FMP_API_KEY setting is missing");
    }

    let filtersRaw = this.getSetting("TICKSCANNER_SCREENER_FILTERS");
    let params = {};

    if (filtersRaw) {
      try {
        params = JSON.parse(filtersRaw);
      } catch (e) {
        this.logger.error(
          `[ScreenerService] Invalid JSON in TICKSCANNER_SCREENER_FILTERS: ${e.message}`
        );
        throw new Error("Invalid JSON in TICKSCANNER_SCREENER_FILTERS");
      }
    }

    // aggiungiamo la API KEY ai parametri
    params.apikey = apiKey;

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (
        value === undefined ||
        value === null ||
        value === "" ||
        Number.isNaN(value)
      ) {
        continue;
      }
      searchParams.append(key, String(value));
    }

    const url = `${this.baseUrl}/stable/company-screener?${searchParams.toString()}`;

    this.logger.info(
      `[ScreenerService] Calling FMP Screener: ${url}`
    );

    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      this.logger.error(
        `[ScreenerService] FMP error: HTTP ${res.status} - ${text}`
      );
      throw new Error(`FMP screener failed with status ${res.status}`);
    }

    const data = await res.json();

    const count = Array.isArray(data) ? data.length : null;

    return {
      url,
      params,
      count,
      data,
    };
  }
}

module.exports = ScreenerService;
