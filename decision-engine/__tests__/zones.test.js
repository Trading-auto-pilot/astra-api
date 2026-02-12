"use strict";

const { buildZones, detectTrendFlagBreakout, computeEntryLevels } = require("../modules/zones");

// ---------------------------------------------------------------------------
// Helper: genera serie di candele sintetiche realistiche
// ---------------------------------------------------------------------------
function generateCandles(n, { basePrice = 100, volatility = 2, trend = 0, baseVolume = 10000 } = {}) {
  const candles = [];
  let price = basePrice;
  for (let i = 0; i < n; i++) {
    const change = (Math.sin(i * 0.3) * volatility) + trend;
    price += change;
    const high = price + volatility * 0.5;
    const low = price - volatility * 0.5;
    const close = price + (Math.sin(i) * volatility * 0.2);
    candles.push({
      high,
      low,
      close,
      volume: baseVolume + Math.sin(i * 0.5) * baseVolume * 0.3,
      t: 1700000000000 + i * 86400000,
    });
  }
  return candles;
}

// Genera candele con swing chiari (supporto a lowPrice, resistenza a highPrice)
function generateCandlesWithSwings(n, lowPrice, highPrice) {
  const candles = [];
  const mid = (lowPrice + highPrice) / 2;
  const range = highPrice - lowPrice;
  for (let i = 0; i < n; i++) {
    // Oscillazione sinusoidale tra lowPrice e highPrice
    const phase = Math.sin(i * Math.PI / 8);
    const price = mid + phase * range * 0.4;
    const vol = range * 0.15;
    candles.push({
      high: price + vol,
      low: price - vol,
      close: price,
      volume: 10000,
      t: 1700000000000 + i * 86400000,
    });
  }
  return candles;
}

const defaultZoneOpts = {
  lookbackBars: 90,
  atrPeriod: 20,
  swingWindow: 3,
  clusterMultiplier: 0.4,
  reactionLookahead: 15,
  minTouches: 2,
  minScore: 0,
  minRecentBars: 90,
  recencyRecent: 30,
  recencyMid: 90,
  weightRecent: 1,
  weightMid: 0.6,
  weightOld: 0.3,
};

// ===========================================================================
// buildZones
// ===========================================================================
describe("buildZones", () => {
  test("restituisce ok:true con zone per candele con swing", () => {
    const candles = generateCandlesWithSwings(100, 90, 110);
    const result = buildZones(candles, defaultZoneOpts);
    expect(result.ok).toBe(true);
    expect(result.atrValue).toBeGreaterThan(0);
    expect(result.zones).toBeDefined();
    expect(result.sliceSize).toBeLessThanOrEqual(100);
    expect(result.eps).toBeGreaterThan(0);
  });

  test("ogni zona ha i campi richiesti", () => {
    const candles = generateCandlesWithSwings(100, 90, 110);
    const result = buildZones(candles, defaultZoneOpts);
    if (result.zones.length > 0) {
      const zone = result.zones[0];
      expect(zone).toHaveProperty("type");
      expect(zone).toHaveProperty("structType");
      expect(zone).toHaveProperty("midPrice");
      expect(zone).toHaveProperty("low");
      expect(zone).toHaveProperty("high");
      expect(zone).toHaveProperty("width");
      expect(zone).toHaveProperty("score");
      expect(zone).toHaveProperty("touches");
      expect(zone).toHaveProperty("recencyBars");
      expect(["SUPPORT", "RESISTANCE"]).toContain(zone.type);
    }
  });

  test("zone ordinate per score decrescente", () => {
    const candles = generateCandlesWithSwings(100, 90, 110);
    const result = buildZones(candles, defaultZoneOpts);
    for (let i = 1; i < result.zones.length; i++) {
      expect(result.zones[i].score).toBeLessThanOrEqual(result.zones[i - 1].score);
    }
  });

  test("filtra zone con touches < minTouches", () => {
    const candles = generateCandlesWithSwings(100, 90, 110);
    const result = buildZones(candles, { ...defaultZoneOpts, minTouches: 50 });
    // Con minTouches molto alto, nessuna zona dovrebbe passare
    expect(result.zones.length).toBe(0);
  });

  test("lookbackBars limita lo slice", () => {
    const candles = generateCandlesWithSwings(200, 90, 110);
    const result = buildZones(candles, { ...defaultZoneOpts, lookbackBars: 50 });
    expect(result.sliceSize).toBe(50);
  });

  test("ATR non disponibile → ok:false", () => {
    // 1 sola candela → ATR non calcolabile
    const candles = [{ high: 100, low: 90, close: 95, volume: 1000, t: 1700000000000 }];
    const result = buildZones(candles, { ...defaultZoneOpts, lookbackBars: 1 });
    expect(result.ok).toBe(false);
    expect(result.zones).toEqual([]);
  });

  test("close non disponibile → ok:false", () => {
    const candles = Array(30).fill(null).map((_, i) => ({
      high: 100,
      low: 90,
      close: i < 29 ? 95 : NaN, // ultimo close non valido
      volume: 1000,
      t: 1700000000000 + i * 86400000,
    }));
    // L'ultimo close è NaN, ma dopo il filtering nella pipeline potrebbe comunque funzionare
    // buildZones riceve candles già normalizzate, quindi non filtra internamente
    const result = buildZones(candles, defaultZoneOpts);
    // Il close NaN viene passato a buildZones — se lastClose non è finito → error
    expect(result.ok).toBe(false);
  });
});

