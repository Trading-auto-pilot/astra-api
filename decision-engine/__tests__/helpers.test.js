"use strict";

const {
  asNumber,
  asBool,
  subDays,
  normalizeDateParam,
  resolveSnapshotDate,
  pickPrice,
  normalizeTimestamp,
  normalizeCandle,
  normalizeAndSortCandles,
  pickAuthHeaders,
  isTrendOk,
  isSupportNotAvailable,
} = require("../modules/helpers");

// ===========================================================================
// asNumber
// ===========================================================================
describe("asNumber", () => {
  test("numero valido → numero", () => {
    expect(asNumber(42, 0)).toBe(42);
    expect(asNumber("3.14", 0)).toBeCloseTo(3.14);
    expect(asNumber(0, 99)).toBe(0);
  });

  test("non numero → fallback", () => {
    expect(asNumber("abc", 10)).toBe(10);
    expect(asNumber(undefined, 5)).toBe(5);
    expect(asNumber(NaN, 1)).toBe(1);
    expect(asNumber(Infinity, 2)).toBe(2);
  });

  test("null e stringa vuota sono 0 (Number(null)===0, Number('')===0)", () => {
    // Comportamento JS: Number(null)=0, Number("")=0 → isFinite → restituito
    expect(asNumber(null, 7)).toBe(0);
    expect(asNumber("", 99)).toBe(0);
  });

  test("fallback null restituito quando non numero", () => {
    expect(asNumber("x", null)).toBeNull();
  });
});

// ===========================================================================
// asBool
// ===========================================================================
describe("asBool", () => {
  test("true/false booleani", () => {
    expect(asBool(true, false)).toBe(true);
    expect(asBool(false, true)).toBe(false);
  });

  test("stringhe truthy", () => {
    expect(asBool("true", false)).toBe(true);
    expect(asBool("1", false)).toBe(true);
    expect(asBool("yes", false)).toBe(true);
    expect(asBool("on", false)).toBe(true);
    expect(asBool("TRUE", false)).toBe(true);
    expect(asBool(" True ", false)).toBe(true);
  });

  test("stringhe falsy", () => {
    expect(asBool("false", true)).toBe(false);
    expect(asBool("0", true)).toBe(false);
    expect(asBool("no", true)).toBe(false);
    expect(asBool("off", true)).toBe(false);
  });

  test("undefined/null → fallback", () => {
    expect(asBool(undefined, true)).toBe(true);
    expect(asBool(null, false)).toBe(false);
  });

  test("stringa non riconosciuta → fallback", () => {
    expect(asBool("maybe", true)).toBe(true);
    expect(asBool("maybe", false)).toBe(false);
  });
});

// ===========================================================================
// subDays
// ===========================================================================
describe("subDays", () => {
  test("sottrae giorni correttamente", () => {
    const base = new Date("2026-02-10T12:00:00Z");
    const result = subDays(base, 3);
    expect(result.toISOString().slice(0, 10)).toBe("2026-02-07");
  });

  test("non muta la data originale", () => {
    const base = new Date("2026-02-10T12:00:00Z");
    subDays(base, 5);
    expect(base.toISOString().slice(0, 10)).toBe("2026-02-10");
  });

  test("giorni negativi = aggiunge giorni", () => {
    const base = new Date("2026-02-10T12:00:00Z");
    const result = subDays(base, -2);
    expect(result.toISOString().slice(0, 10)).toBe("2026-02-12");
  });
});

// ===========================================================================
// normalizeDateParam
// ===========================================================================
describe("normalizeDateParam", () => {
  test("tronca a 10 caratteri", () => {
    expect(normalizeDateParam("2026-02-07T14:30:00Z")).toBe("2026-02-07");
  });

  test("null/undefined → null", () => {
    expect(normalizeDateParam(null)).toBeNull();
    expect(normalizeDateParam(undefined)).toBeNull();
    expect(normalizeDateParam("")).toBeNull();
  });

  test("data già corta → restituita as-is", () => {
    expect(normalizeDateParam("2026-02-07")).toBe("2026-02-07");
  });
});

// ===========================================================================
// resolveSnapshotDate
// ===========================================================================
describe("resolveSnapshotDate", () => {
  test("con valore → normalizza", () => {
    expect(resolveSnapshotDate("2026-01-15T10:00:00Z")).toBe("2026-01-15");
  });

  test("senza valore → data odierna", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(resolveSnapshotDate(null)).toBe(today);
    expect(resolveSnapshotDate(undefined)).toBe(today);
  });
});

// ===========================================================================
// pickPrice
// ===========================================================================
describe("pickPrice", () => {
  test("numero valido → numero", () => {
    expect(pickPrice(42.5)).toBe(42.5);
    expect(pickPrice("100")).toBe(100);
    expect(pickPrice(0)).toBe(0);
  });

  test("non valido → null (tranne null/undefined che diventano 0)", () => {
    expect(pickPrice("abc")).toBeNull();
    expect(pickPrice(NaN)).toBeNull();
    // Number(null)=0, Number(undefined)=NaN
    expect(pickPrice(null)).toBe(0);
    expect(pickPrice(undefined)).toBeNull();
  });
});

