"use strict";

const {
  atr,
  sma,
  ema,
  linearRegressionSlope,
  findSwings,
  clusterByPrice,
  recencyWeight,
  calcReaction,
  pickCandidate,
  pickClosestByDistance,
} = require("../modules/indicators");

// ---------------------------------------------------------------------------
// Helper: genera candele sintetiche
// ---------------------------------------------------------------------------
function makeCandles(rows) {
  // rows = [[high, low, close, volume?, t?], ...]
  return rows.map(([high, low, close, volume = 0, t = null]) => ({
    high,
    low,
    close,
    volume,
    t,
  }));
}

// ===========================================================================
// sma
// ===========================================================================
describe("sma", () => {
  test("period=3 su serie nota", () => {
    const values = [2, 4, 6, 8, 10];
    const result = sma(values, 3);
    // i=0: [2] → 2
    // i=1: [2,4] → 3
    // i=2: [2,4,6] → 4
    // i=3: [4,6,8] → 6
    // i=4: [6,8,10] → 8
    expect(result).toHaveLength(5);
    expect(result[0]).toBeCloseTo(2);
    expect(result[1]).toBeCloseTo(3);
    expect(result[2]).toBeCloseTo(4);
    expect(result[3]).toBeCloseTo(6);
    expect(result[4]).toBeCloseTo(8);
  });

  test("period=1 restituisce i valori stessi", () => {
    const values = [10, 20, 30];
    const result = sma(values, 1);
    expect(result[0]).toBeCloseTo(10);
    expect(result[1]).toBeCloseTo(20);
    expect(result[2]).toBeCloseTo(30);
  });

  test("gestisce NaN/non-finiti", () => {
    const values = [10, NaN, 30];
    const result = sma(values, 3);
    // i=2: filtra NaN → [10, 30] → 20
    expect(result[2]).toBeCloseTo(20);
  });

  test("array vuoto restituisce array vuoto", () => {
    expect(sma([], 5)).toEqual([]);
  });
});

// ===========================================================================
// ema
// ===========================================================================
describe("ema", () => {
  test("primo valore = valore stesso", () => {
    const values = [100, 110, 120];
    const result = ema(values, 10);
    expect(result[0]).toBeCloseTo(100);
  });

  test("period=1 segue il valore esatto", () => {
    // k = 2/(1+1) = 1 → ema = valore corrente
    const values = [10, 20, 30];
    const result = ema(values, 1);
    expect(result[0]).toBeCloseTo(10);
    expect(result[1]).toBeCloseTo(20);
    expect(result[2]).toBeCloseTo(30);
  });

  test("ema converge verso la media per serie costante", () => {
    const values = Array(50).fill(100);
    const result = ema(values, 20);
    expect(result[49]).toBeCloseTo(100);
  });

  test("NaN viene saltato, usa prev", () => {
    const values = [50, NaN, 50];
    const result = ema(values, 10);
    expect(result[0]).toBeCloseTo(50);
    expect(result[1]).toBeCloseTo(50); // prev
    expect(result[2]).toBeCloseTo(50);
  });

  test("array vuoto restituisce array vuoto", () => {
    expect(ema([], 5)).toEqual([]);
  });
});

// ===========================================================================
// atr
// ===========================================================================
describe("atr", () => {
  test("calcola ATR corretto su candele semplici", () => {
    // Candle 0: H=12, L=10, C=11 — no TR (primo indice)
    // Candle 1: H=13, L=10.5, C=12; prev close=11
    //   TR = max(13-10.5, |13-11|, |10.5-11|) = max(2.5, 2, 0.5) = 2.5
    // Candle 2: H=14, L=11, C=13; prev close=12
    //   TR = max(14-11, |14-12|, |11-12|) = max(3, 2, 1) = 3
    const candles = makeCandles([
      [12, 10, 11],
      [13, 10.5, 12],
      [14, 11, 13],
    ]);
    const result = atr(candles, 2);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeCloseTo(2.5);
    // i=2, period=2: media di TR[1] e TR[2] = (2.5 + 3) / 2 = 2.75
    expect(result[2]).toBeCloseTo(2.75);
  });

  test("primo elemento sempre null", () => {
    const candles = makeCandles([[10, 5, 8], [12, 6, 10]]);
    const result = atr(candles, 14);
    expect(result[0]).toBeNull();
  });

  test("gestisce dati non finiti", () => {
    const candles = makeCandles([
      [10, 5, 8],
      [NaN, 6, 10],
      [12, 6, 10],
    ]);
    const result = atr(candles, 2);
    expect(result[1]).toBeNull();
  });

  test("singola candela → [null]", () => {
    const candles = makeCandles([[10, 5, 8]]);
    expect(atr(candles, 14)).toEqual([null]);
  });
});

