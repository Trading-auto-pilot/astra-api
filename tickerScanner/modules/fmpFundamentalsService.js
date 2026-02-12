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

  async fetchJson(url, label, _retries = 3) {
    // ✅ tutte le chiamate passano dal rate limiter
    return this.limiter.enqueue(async () => {
      this.logger.log(`[FMP] GET ${label}: ${url}`);
      const res = await fetch(url);

      // --- 429 handling: notifica al limiter + retry con backoff ---
      if (res.status === 429) {
        this.limiter.notifyRateLimit();
        if (_retries > 0) {
          const backoffMs = 1000 * Math.pow(2, 3 - _retries); // 1s, 2s, 4s
          this.logger.warning(
            `[FMP] ${label} 429 rate-limited – retry in ${backoffMs}ms (${_retries} left)`
          );
          await new Promise((r) => setTimeout(r, backoffMs));
          return this.fetchJson(url, label, _retries - 1);
        }
        const text = await res.text().catch(() => "");
        this.logger.error(`[FMP] ${label} 429 exhausted retries | ${text}`);
        throw new Error(`${label} failed with status 429 (retries exhausted)`);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        this.logger.error(
          `[FMP] ${label} error: HTTP ${res.status} - ${text}`
        );
        throw new Error(`${label} failed with status ${res.status}`);
      }

      this.limiter.notifySuccess();
      return res.json();
    });
  }

  async fetchProfile(symbol) {
    const url = this.buildUrl("/stable/profile", { symbol });
    const data = await this.fetchJson(url, `profile(${symbol})`);
    return Array.isArray(data) && data[0] ? data[0] : null;
  }

  async fetchKeyMetrics(symbol) {
    const url = this.buildUrl("/stable/key-metrics", { symbol });
    const data = await this.fetchJson(url, `key-metrics(${symbol})`);
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

  async fetchIncomeStatement(symbol) {
    const url = this.buildUrl("/stable/income-statement", { symbol, limit: 1 });
    const data = await this.fetchJson(url, `income-statement(${symbol})`);
    return Array.isArray(data) && data[0] ? data[0] : null;
  }

  async fetchBalanceSheet(symbol) {
    const url = this.buildUrl("/stable/balance-sheet-statement", { symbol, limit: 1 });
    const data = await this.fetchJson(url, `balance-sheet(${symbol})`);
    return Array.isArray(data) && data[0] ? data[0] : null;
  }

  async fetchRatios(symbol) {
    const url = this.buildUrl("/stable/ratios", { symbol, limit: 1 });
    const data = await this.fetchJson(url, `ratios(${symbol})`);
    return Array.isArray(data) && data[0] ? data[0] : null;
  }

  async getFundamentalsForSymbol(symbol) {
    const [profile, keyMetrics, ratiosRaw, scores, dcf, incomeStatement, balanceSheet] = await Promise.all([
      this.fetchProfile(symbol),
      this.fetchKeyMetrics(symbol),
      this.fetchRatios(symbol),
      this.fetchFinancialScores(symbol),
      this.fetchDCF(symbol),
      this.fetchIncomeStatement(symbol),
      this.fetchBalanceSheet(symbol),
    ]);

    this.logger.info("[DEBUG raw keyMetrics]", { symbol, keyMetrics_raw: keyMetrics });
    this.logger.info("[DEBUG raw ratios]", { symbol, ratios_raw: ratiosRaw });
    const normalized = this.normalizeKeyMetrics(keyMetrics);
    const normalizedRatios = this.normalizeRatios(ratiosRaw);
    const mergedRatios = { ...normalized, ...normalizedRatios };
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
      ratios: mergedRatios, // naming legacy for scoringService
      keyMetrics,
      ratiosRaw,
      stableRatios: mergedRatios,
      stable: keyMetrics, // alias per i campi della stable (es. debtToEquityRatio)
      scores,
      dcf,
      dcfUpside,
      incomeStatement,
      balanceSheet,
    };
  }

  async getFundamentalsForSymbols(symbols = [], options = {}) {
    const out = [];
    if (!Array.isArray(symbols) || symbols.length === 0) return out;
    const rawConcurrency =
      options.concurrency ?? process.env.FMP_SYMBOL_CONCURRENCY ?? process.env.SCAN_FMP_CONCURRENCY;
    const limit = Number.isFinite(Number(rawConcurrency)) && Number(rawConcurrency) > 0
      ? Math.floor(Number(rawConcurrency))
      : 3;
    let idx = 0;
    const worker = async () => {
      while (idx < symbols.length) {
        const symbol = symbols[idx];
        idx += 1;
        try {
          const f = await this.getFundamentalsForSymbol(symbol);
          out.push(f);
        } catch (e) {
          this.logger.error(
            `[FMP Fundamentals] Error on ${symbol}: ${e?.message || String(e)}`
          );
        }
      }
    };
    const workers = Array.from({ length: Math.min(limit, symbols.length) }, () => worker());
    await Promise.all(workers);
    return out;
  }

  normalizeKeyMetrics(raw = {}) {
    if (!raw || typeof raw !== "object") return {};

    return {
      priceEarningsRatio: Number(raw.priceEarningsRatioTTM ?? raw.peRatio ?? raw.priceEarningsRatio) || null,
      priceToBookRatio: Number(raw.priceToBookRatioTTM ?? raw.pbRatio ?? raw.priceToBookRatio) || null,
      returnOnEquity: Number(raw.returnOnEquityTTM ?? raw.returnOnEquity) || null,
      returnOnAssets: Number(raw.returnOnAssetsTTM ?? raw.returnOnAssets) || null,
      operatingProfitMargin: Number(raw.operatingProfitMarginTTM ?? raw.operatingMargin ?? raw.operatingProfitMargin) || null,
      debtEquityRatio: Number(raw.debtToEquityRatio ?? raw.debtToEquity ?? raw.debtEquityRatioTTM ?? raw.debtEquityRatio) || null,
      date: raw.date ?? null,
    };
  }

  normalizeRatios(raw = {}) {
    if (!raw || typeof raw !== "object") return {};
    return {
      debtToEquityRatio: Number(raw.debtToEquityRatio ?? raw.debtEquityRatio ?? raw.debtToEquity) || null,
      returnOnEquity: Number(raw.returnOnEquity) || null,
      returnOnAssets: Number(raw.returnOnAssets) || null,
      operatingProfitMargin: Number(raw.operatingProfitMargin) || null,
      date: raw.date ?? null,
    };
  }

}

module.exports = FmpFundamentalsService;