// ===========================================================================
// normalizeTimestamp
// ===========================================================================
describe("normalizeTimestamp", () => {
  test("unix seconds → milliseconds", () => {
    expect(normalizeTimestamp(1700000000)).toBe(1700000000000);
  });

  test("unix milliseconds → passthrough", () => {
    expect(normalizeTimestamp(1700000000000)).toBe(1700000000000);
  });

  test("stringa ISO → parsed ms", () => {
    const ms = normalizeTimestamp("2026-01-15T00:00:00Z");
    expect(typeof ms).toBe("number");
    expect(ms).toBeGreaterThan(0);
  });

  test("null/undefined/empty → null", () => {
    expect(normalizeTimestamp(null)).toBeNull();
    expect(normalizeTimestamp(undefined)).toBeNull();
    expect(normalizeTimestamp("")).toBeNull();
  });

  test("stringa non parsabile → null", () => {
    expect(normalizeTimestamp("not-a-date")).toBeNull();
  });
});

// ===========================================================================
// normalizeCandle
// ===========================================================================
describe("normalizeCandle", () => {
  test("formato {h, l, c, v, t}", () => {
    const c = normalizeCandle({ h: 100, l: 90, c: 95, v: 1000, t: 1700000000 });
    expect(c.high).toBe(100);
    expect(c.low).toBe(90);
    expect(c.close).toBe(95);
    expect(c.volume).toBe(1000);
    expect(c.t).toBe(1700000000000);
  });

  test("formato {high, low, close, volume, timestamp}", () => {
    const c = normalizeCandle({ high: 50, low: 40, close: 45, volume: 500, timestamp: "2026-01-15T00:00:00Z" });
    expect(c.high).toBe(50);
    expect(c.low).toBe(40);
    expect(c.close).toBe(45);
    expect(c.volume).toBe(500);
    expect(typeof c.t).toBe("number");
  });

  test("valori mancanti → null", () => {
    const c = normalizeCandle({});
    expect(c.high).toBeNull();
    expect(c.low).toBeNull();
    expect(c.close).toBeNull();
    expect(c.volume).toBeNull();
    expect(c.t).toBeNull();
  });
});

// ===========================================================================
// normalizeAndSortCandles
// ===========================================================================
describe("normalizeAndSortCandles", () => {
  test("filtra candele con dati non validi", () => {
    const raw = [
      { h: 100, l: 90, c: 95, t: 3 },
      { h: NaN, l: 90, c: 95, t: 2 },
      { h: 110, l: 100, c: 105, t: 1 },
    ];
    const result = normalizeAndSortCandles(raw);
    expect(result).toHaveLength(2);
  });

  test("ordina per timestamp crescente", () => {
    const raw = [
      { h: 100, l: 90, c: 95, t: 1700000003 },
      { h: 110, l: 100, c: 105, t: 1700000001 },
      { h: 120, l: 110, c: 115, t: 1700000002 },
    ];
    const result = normalizeAndSortCandles(raw);
    expect(result[0].close).toBe(105);
    expect(result[1].close).toBe(115);
    expect(result[2].close).toBe(95);
  });

  test("array vuoto → vuoto", () => {
    expect(normalizeAndSortCandles([])).toEqual([]);
  });
});

// ===========================================================================
// pickAuthHeaders
// ===========================================================================
describe("pickAuthHeaders", () => {
  test("copia solo header autorizzati", () => {
    const req = {
      headers: {
        authorization: "Bearer token123",
        "x-user-id": "42",
        "content-type": "application/json",
        "x-api-key": "key456",
      },
    };
    const result = pickAuthHeaders(req);
    expect(result.authorization).toBe("Bearer token123");
    expect(result["x-user-id"]).toBe("42");
    expect(result["x-api-key"]).toBe("key456");
    expect(result["content-type"]).toBeUndefined();
  });

  test("req senza headers → oggetto vuoto", () => {
    expect(pickAuthHeaders({})).toEqual({});
    expect(pickAuthHeaders(null)).toEqual({});
  });
});

// ===========================================================================
// isTrendOk
// ===========================================================================
describe("isTrendOk", () => {
  test("true quando trendOk nei vari path", () => {
    expect(isTrendOk({ fullResult: { signal: { pattern: { trendOk: true } } } })).toBe(true);
    expect(isTrendOk({ fullResult: { pattern: { trendOk: true } } })).toBe(true);
    expect(isTrendOk({ signal: { pattern: { trendOk: true } } })).toBe(true);
    expect(isTrendOk({ trendOk: true })).toBe(true);
  });

  test("false quando trendOk è false o mancante", () => {
    expect(isTrendOk({ trendOk: false })).toBe(false);
    expect(isTrendOk({})).toBe(false);
    expect(isTrendOk(null)).toBe(false);
  });
});

// ===========================================================================
// isSupportNotAvailable
// ===========================================================================
describe("isSupportNotAvailable", () => {
  test("true per errore 'support not available'", () => {
    expect(isSupportNotAvailable({ error: "support not available" })).toBe(true);
    expect(isSupportNotAvailable({ error: "SUPPORT NOT AVAILABLE" })).toBe(true);
    expect(isSupportNotAvailable({ message: "No support not available data" })).toBe(true);
  });

  test("false per altri errori", () => {
    expect(isSupportNotAvailable({ error: "timeout" })).toBe(false);
    expect(isSupportNotAvailable({})).toBe(false);
  });
});
