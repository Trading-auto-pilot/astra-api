// modules/momentumCalculator.js
"use strict";

/**
 * Assumiamo che cacheManager /candles risponda con un array di candele tipo:
 * [
 *   { t: "2025-01-01T00:00:00Z", o:..., h:..., l:..., c: 123.45, v: ... },
 *   ...
 * ]
 */

class MomentumCalculator {
  constructor({ logger, cachemanagerUrl, tf = "1Day", lookbackDays = 365 }) {
    this.logger = logger;
    this.cachemanagerUrl = cachemanagerUrl;
    this.tf = tf;
    this.lookbackDays = lookbackDays;
  }

  _toISODate(d) {
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  _subDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() - days);
    return d;
  }

  _pctChange(from, to) {
    if (from == null || to == null || from === 0) return null;
    return (to - from) / from;
  }

  _sma(lastCloses, period) {
    if (!Array.isArray(lastCloses) || lastCloses.length < period) return null;
    const slice = lastCloses.slice(-period);
    const sum = slice.reduce((acc, v) => acc + v, 0);
    return sum / slice.length;
  }

  _scoreFromReturn(ret) {
    if (ret == null) return null;
    if (ret <= 0) return 0;
    if (ret >= 0.20) return 100;
    if (ret >= 0.10) return 75;
    if (ret >= 0.05) return 50;
    if (ret > 0) return 25;
    return 0;
  }

  async _fetchCandles(symbol) {
    const now = new Date();
    const startDate = this._toISODate(this._subDays(now, this.lookbackDays));
    const endDate = this._toISODate(now);

    const url = `${this.cachemanagerUrl}/candles`;

    this.logger.log(
      `[momentum] Fetch candles ${symbol} ${startDate} → ${endDate} tf=${this.tf} via ${url}`
    );

    // Build querystring
    const qs = new URLSearchParams({
        symbol,
        startDate,
        endDate,
        tf: this.tf
    }).toString();

    const finalUrl = `${url}?${qs}`;

    this.logger.log(
        `[momentum] Fetch candles ${symbol} ${startDate} → ${endDate} tf=${this.tf} via ${finalUrl}`
    );

    const res = await fetch(finalUrl, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
    });


    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `cacheManager /candles ${symbol} failed: ${res.status} - ${text}`
      );
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error(`cacheManager /candles ${symbol} invalid payload`);
    }

    // ordiniamo per timestamp crescente
    data.sort((a, b) => new Date(a.t) - new Date(b.t));
    return data;
  }

  async calculateForSymbol(symbol) {
    try {
      const candles = await this._fetchCandles(symbol);
      if (!candles.length) {
        this.logger.warn(`[momentum] Nessuna candela per ${symbol}`);
        return { score: null, components: { reason: "no_candles" } };
      }

      const closes = candles.map(c => (c.c != null ? Number(c.c) : null));
      const lastClose = closes[closes.length - 1];

      // indici approssimativi per giorni di borsa (1/3/6/12 mesi)
      const idx = {
        "1m": closes.length - 21,
        "3m": closes.length - 63,
        "6m": closes.length - 126,
        "12m": closes.length - 252,
      };

      const mom1m =
        idx["1m"] >= 0 ? this._pctChange(closes[idx["1m"]], lastClose) : null;
      const mom3m =
        idx["3m"] >= 0 ? this._pctChange(closes[idx["3m"]], lastClose) : null;
      const mom6m =
        idx["6m"] >= 0 ? this._pctChange(closes[idx["6m"]], lastClose) : null;
      const mom12m =
        idx["12m"] >= 0 ? this._pctChange(closes[idx["12m"]], lastClose) : null;

      const mom1mScore = this._scoreFromReturn(mom1m);
      const mom3mScore = this._scoreFromReturn(mom3m);
      const mom6mScore = this._scoreFromReturn(mom6m);
      const mom12mScore = this._scoreFromReturn(mom12m);

      const sma10 = this._sma(closes, 10);
      const sma20 = this._sma(closes, 20);
      const sma50 = this._sma(closes, 50);
      const sma200 = this._sma(closes, 200);

      // Trend score grezzo
      let trendScore = 0;
      if (sma50 != null && sma200 != null && sma50 > sma200) trendScore += 40;
      if (sma10 != null && sma20 != null && sma10 > sma20) trendScore += 20;
      if (lastClose != null && sma50 != null && lastClose > sma50)
        trendScore += 20;
      if (lastClose != null && sma200 != null && lastClose > sma200)
        trendScore += 20;
      if (trendScore > 100) trendScore = 100;

      // momentum score finale (0–100)
      const componentsForScore = [
        { score: mom12mScore, weight: 0.4 },
        { score: mom6mScore,  weight: 0.25 },
        { score: mom3mScore,  weight: 0.2 },
        { score: mom1mScore,  weight: 0.05 },
        { score: trendScore,  weight: 0.1 },
      ];

      let num = 0;
      let denom = 0;

      for (const c of componentsForScore) {
        if (c.score != null) {
          num += c.score * c.weight;
          denom += c.weight;
        }
      }

      const weightedScore = denom > 0 ? num / denom : null;
      const finalScore = weightedScore != null
        ? Math.round(weightedScore * 100) / 100
        : null;

      //const finalScore = Math.round(weightedScore * 100) / 100;

      return {
        score: finalScore,
        components: {
          lastClose,
          mom1m,
          mom3m,
          mom6m,
          mom12m,
          mom1mScore,
          mom3mScore,
          mom6mScore,
          mom12mScore,
          sma10,
          sma20,
          sma50,
          sma200,
          trendScore,
        },
      };
    } catch (e) {
      this.logger.error(
        `[momentum] Errore calcolo momentum ${symbol}: ${e.message}`
      );
      return { score: null, components: { error: e.message } };
    }
  }
}

module.exports = MomentumCalculator;
