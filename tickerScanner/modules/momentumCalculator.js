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

  _smaSlope(lastCloses, period, lookback = 5) {
    if (!Array.isArray(lastCloses)) return null;
    if (lastCloses.length < period + lookback) return null;

    const current = this._sma(lastCloses, period);
    const past = this._sma(lastCloses.slice(0, -lookback), period);

    if (current == null || past == null) return null;
    return current - past;
  }

  _scoreDistanceFromHigh(distance) {
    if (distance == null || Number.isNaN(distance)) return null;
    if (distance <= 0) return 0;           // già sui massimi
    if (distance < 0.02) return 30;        // troppo vicino
    if (distance < 0.05) return 60;
    if (distance < 0.15) return 100;       // sweet spot: ancora spazio ma non troppo lontano
    if (distance < 0.30) return 70;
    if (distance < 0.50) return 40;
    return 10;                             // troppo distante dai massimi
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

  _calculateDoubleTopPotential({ closes, lastClose, sma10, sma20, sma50, sma200 }) {
    const numericCloses = (closes || []).filter((v) => Number.isFinite(v));
    if (!numericCloses.length || lastClose == null) {
      return { score: null, components: { reason: "not_enough_data" } };
    }

    const highestClose = Math.max(...numericCloses);
    const distanceFromHigh =
      highestClose > 0 ? (highestClose - lastClose) / highestClose : null;
    const distanceScore = this._scoreDistanceFromHigh(distanceFromHigh);

    const slopes = {
      sma10: this._smaSlope(numericCloses, 10, 5),
      sma20: this._smaSlope(numericCloses, 20, 5),
      sma50: this._smaSlope(numericCloses, 50, 7),
      sma200: this._smaSlope(numericCloses, 200, 15),
    };

    let maStructureScore = 0;
    if (sma10 != null && sma20 != null && sma10 > sma20) maStructureScore += 15;
    if (sma20 != null && sma50 != null && sma20 > sma50) maStructureScore += 15;
    if (lastClose != null && sma10 != null && lastClose > sma10) maStructureScore += 10;
    if (lastClose != null && sma20 != null && lastClose > sma20) maStructureScore += 5;
    if (slopes.sma10 != null && slopes.sma10 > 0) maStructureScore += 15;
    if (slopes.sma20 != null && slopes.sma20 > 0) maStructureScore += 15;
    if (slopes.sma50 != null && slopes.sma50 > 0) maStructureScore += 10;
    if (slopes.sma200 != null && slopes.sma200 < 0) maStructureScore += 15; // lungo periodo ancora in downtrend
    if (maStructureScore > 100) maStructureScore = 100;

    let longTermPressureScore = null;
    if (sma50 != null && sma200 != null && sma200 !== 0) {
      const spread = (sma50 - sma200) / Math.abs(sma200);
      if (spread < -0.1) longTermPressureScore = 100;      // molto sotto la lunga → spazio di recupero
      else if (spread < 0) longTermPressureScore = 80;
      else if (spread < 0.05) longTermPressureScore = 50;
      else longTermPressureScore = 25;
    }

    const pieces = [
      { score: distanceScore, weight: 0.45 },
      { score: maStructureScore, weight: 0.35 },
      { score: longTermPressureScore, weight: 0.20 },
    ];

    let num = 0;
    let den = 0;
    for (const p of pieces) {
      if (p.score != null) {
        num += p.score * p.weight;
        den += p.weight;
      }
    }

    const weighted = den > 0 ? num / den : null;
    const finalScore = weighted != null
      ? Math.round(weighted * 100) / 100
      : null;

    return {
      score: finalScore,
      components: {
        highestClose,
        distanceFromHigh,
        distanceScore,
        maStructureScore,
        longTermPressureScore,
        slopes,
      },
    };
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

      // setup tipo double top / retest dei massimi
      const doubleTop = this._calculateDoubleTopPotential({
        closes,
        lastClose,
        sma10,
        sma20,
        sma50,
        sma200,
      });

      //const finalScore = Math.round(weightedScore * 100) / 100;

      return {
        score: finalScore,
        doubleTopScore: doubleTop?.score ?? null,
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
          doubleTop,
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
