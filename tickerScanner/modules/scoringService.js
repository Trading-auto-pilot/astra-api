// modules/scoringService.js
"use strict";

class ScoringService {
  constructor({ logger }) {
    this.logger = logger;
  }

  // -------- helpers --------
  clamp01(x) {
    if (Number.isNaN(x) || x == null) return 0;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  toNumberOrNull(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }

  scoreFromRange(value, { min, max, invert }) {
    if (value == null || !Number.isFinite(value)) return null;
    if (min === max) return 50;
    let t = (value - min) / (max - min); // 0..1
    if (invert) t = 1 - t;
    t = this.clamp01(t);
    return t * 100;
  }

  averageNonNull(arr) {
    const vals = arr.filter((v) => v != null && Number.isFinite(v));
    if (!vals.length) return null;
    const sum = vals.reduce((a, b) => a + b, 0);
    return sum / vals.length;
  }

  // -------- valuation --------
  computeValuationScore(fmpData) {
    const ratios = fmpData.ratios || {};
    const pe = this.toNumberOrNull(ratios.priceEarningsRatio);
    const pb = this.toNumberOrNull(ratios.priceToBookRatio);
    const dcfUpside = fmpData.dcfUpside;

    // usa le funzioni a gradini
    const peScore = pe != null ? this.scorePE(pe) : null;
    const pbScore = pb != null ? this.scorePB(pb) : null;

    const dcfScore =
      dcfUpside != null
        ? this.scoreFromRange(dcfUpside, {
            min: -0.2,
            max: 0.5,
            invert: false,
          })
        : null;

    // rating opzionale, per ora null
    const ratingScore = null;

    const score = this.averageNonNull([peScore, pbScore, dcfScore, ratingScore]);

    return {
      score,
      components: {
        pe,
        pb,
        dcfUpside,
        peScore,
        pbScore,
        dcfScore,
        ratingScore,
      },
    };
  }

  // -------- quality --------
  computeQualityScore(fmpData) {
    const ratios = fmpData.ratios || {};
    const scores = fmpData.scores || {};

    const roe = this.toNumberOrNull(ratios.returnOnEquity);
    const roa = this.toNumberOrNull(ratios.returnOnAssets);
    const opMargin = this.toNumberOrNull(ratios.operatingProfitMargin);
    const piotroski = this.toNumberOrNull(scores.piotroskiScore);

    // usa i gradini che hai definito
    const roeScore = roe != null ? this.scoreROE(roe) : null;
    const roaScore = roa != null ? this.scoreROA(roa) : null;
    const opMarginScore = opMargin != null ? this.scoreOpMargin(opMargin) : null;

    const piotScore =
      piotroski != null
        ? this.scoreFromRange(piotroski, { min: 0, max: 9, invert: false })
        : null;

    const score = this.averageNonNull([
      roeScore,
      roaScore,
      opMarginScore,
      piotScore,
    ]);

    return {
      score,
      components: {
        roe,
        roa,
        opMargin,
        piotroski,
        roeScore,
        roaScore,
        opMarginScore,
        piotScore,
      },
    };
  }

  // -------- risk --------
  computeRiskScore(fmpData) {
    const ratios = fmpData.ratios || {};
    const scores = fmpData.scores || {};
    const profile = fmpData.profile || {};

    const beta = this.toNumberOrNull(profile.beta);
    const debtEq = this.toNumberOrNull(ratios.debtEquityRatio);
    const altmanZ = this.toNumberOrNull(scores.altmanZScore);

    let betaScore = null;
    if (beta != null) {
      const dist = Math.abs(beta - 1); // distanza da beta=1
      const raw = 1 - dist / 1.5; // dist 0 → 1; dist>=1.5 → <=0
      betaScore = this.clamp01(raw) * 100;
    }

    // usa la funzione a gradini per il DE
    const debtEqScore = debtEq != null ? this.scoreDebtEquity(debtEq) : null;

    const altmanScore =
      altmanZ != null
        ? this.scoreFromRange(altmanZ, { min: 1, max: 3, invert: false })
        : null;

    const score = this.averageNonNull([betaScore, debtEqScore, altmanScore]);

    return {
      score,
      components: {
        beta,
        debtEq,
        altmanZ,
        betaScore,
        debtEqScore,
        altmanScore,
      },
    };
  }

  // -------- funzioni di scoring "a gradini" --------
  scorePE(pe) {
    if (pe == null || pe <= 0) return null;
    if (pe < 10) return 90;
    if (pe < 15) return 100;
    if (pe < 25) return 80;
    if (pe < 40) return 60;
    if (pe < 60) return 40;
    if (pe < 80) return 20;
    return 0;
  }

  scorePB(pb) {
    if (pb == null || pb <= 0) return null;
    if (pb < 1) return 100;
    if (pb < 2) return 90;
    if (pb < 3) return 80;
    if (pb < 5) return 60;
    if (pb < 8) return 40;
    return 20;
  }

  scoreROE(roe) {
    if (roe == null) return null;
    if (roe < 0) return 0;
    if (roe < 0.05) return 20;
    if (roe < 0.1) return 40;
    if (roe < 0.15) return 60;
    if (roe < 0.2) return 80;
    return 100;
  }

  scoreROA(roa) {
    if (roa == null) return null;
    if (roa < 0) return 0;
    if (roa < 0.02) return 20;
    if (roa < 0.05) return 40;
    if (roa < 0.08) return 60;
    if (roa < 0.12) return 80;
    return 100;
  }

  scoreOpMargin(margin) {
    if (margin == null) return null;
    if (margin < 0) return 0;
    if (margin < 0.05) return 20;
    if (margin < 0.1) return 40;
    if (margin < 0.2) return 60;
    if (margin < 0.3) return 80;
    return 100;
  }

  scoreDebtEquity(de) {
    if (de == null || de < 0) return null;
    if (de < 0.2) return 100;
    if (de < 0.5) return 90;
    if (de < 1.0) return 80;
    if (de < 1.5) return 60;
    if (de < 2.0) return 40;
    return 20;
  }

  // opzionale, se vuoi ricavarti un quality aggregato solo da questi
  buildQualityScore({
    peScore,
    pbScore,
    roeScore,
    roaScore,
    opMarginScore,
    debtEquityScore,
  }) {
    const comps = [
      peScore,
      pbScore,
      roeScore,
      roaScore,
      opMarginScore,
      debtEquityScore,
    ].filter((v) => v != null);

    if (!comps.length) return null;

    const avg = comps.reduce((a, v) => a + v, 0) / comps.length;
    return Math.round(avg);
  }

  // -------- total --------
  aggregateScores({ valuationScore, qualityScore, riskScore, momentumScore }) {
    const w = { valuation: 0.3, quality: 0.4, risk: 0.2, momentum: 0.1 };
    const pieces = [];

    if (valuationScore != null)
      pieces.push({ score: valuationScore, w: w.valuation });
    if (qualityScore != null)
      pieces.push({ score: qualityScore, w: w.quality });
    if (riskScore != null) pieces.push({ score: riskScore, w: w.risk });
    if (momentumScore != null)
      pieces.push({ score: momentumScore, w: w.momentum });

    if (!pieces.length) return null;

    const wsum = pieces.reduce((a, p) => a + p.w, 0);
    if (!wsum) return null;

    const total = pieces.reduce((a, p) => a + p.score * p.w, 0) / wsum;
    return total;
  }

  /**
   * Calcola tutti gli score per UN ticker.
   * momentumScore per ora opzionale (null → solo fondamentali).
   */
  scoreSymbol(fmpData, { momentumScore = null } = {}) {
    const valuation = this.computeValuationScore(fmpData);
    const quality = this.computeQualityScore(fmpData);
    const risk = this.computeRiskScore(fmpData);

    const totalScore = this.aggregateScores({
      valuationScore: valuation.score,
      qualityScore: quality.score,
      riskScore: risk.score,
      momentumScore,
    });

    // 🔥 record piatto da mandare al DB
    const flat = {
      // valuation
      pe: valuation.components.pe,
      pe_score: valuation.components.peScore,
      pb: valuation.components.pb,
      pb_score: valuation.components.pbScore,
      dcf_upside: valuation.components.dcfUpside,
      dcf_score: valuation.components.dcfScore,

      // quality
      roe: quality.components.roe,
      roe_score: quality.components.roeScore,
      roa: quality.components.roa,
      roa_score: quality.components.roaScore,
      op_margin: quality.components.opMargin,
      op_margin_score: quality.components.opMarginScore,
      piotroski: quality.components.piotroski,
      piotroski_score: quality.components.piotScore,

      // risk
      beta: risk.components.beta,
      beta_score: risk.components.betaScore,
      debt_equity: risk.components.debtEq,
      debt_equity_score: risk.components.debtEqScore,
      altman_z: risk.components.altmanZ,
      altman_z_score: risk.components.altmanScore,

      // aggregati
      valuation_score: valuation.score,
      quality_score: quality.score,
      risk_score: risk.score,
      momentum_score: momentumScore,
      total_score: totalScore,
    };

    return {
      symbol: fmpData.symbol,
      sector: fmpData.profile?.sector || null,
      industry: fmpData.profile?.industry || null,
      country: fmpData.profile?.country || null,
      flat,
      scores: {
        valuation,
        quality,
        risk,
        momentum: {
          score: momentumScore,
        },
        totalScore,
      },
    };
  }
}

module.exports = ScoringService;
