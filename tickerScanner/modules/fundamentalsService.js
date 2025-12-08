"use strict";

const axios = require("axios");

class FundamentalsService {
  /**
   * @param {object} deps
   * @param {object} deps.logger
   * @param {string} deps.dbmanagerUrl - es "http://dbmanager:3000/api/v1"
   */
  constructor({ logger, dbmanagerUrl }) {
    if (!dbmanagerUrl) {
      throw new Error("FundamentalsService: dbmanagerUrl is required");
    }

    this.logger = logger;
    this.baseUrl = dbmanagerUrl.replace(/\/+$/, "");
  }

  // Helper generico
  async _get(path) {
    const url = `${this.baseUrl}${path}`;

    this.logger.trace("FundamentalsService GET", { url });

    try {
      const response = await axios.get(url, {
        timeout: 8000,
      });

      return response.data;
    } catch (err) {
      const msg = err?.response?.data || err?.message;
      this.logger.error("FundamentalsService GET error", { url, error: msg });
      throw new Error(msg);
    }
  }

  // 🔹 Legge tutti i fundamentals
  async getAll() {
    return this._get("/fundamentals");
  }

  // 🔹 Legge un singolo symbol
  async getOne(symbol) {
    if (!symbol) throw new Error("symbol required");

    const s = symbol.toUpperCase();
    return this._get(`/fundamentals/${s}`);
  }
}

module.exports = FundamentalsService;
