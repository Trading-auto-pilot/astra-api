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
    this.marketIndexSymbol = process.env.MARKET_INDEX_SYMBOL || "SPY";
    this.riskOnSymbols = (process.env.MARKET_RISK_ON || "HYG,IWM").split(",").map((s) => s.trim()).filter(Boolean);
    this.riskOffSymbols = (process.env.MARKET_RISK_OFF || "TLT,LQD").split(",").map((s) => s.trim()).filter(Boolean);
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

  _clamp(value, min, max) {
    if (value == null || Number.isNaN(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  _rsi(closes, period = 14) {
    if (!Array.isArray(closes) || closes.length < period + 1) return null;
    let gains = 0;
    let losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (!Number.isFinite(diff)) return null;
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }

  _atr(candles, period = 14) {
    if (!Array.isArray(candles) || candles.length < period + 1) return null;
    const trs = [];
    for (let i = candles.length - period; i < candles.length; i++) {
      const prevClose = candles[i - 1]?.c;
      const high = candles[i]?.h;
      const low = candles[i]?.l;
      if (![prevClose, high, low].every(Number.isFinite)) return null;
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trs.push(tr);
    }
    if (!trs.length) return null;
    return trs.reduce((sum, v) => sum + v, 0) / trs.length;
  }

  // ATR normalizzato: ATR / lastClose * 100  (%)
  // Esprime la volatilità come percentuale del prezzo → confrontabile tra simboli
  // Restituisce null se ATR o lastClose non sono disponibili.
  _atrPct(candles, period = 14) {
    const atr = this._atr(candles, period);
    if (atr == null) return null;
    const lastClose = candles[candles.length - 1]?.c;
    if (!Number.isFinite(lastClose) || lastClose === 0) return null;
    return (atr / lastClose) * 100;
  }

  /**
   * Computes all persisted technical indicator columns from a candles array.
   * Uses only indicator functions already implemented in this class.
   *
   * @param {Array}  candles - Raw candle objects { t, o, h, l, c, v }
   * @param {object} [opts]
   * @param {string} [opts.symbol] - Symbol name, used only for log messages
   * @returns {{ ret_1d, ret_5d, ret_20d, ret_60d, sma_10, sma_20, sma_50, sma_200,
   *             sma_20_slope, sma_50_slope, atr_14, atr_14_pct, rsi_14,
   *             avg_gap_20, max_dd_60, dollar_vol_20d }}
   *   Each field is a number or null (insufficient history / missing OHLCV).
   */
  computeTechnicals(candles, { symbol = "?" } = {}) {
    const nullResult = {
      ret_1d: null, ret_5d: null, ret_20d: null, ret_60d: null,
      sma_10: null, sma_20: null, sma_50: null, sma_200: null,
      sma_20_slope: null, sma_50_slope: null,
      atr_14: null, atr_14_pct: null,
      rsi_14: null, avg_gap_20: null, max_dd_60: null,
      dollar_vol_20d: null,
    };

    if (!Array.isArray(candles) || !candles.length) return nullResult;

    // Sort ascending — _fetchCandles already sorts, but be defensive
    const sorted = [...candles].sort((a, b) => new Date(a.t) - new Date(b.t));

    // Build filtered closes (null/NaN excluded so SMA/RSI helpers work safely)
    const closes = sorted
      .map(c => (c.c != null ? Number(c.c) : null))
      .filter(v => Number.isFinite(v));

    const n = closes.length;
    if (n < 2) return nullResult; // nothing meaningful possible

    const lastClose = closes[n - 1];

    // Log insufficient history once per symbol
    if (n < 200) {
      this.logger.warning(
        `[computeTechnicals] ${symbol}: only ${n} bars — ${n < 61 ? "ret_60d, sma_50/200" : "sma_200"} will be null`,
      );
    }

    // ---- returns ----
    const ret_1d  = n >= 2  ? this._pctChange(closes[n - 2],  closes[n - 1]) : null;
    const ret_5d  = n >= 6  ? this._pctChange(closes[n - 6],  closes[n - 1]) : null;
    const ret_20d = n >= 21 ? this._pctChange(closes[n - 21], closes[n - 1]) : null;
    const ret_60d = n >= 61 ? this._pctChange(closes[n - 61], closes[n - 1]) : null;

    // ---- SMA ----
    const sma_10  = this._sma(closes, 10);
    const sma_20  = this._sma(closes, 20);
    const sma_50  = this._sma(closes, 50);
    const sma_200 = this._sma(closes, 200);

    // SMA slopes: lookback=5 matches the value used in calculateForSymbol
    const sma_20_slope = this._smaSlope(closes, 20, 5);
    const sma_50_slope = this._smaSlope(closes, 50, 5);

    // ---- ATR (needs full OHLC candle objects) ----
    const atr_14     = this._atr(sorted, 14);
    const atr_14_pct = atr_14 != null && lastClose ? atr_14 / lastClose : null;

    // ---- RSI ----
    const rsi_14 = this._rsi(closes, 14);

    // ---- Avg overnight gap (needs open + prevClose) ----
    const avg_gap_20 = this._avgGap(sorted, 20);

    // ---- Max drawdown over 60 bars ----
    const max_dd_60 = this._maxDrawdown(closes, 60);

    // ---- Dollar volume 20d: avg(close × volume) over last 20 bars ----
    const last20 = sorted.slice(-20);
    const dollarVols = [];
    for (const c of last20) {
      const close = c.c != null ? Number(c.c) : null;
      const vol   = c.v != null ? Number(c.v) : null;
      if (Number.isFinite(close) && Number.isFinite(vol)) dollarVols.push(close * vol);
    }
    const dollar_vol_20d = dollarVols.length
      ? dollarVols.reduce((a, b) => a + b, 0) / dollarVols.length
      : null;

    return {
      ret_1d, ret_5d, ret_20d, ret_60d,
      sma_10, sma_20, sma_50, sma_200,
      sma_20_slope, sma_50_slope,
      atr_14, atr_14_pct,
      rsi_14, avg_gap_20, max_dd_60,
      dollar_vol_20d,
    };
  }

  _maxDrawdown(closes, lookback = 60) {
    if (!Array.isArray(closes) || closes.length < 2) return null;
    const slice = closes.slice(-lookback).filter((v) => Number.isFinite(v));
    if (slice.length < 2) return null;
    let peak = slice[0];
    let maxDd = 0;
    for (const c of slice) {
      if (c > peak) peak = c;
      const dd = peak > 0 ? (peak - c) / peak : 0;
      if (dd > maxDd) maxDd = dd;
    }
    return maxDd;
  }

  _avgGap(candles, lookback = 20) {
    if (!Array.isArray(candles) || candles.length < 2) return null;
    const slice = candles.slice(-lookback);
    const gaps = [];
    for (let i = 1; i < slice.length; i++) {
      const prevClose = slice[i - 1]?.c;
      const open = slice[i]?.o;
      if (Number.isFinite(prevClose) && Number.isFinite(open) && prevClose !== 0) {
        gaps.push(Math.abs(open - prevClose) / Math.abs(prevClose));
      }
    }
    if (!gaps.length) return null;
    return gaps.reduce((a, b) => a + b, 0) / gaps.length;
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

  async _fetchCloses(symbol, lookback = 60) {
    const now = new Date();
    const startDate = this._toISODate(this._subDays(now, lookback));
    const endDate = this._toISODate(now);
    const url = `${this.cachemanagerUrl}/candles`;
    const qs = new URLSearchParams({
      symbol,
      startDate,
      endDate,
      tf: this.tf,
    }).toString();
    const finalUrl = `${url}?${qs}`;
    const res = await fetch(finalUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`cacheManager /candles ${symbol} failed: ${res.status} - ${text}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error(`cacheManager /candles ${symbol} invalid payload`);
    }
    data.sort((a, b) => new Date(a.t) - new Date(b.t));
    const closes = data.map((c) => (c.c != null ? Number(c.c) : null)).filter((v) => Number.isFinite(v));
    return closes;
  }

  _returns(closes) {
    const out = [];
    for (let i = 1; i < closes.length; i++) {
      const prev = closes[i - 1];
      const curr = closes[i];
      if (Number.isFinite(prev) && Number.isFinite(curr) && prev !== 0) {
        out.push((curr - prev) / prev);
      }
    }
    return out;
  }

  _std(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
  }

  _correlation(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 2) return null;
    const aTrim = a.slice(-n);
    const bTrim = b.slice(-n);
    const meanA = aTrim.reduce((s, v) => s + v, 0) / n;
    const meanB = bTrim.reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let denA = 0;
    let denB = 0;
    for (let i = 0; i < n; i++) {
      const da = aTrim[i] - meanA;
      const db = bTrim[i] - meanB;
      num += da * db;
      denA += da * da;
      denB += db * db;
    }
    const den = Math.sqrt(denA * denB);
    if (den === 0) return null;
    return num / den;
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
        this.logger.warning(`[momentum] Nessuna candela per ${symbol}`);
        return { score: null, _candles: [], components: { reason: "no_candles" } };
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
      const rsi14 = this._rsi(closes, 14);
      const atr14 = this._atr(candles, 14);
      const volumes = candles.map((c) => (c.v != null ? Number(c.v) : null));
      const lastVolume = volumes.length ? volumes[volumes.length - 1] : null;
      const prevClose = closes.length > 1 ? closes[closes.length - 2] : null;
      const avg = (arr) => {
        const vals = arr.filter((v) => Number.isFinite(v));
        if (!vals.length) return null;
        return vals.reduce((a, b) => a + b, 0) / vals.length;
      };
      const v20 = volumes.length >= 20 ? avg(volumes.slice(-20)) : null;
      const v5 = volumes.length >= 5 ? avg(volumes.slice(-5)) : null;

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

      // Momentum short-term (price action)
      const prevCloseShort = prevClose;
      const ret1 = prevCloseShort && lastClose ? (lastClose - prevCloseShort) / prevCloseShort : null;
      const atrNorm = atr14 && lastClose ? atr14 / lastClose : null;
      const retScore =
        ret1 != null && atrNorm && atrNorm !== 0
          ? this._clamp(ret1 / (0.5 * atrNorm), -1, 1)
          : null;

      const trendScoreShort =
        (0.5 * Math.sign((lastClose ?? 0) - (sma20 ?? lastClose ?? 0))) +
        (0.3 * Math.sign((sma20 ?? lastClose ?? 0) - (sma50 ?? sma20 ?? lastClose ?? 0))) +
        (0.2 * Math.sign((lastClose ?? 0) - (sma50 ?? lastClose ?? 0)));
      const trendScoreNorm = this._clamp((trendScoreShort + 1) / 2, 0, 1);

      const last5 = candles.slice(-5);
      const hh5 = last5.length
        ? Math.max(...last5.map((c) => Number(c.c) || Number(c.h) || 0))
        : null;
      const ll5 = last5.length
        ? Math.min(...last5.map((c) => Number(c.c) || Number(c.l) || 0))
        : null;

      let structureScoreNorm = null;
      if (lastClose != null && hh5 != null && ll5 != null && hh5 !== ll5) {
        let structureScore;
        if (lastClose > hh5) structureScore = 1;
        else if (lastClose < ll5) structureScore = -1;
        else structureScore = ((lastClose - ll5) / (hh5 - ll5)) * 2 - 1;
        structureScoreNorm = this._clamp((structureScore + 1) / 2, 0, 1);
      }

      let rsiScore = null;
      if (rsi14 != null) {
        if (rsi14 < 40) rsiScore = 0;
        else if (rsi14 > 70) rsiScore = 0.3;
        else rsiScore = (rsi14 - 40) / 30;
      }

      const momentumRaw =
        (retScore != null ? 0.35 * retScore : 0) +
        (trendScoreNorm != null ? 0.30 * trendScoreNorm : 0) +
        (structureScoreNorm != null ? 0.20 * structureScoreNorm : 0) +
        (rsiScore != null ? 0.15 * rsiScore : 0);

      const momentumShortScore = Math.round(this._clamp(momentumRaw, 0, 1) * 100);

      // -------------------------
      // Volume score
      // -------------------------
      const volRatio = lastVolume && v20 ? lastVolume / v20 : null;
      const volSpikeScore =
        volRatio != null ? this._clamp((volRatio - 1) / 2, 0, 1) : null;

      const directionalVolume =
        lastClose != null &&
        prevClose != null &&
        v5 &&
        lastClose > prevClose
          ? Math.min(lastVolume / v5, 1)
          : 0;

      const priceMove =
        lastClose != null && prevClose != null
          ? Math.abs(lastClose - prevClose)
          : null;
      const efficiencyScore =
        priceMove != null && atr14
          ? this._clamp(priceMove / (atr14 * 0.5), 0, 1)
          : null;

      const lastHigh = candles.length ? candles[candles.length - 1]?.h : null;
      const lastLow = candles.length ? candles[candles.length - 1]?.l : null;
      const range =
        Number.isFinite(lastHigh) && Number.isFinite(lastLow)
          ? lastHigh - lastLow
          : null;
      const rangeRatio = range != null && atr14 ? range / atr14 : null;
      const rangeScore =
        rangeRatio != null ? this._clamp(rangeRatio / 1.5, 0, 1) : null;

      const volumeRaw =
        (volSpikeScore != null ? 0.40 * volSpikeScore : 0) +
        (directionalVolume != null ? 0.30 * directionalVolume : 0) +
        (efficiencyScore != null ? 0.20 * efficiencyScore : 0) +
        (rangeScore != null ? 0.10 * rangeScore : 0);

      const volumeScore = Math.round(this._clamp(volumeRaw, 0, 1) * 100);

      // -------------------------
      // Market risk (più alto = più sicuro)
      // -------------------------
      const volPct = atr14 && lastClose ? atr14 / lastClose : null;
      const volSafe =
        volPct != null
          ? 1 - this._clamp((volPct - 0.015) / (0.06 - 0.015), 0, 1)
          : null;

      const dd20 = this._maxDrawdown(closes, 60); // usa ultime 60 barre
      const ddSafe =
        dd20 != null
          ? 1 - this._clamp((dd20 - 0.05) / (0.25 - 0.05), 0, 1)
          : null;

      const avgGap20 = this._avgGap(candles, 20);
      const gapSafe =
        avgGap20 != null
          ? 1 - this._clamp((avgGap20 - 0.003) / (0.02 - 0.003), 0, 1)
          : null;

      let trendSafe = null;
      if (sma50 != null && sma50 !== 0 && lastClose != null) {
        const trendRaw = (lastClose - sma50) / (0.08 * sma50);
        const clamped = this._clamp(trendRaw, -1, 1);
        trendSafe = (clamped + 1) / 2;
      }

      const riskComponents = [
        { v: volSafe, w: 0.40 },
        { v: ddSafe, w: 0.30 },
        { v: gapSafe, w: 0.20 },
        { v: trendSafe, w: 0.10 },
      ];
      let rNum = 0;
      let rDen = 0;
      for (const rc of riskComponents) {
        if (rc.v != null) {
          rNum += rc.v * rc.w;
          rDen += rc.w;
        }
      }
      const marketRiskSafe = rDen > 0 ? rNum / rDen : null;
      const marketRiskScore =
        marketRiskSafe != null ? Math.round(this._clamp(marketRiskSafe, 0, 1) * 100) : null;

      // -------------------------
      // Market score (trend/regime/correlation)
      // -------------------------
      let marketScore = null;
      let corrMarket = null;
      try {
        const benchmarkCloses = await this._fetchCloses(this.marketIndexSymbol, 80);
        const benchRet = this._returns(benchmarkCloses);
        const symRet = this._returns(closes);
        corrMarket = this._correlation(symRet, benchRet);

        const benchLast = benchmarkCloses[benchmarkCloses.length - 1];
        const benchFirst = benchmarkCloses[Math.max(0, benchmarkCloses.length - 10)];
        const trendRet = benchFirst && benchLast ? (benchLast - benchFirst) / benchFirst : null;
        const benchVol = this._std(benchRet.slice(-20));
        const strength = benchVol ? trendRet / benchVol : null;
        const trendScore = strength != null ? this._clamp((strength - 0.05) / 0.25, 0, 1) : null;

        const fetchAvgReturn = async (symbols) => {
          const rets = [];
          for (const s of symbols) {
            try {
              const closes = await this._fetchCloses(s, 40);
              const r = this._returns(closes);
              if (r.length) rets.push(r.reduce((a, b) => a + b, 0) / r.length);
            } catch (_) {
              /* ignore */
            }
          }
          if (!rets.length) return null;
          return rets.reduce((a, b) => a + b, 0) / rets.length;
        };

        const riskOnRet = await fetchAvgReturn(this.riskOnSymbols);
        const riskOffRet = await fetchAvgReturn(this.riskOffSymbols);
        const regimeDiff = riskOnRet != null && riskOffRet != null ? riskOnRet - riskOffRet : null;
        const regimeScore = regimeDiff != null ? this._clamp((regimeDiff + 0.02) / 0.12, 0, 1) : null;

        // penalità correlazione se mercato debole
        const corrPenalty =
          corrMarket != null && corrMarket > 0.6 && trendScore != null && trendScore < 0.5
            ? this._clamp((corrMarket - 0.6) / 0.4, 0, 1) * 0.2
            : 0;

        const marketComposite =
          (trendScore != null ? 0.55 * trendScore : 0) +
          (regimeScore != null ? 0.35 * regimeScore : 0) -
          corrPenalty;
        marketScore = Math.round(this._clamp(marketComposite, 0, 1) * 100);
      } catch (err) {
        this.logger.error(`[marketScore] ${symbol} errore: ${err?.message || String(err)}`);
      }

      return {
        score: finalScore,
        _candles: candles,        // raw sorted candles — reused by computeTechnicals in the scan flow
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
          momentumShort: {
            score: momentumShortScore,
            components: {
              retScore,
              trendScoreNorm,
              structureScoreNorm,
              rsiScore,
              atr14,
              rsi14,
              ret1,
              hh5,
              ll5,
            },
          },
          volume: {
            score: volumeScore,
            components: {
              volSpikeScore,
              directionalVolume,
              efficiencyScore,
              rangeScore,
              volRatio,
              v20,
              v5,
              lastVolume,
              priceMove,
              range,
            },
          },
          marketRisk: {
            score: marketRiskScore,
            components: {
              volSafe,
              ddSafe,
              gapSafe,
              trendSafe,
              volPct,
              dd20,
              avgGap20,
            },
          },
          marketScore: {
            score: marketScore,
            components: {
              corrMarket,
              indexSymbol: this.marketIndexSymbol,
              riskOnSymbols: this.riskOnSymbols,
              riskOffSymbols: this.riskOffSymbols,
            },
          },
        },
      };
    } catch (e) {
      this.logger.error(
        `[momentum] Errore calcolo momentum ${symbol}: ${e.message}`
      );
      return { score: null, _candles: [], components: { error: e.message } };
    }
  }
}

module.exports = MomentumCalculator;