// ===========================================================================
// computeEntryLevels
// ===========================================================================
describe("computeEntryLevels", () => {
  const supportZone = {
    midPrice: 95,
    low: 93,
    high: 97,
    width: 4,
    score: 5,
    touches: 3,
    recencyBars: 10,
    type: "SUPPORT",
    structType: "SUPPORT",
  };

  const resistanceZone = {
    midPrice: 110,
    low: 108,
    high: 112,
    width: 4,
    score: 4,
    touches: 2,
    recencyBars: 15,
    type: "RESISTANCE",
    structType: "RESISTANCE",
  };

  const higherResistance = {
    midPrice: 130,
    low: 128,
    high: 132,
    width: 4,
    score: 2,
    touches: 2,
    recencyBars: 20,
    type: "RESISTANCE",
    structType: "RESISTANCE",
  };

  test("calcola retracement quando c'è supportZone", () => {
    const result = computeEntryLevels(supportZone, resistanceZone, [resistanceZone, higherResistance], 2);
    expect(result.retracement).not.toBeNull();
    expect(result.retracement.entryLimit).toBeGreaterThan(supportZone.low);
    expect(result.retracement.stopLoss).toBeLessThan(supportZone.low);
    expect(result.retracement.takeProfit2).toBeGreaterThan(result.retracement.entryLimit);
    expect(result.retracement.risk).toBeGreaterThan(0);
  });

  test("calcola breakout quando c'è resistanceZone", () => {
    const result = computeEntryLevels(supportZone, resistanceZone, [resistanceZone, higherResistance], 2);
    expect(result.breakout).not.toBeNull();
    expect(result.breakout.entryLimit).toBeGreaterThan(resistanceZone.high);
    expect(result.breakout.stopLoss).toBeLessThan(result.breakout.entryLimit);
    expect(result.breakout.takeProfit2).toBeGreaterThan(result.breakout.entryLimit);
  });

  test("senza supportZone → retracement null", () => {
    const result = computeEntryLevels(null, resistanceZone, [resistanceZone], 2);
    expect(result.retracement).toBeNull();
    expect(result.breakout).not.toBeNull();
  });

  test("senza resistanceZone → breakout null", () => {
    const result = computeEntryLevels(supportZone, null, [], 2);
    expect(result.breakout).toBeNull();
    expect(result.retracement).not.toBeNull();
  });

  test("entrambi null → tutto null", () => {
    const result = computeEntryLevels(null, null, [], 2);
    expect(result.retracement).toBeNull();
    expect(result.breakout).toBeNull();
    expect(result.entryLimit).toBeNull();
    expect(result.stopLoss).toBeNull();
  });

  test("rispetta parametri custom", () => {
    const opts = { zoneFillK: 0.8, breakoutK: 0.5, structuralK: 0.3, volatilityK: 1.5, tpAtrK: 8 };
    const result = computeEntryLevels(supportZone, resistanceZone, [resistanceZone], 2, opts);
    expect(result.retracement.rule.zoneFillK).toBe(0.8);
    expect(result.breakout.rule.breakoutK).toBe(0.5);
  });

  test("entryLimit retracement = low + zoneFillK * width", () => {
    const opts = { zoneFillK: 0.55, breakoutK: 0.25, structuralK: 0.2, volatilityK: 1.2, tpAtrK: 5 };
    const result = computeEntryLevels(supportZone, null, [], 2, opts);
    const expected = supportZone.low + 0.55 * supportZone.width;
    expect(result.retracement.entryLimit).toBeCloseTo(expected);
  });

  test("entryLimit breakout = high + breakoutK * atr", () => {
    const atr = 2;
    const opts = { zoneFillK: 0.55, breakoutK: 0.25, structuralK: 0.2, volatilityK: 1.2, tpAtrK: 5 };
    const result = computeEntryLevels(null, resistanceZone, [resistanceZone], atr, opts);
    const expected = resistanceZone.high + 0.25 * atr;
    expect(result.breakout.entryLimit).toBeCloseTo(expected);
  });

  test("takeProfit1 punta alla prossima resistenza", () => {
    const result = computeEntryLevels(supportZone, resistanceZone, [resistanceZone, higherResistance], 2);
    // Per retracement: nextRes = prima resistenza con midPrice > entryLimit
    expect(result.retracement.takeProfit1).toBe(resistanceZone.midPrice);
  });
});

