// modules/allocation/concentrationLimits.js
"use strict";

const { countryToArea } = require("../utils/geoUtils");

/**
 * Compute existing exposure by ticker, sector, industry, area.
 * Includes both open positions (market value) and active BUY orders (limitPrice × qty).
 *
 * @param {Array<{symbol:string, marketValue:number}>} positions
 * @param {Record<string, {sector?:string, industry?:string, area?:string, country?:string}>} fundamentalsMap
 * @param {Array} [openOrders=[]] - Raw open orders from ibkr-bridge
 * @returns {{ ticker: Record<string,number>, sector: Record<string,number>, industry: Record<string,number>, area: Record<string,number> }}
 */
function computeExposure(positions, fundamentalsMap, openOrders = []) {
  const ticker   = {};
  const sector   = {};
  const industry = {};
  const area     = {};

  const addToMap = (sym, mv) => {
    if (!sym || mv <= 0) return;
    ticker[sym] = (ticker[sym] ?? 0) + mv;
    const fund = fundamentalsMap[sym];
    if (!fund) return;
    const sec = String(fund.sector   ?? "").trim();
    const ind = String(fund.industry ?? "").trim();
    const ar  = String(fund.area || (fund.country ? countryToArea(fund.country) : null) || "").trim();
    if (sec) sector[sec]   = (sector[sec]   ?? 0) + mv;
    if (ind) industry[ind] = (industry[ind] ?? 0) + mv;
    if (ar)  area[ar]      = (area[ar]      ?? 0) + mv;
  };

  // Open positions — by market value
  // Handles both normalized data (symbol/marketValue) and raw IBKR data (ticker/contractDesc/mktValue/mktVal)
  for (const pos of (positions || [])) {
    addToMap(
      String(pos.symbol ?? pos.ticker ?? pos.contractDesc ?? pos.localSymbol ?? "").toUpperCase(),
      Number(pos.marketValue ?? pos.mktValue ?? pos.mktVal ?? 0)
    );
  }

  // Active BUY orders — by limitPrice × quantity
  // Handles both normalized (symbol) and raw IBKR iserver orders (ticker)
  for (const ord of (openOrders || [])) {
    const action = String(ord?.action ?? ord?.side ?? "").toUpperCase();
    if (action !== "BUY") continue;
    const price = Number(ord?.lmtPrice ?? ord?.auxPrice ?? ord?.price ?? ord?.limitPrice ?? 0);
    const qty   = Number(ord?.totalQuantity ?? ord?.quantity ?? ord?.remainingQty ?? ord?.qty ?? 0);
    addToMap(String(ord.symbol ?? ord.ticker ?? "").toUpperCase(), price * qty);
  }

  return { ticker, sector, industry, area };
}

/**
 * Apply concentration limits to cap maxInvestable.
 *
 * Checks (in order): MAX_TICKER → MAX_SECTOR → MAX_INDUSTRY → MAX_AREA.
 * Each check computes: available = limit - existingExposureInThatDimension.
 * The final maxInvestable is min(current, available) for each binding constraint.
 *
 * @param {object} params
 * @param {number} params.maxInvestable          - Cash-based max (from decisionEngine)
 * @param {string} params.symbol                  - Requested symbol
 * @param {{sector?:string, industry?:string, area?:string, country?:string}|null} params.fundamentals
 * @param {{ ticker:Record<string,number>, sector:Record<string,number>, industry:Record<string,number>, area:Record<string,number> }} params.exposure
 * @param {{ MAX_TICKER?:number|null, MAX_SECTOR?:number|null, MAX_INDUSTRY?:number|null, MAX_AREA?:number|null }} params.limits
 * @returns {{ maxInvestable:number, concentrationReasons:string[], limitedBy:string|null }}
 */
function applyConcentrationLimits({ maxInvestable, symbol, fundamentals, exposure, limits }) {
  const reasons   = [];
  let   result    = maxInvestable;
  let   limitedBy = null;

  const sym  = String(symbol ?? "").toUpperCase();
  const fund = fundamentals ?? {};

  const fmt = (n) => n.toFixed(2);
  const tag  = (binding) => binding ? "⚠ BINDING" : "✓ ok";

  // 1. MAX_TICKER
  if (limits.MAX_TICKER != null && limits.MAX_TICKER > 0) {
    const existing = exposure.ticker[sym] ?? 0;
    const avail    = Math.max(0, limits.MAX_TICKER - existing);
    const binding  = avail < result;
    reasons.push(
      `MAX_TICKER[${sym}]: existing=${fmt(existing)} limit=${fmt(limits.MAX_TICKER)} avail=${fmt(avail)} ${tag(binding)}`
    );
    if (binding) { result = avail; limitedBy = "MAX_TICKER"; }
  } else {
    reasons.push(`MAX_TICKER: not configured — skipped`);
  }

  // 2. MAX_SECTOR
  const sec = String(fund.sector ?? "").trim();
  if (sec && limits.MAX_SECTOR != null && limits.MAX_SECTOR > 0) {
    const existing = exposure.sector[sec] ?? 0;
    const avail    = Math.max(0, limits.MAX_SECTOR - existing);
    const binding  = avail < result;
    reasons.push(
      `MAX_SECTOR[${sec}]: existing=${fmt(existing)} limit=${fmt(limits.MAX_SECTOR)} avail=${fmt(avail)} ${tag(binding)}`
    );
    if (binding) { result = avail; limitedBy = "MAX_SECTOR"; }
  } else {
    reasons.push(`MAX_SECTOR: ${sec ? "not configured" : "sector unknown"} — skipped`);
  }

  // 3. MAX_INDUSTRY
  const ind = String(fund.industry ?? "").trim();
  if (ind && limits.MAX_INDUSTRY != null && limits.MAX_INDUSTRY > 0) {
    const existing = exposure.industry[ind] ?? 0;
    const avail    = Math.max(0, limits.MAX_INDUSTRY - existing);
    const binding  = avail < result;
    reasons.push(
      `MAX_INDUSTRY[${ind}]: existing=${fmt(existing)} limit=${fmt(limits.MAX_INDUSTRY)} avail=${fmt(avail)} ${tag(binding)}`
    );
    if (binding) { result = avail; limitedBy = "MAX_INDUSTRY"; }
  } else {
    reasons.push(`MAX_INDUSTRY: ${ind ? "not configured" : "industry unknown"} — skipped`);
  }

  // 4. MAX_AREA
  // Normalize to macro-area key to match exposure aggregation keys.
  const ar = String(fund.area || (fund.country ? countryToArea(fund.country) : null) || "").trim();
  if (ar && limits.MAX_AREA != null && limits.MAX_AREA > 0) {
    const existing = exposure.area[ar] ?? 0;
    const avail    = Math.max(0, limits.MAX_AREA - existing);
    const binding  = avail < result;
    reasons.push(
      `MAX_AREA[${ar}]: existing=${fmt(existing)} limit=${fmt(limits.MAX_AREA)} avail=${fmt(avail)} ${tag(binding)}`
    );
    if (binding) { result = avail; limitedBy = "MAX_AREA"; }
  } else {
    reasons.push(`MAX_AREA: ${ar ? "not configured" : "area unknown"} — skipped`);
  }

  return {
    maxInvestable:        Math.floor(result * 100) / 100,
    concentrationReasons: reasons,
    limitedBy,
  };
}

module.exports = { computeExposure, applyConcentrationLimits };