// ===========================================================================
// linearRegressionSlope
// ===========================================================================
describe("linearRegressionSlope", () => {
  test("slope positivo per serie crescente", () => {
    // y = 2x + 1 → slope = 2
    const values = [1, 3, 5, 7, 9];
    expect(linearRegressionSlope(values)).toBeCloseTo(2);
  });

  test("slope negativo per serie decrescente", () => {
    const values = [10, 8, 6, 4, 2];
    expect(linearRegressionSlope(values)).toBeCloseTo(-2);
  });

  test("slope zero per serie costante", () => {
    const values = [5, 5, 5, 5];
    expect(linearRegressionSlope(values)).toBeCloseTo(0);
  });

  test("meno di 2 valori → 0", () => {
    expect(linearRegressionSlope([42])).toBe(0);
    expect(linearRegressionSlope([])).toBe(0);
  });

  test("NaN in serie → 0", () => {
    expect(linearRegressionSlope([1, NaN, 3])).toBe(0);
  });
});

// ===========================================================================
// findSwings
// ===========================================================================
describe("findSwings", () => {
  test("trova swing high e swing low con window=1", () => {
    // Con window=1, solo indici da 1 a length-2 vengono valutati.
    // Per avere sia high che low servono almeno 5 candele.
    const candles = makeCandles([
      [5, 4, 4.5],
      [10, 8, 9],    // swing high: 10 > 5 (i-1) e 10 > 7 (i+1) ✓
      [7, 5, 6],
      [6, 1, 3],     // swing low: 1 < 5 (i-1) e 1 < 3 (i+1) ✓
      [8, 3, 6],
    ]);
    const swings = findSwings(candles, 1);
    const highs = swings.filter((s) => s.type === "HIGH");
    const lows = swings.filter((s) => s.type === "LOW");
    expect(highs.length).toBe(1);
    expect(highs[0].index).toBe(1);
    expect(highs[0].price).toBe(10);
    expect(lows.length).toBe(1);
    expect(lows[0].index).toBe(3);
    expect(lows[0].price).toBe(1);
  });

  test("non trova swing su serie monotona crescente", () => {
    const candles = makeCandles([
      [5, 3, 4],
      [6, 4, 5],
      [7, 5, 6],
      [8, 6, 7],
      [9, 7, 8],
    ]);
    const swings = findSwings(candles, 1);
    const highs = swings.filter((s) => s.type === "HIGH");
    // no swing high perché ogni high < successivo
    expect(highs.length).toBe(0);
  });

  test("window=2 richiede conferma più ampia", () => {
    const candles = makeCandles([
      [5, 3, 4],
      [6, 4, 5],
      [10, 8, 9],   // potenziale swing high
      [6, 4, 5],
      [5, 3, 4],
    ]);
    const swings = findSwings(candles, 2);
    const highs = swings.filter((s) => s.type === "HIGH");
    expect(highs.length).toBe(1);
    expect(highs[0].index).toBe(2);
  });

  test("array troppo corto per window → vuoto", () => {
    const candles = makeCandles([[10, 5, 8], [12, 6, 10]]);
    expect(findSwings(candles, 2)).toEqual([]);
  });
});

// ===========================================================================
// clusterByPrice
// ===========================================================================
describe("clusterByPrice", () => {
  test("raggruppa punti vicini entro eps", () => {
    const points = [
      { price: 100, index: 0 },
      { price: 100.5, index: 1 },
      { price: 200, index: 2 },
      { price: 200.3, index: 3 },
    ];
    const clusters = clusterByPrice(points, 1);
    expect(clusters.length).toBe(2);
    expect(clusters[0].points.length).toBe(2);
    expect(clusters[1].points.length).toBe(2);
  });

  test("eps=0 → ogni punto è un cluster separato", () => {
    const points = [
      { price: 100, index: 0 },
      { price: 101, index: 1 },
    ];
    const clusters = clusterByPrice(points, 0);
    expect(clusters.length).toBe(2);
  });

  test("eps molto grande → un solo cluster", () => {
    const points = [
      { price: 100, index: 0 },
      { price: 105, index: 1 },
      { price: 110, index: 2 },
    ];
    const clusters = clusterByPrice(points, 100);
    expect(clusters.length).toBe(1);
    expect(clusters[0].points.length).toBe(3);
  });

  test("array vuoto → vuoto", () => {
    expect(clusterByPrice([], 1)).toEqual([]);
  });

  test("media del cluster è corretta", () => {
    const points = [
      { price: 100, index: 0 },
      { price: 102, index: 1 },
    ];
    const clusters = clusterByPrice(points, 5);
    expect(clusters.length).toBe(1);
    expect(clusters[0].mean).toBeCloseTo(101);
  });
});

