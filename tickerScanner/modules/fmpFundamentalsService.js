// modules/fmpFundamentalsService.js
"use strict";

const RateLimiter = require("./rateLimiter");

class FmpFundamentalsService {
  /**
   * @param {object} deps
   * @param {object} deps.logger
   * @param {function} deps.getSetting - funzione getSetting(key) che legge da DBManager
   */
  constructor({ logger, getSetting }) {
    this.logger = logger;
    this._getSetting = getSetting;
    this.baseUrl = process.env.FMP_BASE_URL || "https://financialmodelingprep.com";

    // ✅ cache API KEY in memoria
    this.apiKey = null;

    // ✅ rate limiter locale (5 req/sec)
    this.limiter = new RateLimiter({
      maxPerSecond: 5,
      logger: this.logger,
    });
  }

  getApiKey() {
    // lazy load: legge dai settings solo la prima volta
    if (!this.apiKey) {
      const key = this._getSetting("FMP_API_KEY");
      if (!key) {
        throw new Error("FMP_API_KEY setting is missing");
      }
      this.apiKey = key;
      this.logger.info("[FMP] FMP_API_KEY loaded from settings");
    }
    return this.apiKey;
  }

  buildUrl(path, params = {}) {
    const apiKey = this.getApiKey();
    const sp = new URLSearchParams({ ...params, apikey: apiKey });
    return `${this.baseUrl}${path}?${sp.toString()}`;
  }

  async fetchJson(url, label) {
    // ✅ tutte le chiamate passano dal rate limiter
    return this.limiter.enqueue(async () => {
      this.logger.log(`[FMP] GET ${label}: ${url}`);
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        this.logger.error(
          `[FMP] ${label} error: HTTP ${res.status} - ${text}`
        );
        throw new Error(`${label} failed with status ${res.status}`);
      }
      return res.json();
    });
  }

  async fetchProfile(symbol) {
    const url = this.buildUrl("/stable/profile", { symbol });
    const data = await this.fetchJson(url, `profile(${symbol})`);
    return Array.isArray(data) && data[0] ? data[0] : null;
  }

  async fetchRatiosTTM(symbol) {
    const url = this.buildUrl("/stable/ratios-ttm", { symbol });
    const data = await this.fetchJson(url, `ratios-ttm(${symbol})`);
    return Array.isArray(data) && data[0] ? data[0] : null;
  }

  async fetchFinancialScores(symbol) {
    const url = this.buildUrl("/stable/financial-scores", { symbol });
    const data = await this.fetchJson(url, `financial-scores(${symbol})`);
    return Array.isArray(data) && data[0] ? data[0] : null;
  }

  async fetchDCF(symbol) {
    const url = this.buildUrl("/stable/discounted-cash-flow", { symbol });
    const data = await this.fetchJson(url, `discounted-cash-flow(${symbol})`);
    return Array.isArray(data) && data[0] ? data[0] : null;
  }

  async getFundamentalsForSymbol(symbol) {
    const [profile, ratios, scores, dcf] = await Promise.all([
      this.fetchProfile(symbol),
      this.fetchRatiosTTM(symbol),
      this.fetchFinancialScores(symbol),
      this.fetchDCF(symbol),
    ]);

    this.logger.info("[DEBUG raw ratios]", { symbol, ratios_raw: ratios });
    const normalized = this.normalizeRatios(ratios);
    this.logger.info("[DEBUG normalized ratios]", { symbol, normalized });

    const price = profile?.price != null ? Number(profile.price) : null;
    const dcfValue = dcf?.dcf != null ? Number(dcf.dcf) : null;

    let dcfUpside = null;
    if (price && dcfValue) {
      dcfUpside = (dcfValue - price) / price;
    }

    return {
      symbol,
      profile,
      ratios: normalized,
      scores,
      dcf,
      dcfUpside,
    };
  }

  async getFundamentalsForSymbols(symbols = []) {
    const out = [];
    for (const symbol of symbols) {
      try {
        const f = await this.getFundamentalsForSymbol(symbol);
        out.push(f);
      } catch (e) {
        this.logger.error(
          `[FMP Fundamentals] Error on ${symbol}: ${e?.message || String(e)}`
        );
      }
    }
    return out;
  }

  normalizeRatios(raw = {}) {
    if (!raw || typeof raw !== "object") return {};

    return {
      priceEarningsRatio: Number(raw.priceEarningsRatioTTM ?? raw.priceEarningsRatio) || null,
      priceToBookRatio: Number(raw.priceToBookRatioTTM ?? raw.priceToBookRatio) || null,
      returnOnEquity: Number(raw.returnOnEquityTTM ?? raw.returnOnEquity) || null,
      returnOnAssets: Number(raw.returnOnAssetsTTM ?? raw.returnOnAssets) || null,
      operatingProfitMargin: Number(raw.operatingProfitMarginTTM ?? raw.operatingProfitMargin) || null,
      debtEquityRatio: Number(raw.debtEquityRatioTTM ?? raw.debtEquityRatio) || null,
    };
  }

}

module.exports = FmpFundamentalsService;