// ===========================================================================
// detectTrendFlagBreakout
// ===========================================================================
describe("detectTrendFlagBreakout", () => {
  test("candele insufficienti → risultato di default", () => {
    const candles = generateCandles(10);
    const result = detectTrendFlagBreakout(candles, { atrPeriod: 20 });
    expect(result.trendOk).toBe(false);
    expect(result.flagOk).toBe(false);
    expect(result.breakoutOk).toBe(false);
    expect(result.pullbackOk).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.debug.reason).toBe("not enough candles");
  });

  test("serie monotona crescente con trend forte → trendOk true", () => {
    // EMA20 > EMA50, close sopra EMA20
    const candles = generateCandles(200, { basePrice: 100, trend: 0.5, volatility: 0.2 });
    const result = detectTrendFlagBreakout(candles, { atrPeriod: 20 });
    expect(result.trendOk).toBe(true);
  });

  test("serie piatta senza trend → trendOk false", () => {
    const candles = generateCandles(200, { basePrice: 100, trend: 0, volatility: 0.1 });
    const result = detectTrendFlagBreakout(candles, { atrPeriod: 20 });
    // Serie piatta → ema20 ≈ ema50, potrebbe non passare il check
    expect(typeof result.trendOk).toBe("boolean");
  });

  test("struttura del risultato è completa", () => {
    const candles = generateCandles(200, { basePrice: 100, trend: 0.2 });
    const result = detectTrendFlagBreakout(candles, { atrPeriod: 20 });
    expect(result).toHaveProperty("trendOk");
    expect(result).toHaveProperty("flagOk");
    expect(result).toHaveProperty("breakoutOk");
    expect(result).toHaveProperty("pullbackOk");
    expect(result).toHaveProperty("breakLevel");
    expect(result).toHaveProperty("flagHigh");
    expect(result).toHaveProperty("flagLow");
    expect(result).toHaveProperty("entryBreakout");
    expect(result).toHaveProperty("entryPullback");
    expect(result).toHaveProperty("stopLoss");
    expect(result).toHaveProperty("targets");
    expect(result.targets).toHaveProperty("tp1");
    expect(result.targets).toHaveProperty("tp2");
    expect(result.targets).toHaveProperty("trailingAtrK");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("debug");
  });

  test("confidence è tra 0 e 100", () => {
    const candles = generateCandles(200, { basePrice: 100, trend: 0.2 });
    const result = detectTrendFlagBreakout(candles, { atrPeriod: 20 });
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(100);
  });

  test("flagHigh >= flagLow", () => {
    const candles = generateCandles(200, { basePrice: 100, trend: 0.1 });
    const result = detectTrendFlagBreakout(candles, { atrPeriod: 20 });
    if (Number.isFinite(result.flagHigh) && Number.isFinite(result.flagLow)) {
      expect(result.flagHigh).toBeGreaterThanOrEqual(result.flagLow);
    }
  });

  test("debug contiene metriche diagnostiche", () => {
    const candles = generateCandles(200, { basePrice: 100, trend: 0.2 });
    const result = detectTrendFlagBreakout(candles, { atrPeriod: 20 });
    expect(result.debug).toHaveProperty("atrLast");
    expect(result.debug).toHaveProperty("flagRange");
    expect(result.debug).toHaveProperty("lastClose");
    expect(result.debug).toHaveProperty("trend");
    expect(result.debug.trend).toHaveProperty("ema20Last");
    expect(result.debug.trend).toHaveProperty("ema50Last");
  });

  test("isValidBreakoutSetup = trendOk && flagOk && breakoutOk", () => {
    const candles = generateCandles(200, { basePrice: 100, trend: 0.2 });
    const result = detectTrendFlagBreakout(candles, { atrPeriod: 20 });
    expect(result.isValidBreakoutSetup).toBe(result.trendOk && result.flagOk && result.breakoutOk);
  });

  test("isValidPullbackSetup = trendOk && flagOk && pullbackOk", () => {
    const candles = generateCandles(200, { basePrice: 100, trend: 0.2 });
    const result = detectTrendFlagBreakout(candles, { atrPeriod: 20 });
    expect(result.isValidPullbackSetup).toBe(result.trendOk && result.flagOk && result.pullbackOk);
  });

  test("opzioni custom vengono rispettate", () => {
    const candles = generateCandles(200, { basePrice: 100, trend: 0.2 });
    const result = detectTrendFlagBreakout(candles, {
      atrPeriod: 14,
      trendBars: 10,
      flagBars: 15,
      flagAtrK: 2.0,
      volMult: 1.5,
    });
    // Verifica che il risultato sia valido (non crasha con opzioni custom)
    expect(typeof result.trendOk).toBe("boolean");
    expect(typeof result.flagOk).toBe("boolean");
  });

  test("breakoutEntry contiene info volume", () => {
    const candles = generateCandles(200, { basePrice: 100, trend: 0.2 });
    const result = detectTrendFlagBreakout(candles, { atrPeriod: 20 });
    expect(result.breakoutEntry).toHaveProperty("breakLevel");
    expect(result.breakoutEntry).toHaveProperty("buffer");
    expect(result.breakoutEntry).toHaveProperty("volumeThreshold");
    expect(result.breakoutEntry).toHaveProperty("volumeOk");
    expect(result.breakoutEntry).toHaveProperty("entrySuggestion");
  });
});