// ===========================================================================
// recencyWeight
// ===========================================================================
describe("recencyWeight", () => {
  test("barsAgo < recentBars → wRecent", () => {
    expect(recencyWeight(5, 30, 90, 1.0, 0.6, 0.3)).toBe(1.0);
  });

  test("barsAgo == recentBars → wMid (non wRecent)", () => {
    // barsAgo < recentBars è false → barsAgo <= midBars
    expect(recencyWeight(30, 30, 90, 1.0, 0.6, 0.3)).toBe(0.6);
  });

  test("barsAgo <= midBars → wMid", () => {
    expect(recencyWeight(60, 30, 90, 1.0, 0.6, 0.3)).toBe(0.6);
  });

  test("barsAgo > midBars → wOld", () => {
    expect(recencyWeight(100, 30, 90, 1.0, 0.6, 0.3)).toBe(0.3);
  });
});

// ===========================================================================
// calcReaction
// ===========================================================================
describe("calcReaction", () => {
  test("calcola reazione normalizzata su ATR", () => {
    const candles = makeCandles([
      [110, 90, 100],
      [120, 95, 105],
      [130, 100, 125],  // grande move da 100
      [115, 95, 110],
    ]);
    const atrSeries = [null, 10, 10, 10];
    // index=0, price=100, lookahead=3
    // moves: |105-100|=5, |125-100|=25, |110-100|=10 → max=25
    // atr[0]=null, fallback atr[3]=10
    // 25/10 = 2.5
    const result = calcReaction(candles, 0, 100, 3, atrSeries);
    expect(result).toBeCloseTo(2.5);
  });

  test("atrValue=0 → 0", () => {
    const candles = makeCandles([[10, 5, 8], [15, 5, 10]]);
    const atrSeries = [0, 0];
    expect(calcReaction(candles, 0, 8, 1, atrSeries)).toBe(0);
  });

  test("nessun move → 0", () => {
    const candles = makeCandles([[10, 5, 8]]);
    const atrSeries = [5];
    // lookahead=5 ma solo 1 candela → nessun j
    expect(calcReaction(candles, 0, 8, 5, atrSeries)).toBe(0);
  });
});

// ===========================================================================
// pickCandidate
// ===========================================================================
describe("pickCandidate", () => {
  test("sceglie il candidato con score più alto", () => {
    const items = [
      { score: 3, touches: 2, recencyBars: 10, midPrice: 100 },
      { score: 5, touches: 2, recencyBars: 10, midPrice: 110 },
      { score: 1, touches: 2, recencyBars: 10, midPrice: 90 },
    ];
    const result = pickCandidate(items, (z) => z.midPrice);
    expect(result.score).toBe(5);
  });

  test("a parità di score, sceglie più touches", () => {
    const items = [
      { score: 5, touches: 2, recencyBars: 10, midPrice: 100 },
      { score: 5, touches: 4, recencyBars: 10, midPrice: 110 },
    ];
    const result = pickCandidate(items, (z) => z.midPrice);
    expect(result.touches).toBe(4);
  });

  test("a parità di score e touches, sceglie recencyBars minore", () => {
    const items = [
      { score: 5, touches: 3, recencyBars: 20, midPrice: 100 },
      { score: 5, touches: 3, recencyBars: 5, midPrice: 110 },
    ];
    const result = pickCandidate(items, (z) => z.midPrice);
    expect(result.recencyBars).toBe(5);
  });

  test("ultimo tiebreak usa selector", () => {
    const items = [
      { score: 5, touches: 3, recencyBars: 10, midPrice: 200 },
      { score: 5, touches: 3, recencyBars: 10, midPrice: 100 },
    ];
    const result = pickCandidate(items, (z) => z.midPrice);
    expect(result.midPrice).toBe(100);
  });

  test("array vuoto → null", () => {
    expect(pickCandidate([], (z) => z.midPrice)).toBeNull();
  });
});

// ===========================================================================
// pickClosestByDistance
// ===========================================================================
describe("pickClosestByDistance", () => {
  test("sceglie elemento con distanza minore", () => {
    const items = [
      { score: 3, touches: 2, recencyBars: 10, midPrice: 100 },
      { score: 5, touches: 4, recencyBars: 5, midPrice: 99 },
    ];
    const ref = 100;
    const result = pickClosestByDistance(items, (z) => Math.abs(ref - z.midPrice));
    expect(result.midPrice).toBe(100); // distanza 0
  });

  test("a parità di distanza, sceglie recencyBars minore", () => {
    const items = [
      { score: 3, touches: 2, recencyBars: 20, midPrice: 95 },
      { score: 3, touches: 2, recencyBars: 5, midPrice: 105 },
    ];
    const ref = 100;
    const result = pickClosestByDistance(items, (z) => Math.abs(ref - z.midPrice));
    expect(result.recencyBars).toBe(5);
  });

  test("array vuoto → null", () => {
    expect(pickClosestByDistance([], (z) => z.midPrice)).toBeNull();
  });
});
