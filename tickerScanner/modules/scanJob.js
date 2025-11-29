// modules/scanJobs.js
"use strict";

const jobs = new Map();

function buildFundamentalsRecord(scored, momentumJson = null) {
  if (!scored || !scored.scores) {
    return {
      symbol: scored?.symbol ?? null,
      sector: scored?.sector ?? null,
      industry: scored?.industry ?? null,
    };
  }

  const scores    = scored.scores || {};
  const valuation = scores.valuation || {};
  const quality   = scores.quality   || {};
  const risk      = scores.risk      || {};
  const momentum  = scores.momentum  || {};

  const v = valuation.components || {};
  const q = quality.components   || {};
  const r = risk.components      || {};


  return {
    symbol:   scored.symbol,
    sector:   scored.sector ?? null,
    industry: scored.industry ?? null,
    country:  scored.country ?? null,

    // ---- Scores aggregati ----
    valuation_score: valuation.score ?? null,
    quality_score:   quality.score ?? null,
    risk_score:      risk.score ?? null,
    momentum_score:  momentum.score ?? null,
    total_score:     scores.totalScore ?? null,

    // ---- Valuation ----
    pe:         v.pe ?? null,
    pb:         v.pb ?? null,
    dcf_upside: v.dcfUpside ?? null,

    pe_score:    v.peScore ?? null,
    pb_score:    v.pbScore ?? null,
    dcf_score:   v.dcfScore ?? null,
    rating_score: v.ratingScore ?? null, // per ora quasi sempre null

    // ---- Quality ----
    roe:       q.roe ?? null,
    roa:       q.roa ?? null,
    op_margin: q.opMargin ?? null,
    piotroski: q.piotroski ?? null,

    roe_score:       q.roeScore ?? null,
    roa_score:       q.roaScore ?? null,
    op_margin_score: q.opMarginScore ?? null,
    piot_score:      q.piotScore ?? null,   // nome colonna in tabella

    // ---- Risk ----
    beta:        r.beta ?? null,
    debt_equity: r.debtEq ?? null,
    altman_z:    r.altmanZ ?? null,

    beta_score:        r.betaScore ?? null,
    debt_equity_score: r.debtEqScore ?? null,
    altman_z_score:    r.altmanScore ?? null,

    // ---- Momentum JSON (dettaglio completo) ----
    momentum_json: momentumJson ? JSON.stringify(momentumJson) : null,
  };
}


function createScanJob(totalRaw) {
  const id = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const job = {
    id,
    status: "queued", // queued | running | completed | error
    totalRawTickers: totalRaw,
    totalProcessed: 0,
    dbHits: 0,
    newCalculated: 0,
    error: null,
    createdAt: now,
    updatedAt: now,
  };

  jobs.set(id, job);
  return job;
}

function updateScanJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  return job;
}

function getScanJob(id) {
  return jobs.get(id) || null;
}

function getAllJobs() {
  return Array.from(jobs.values());
}

function getActiveJobs() {
  return Array.from(jobs.values()).filter(j =>
    j.status === "queued" || j.status === "running"
  );
}

module.exports = {
  createScanJob,
  updateScanJob,
  getScanJob,
  getAllJobs,
  getActiveJobs,
  buildFundamentalsRecord
};
