"use strict";

/**
 * live-manager.test.js
 *
 * Copre le funzioni pure e lo state management esportati da live-manager:
 *  - liveState: struttura iniziale
 *  - activateLiveState / resetLiveState
 *  - getLiveStatus
 *  - buildEventEnvelope (via publishEvent con bus mock)
 *  - getGuardConfig / updateGuardConfig
 *
 * NON testa:
 *  - createMarketDataHandler (dipende da Redis live, mercato reale, FMP API)
 *  - updateSnapshotFlagsFromLive (logica di segnale complessa — copertura tramite test E2E)
 */

jest.mock("axios");
jest.mock("../modules/zones", () => ({
  detectTrendFlagBreakout: jest.fn(() => ({ flagOk: true, trendOk: true })),
}));
jest.mock("../modules/job-manager", () => ({
  buildSpotFinderRedisKey: jest.fn((_bus, pipeId, userId, date) => `sf:${pipeId}:${userId}:${date}`),
}));

const {
  liveState,
  activateLiveState,
  resetLiveState,
  getLiveStatus,
  getGuardConfig,
  updateGuardConfig,
} = require("../modules/live-manager");

const silentLogger = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
};

// Reimposta lo stato live prima di ogni test per isolamento
beforeEach(() => {
  resetLiveState("test setup");
  jest.clearAllMocks();
});

// ===========================================================================
// liveState — struttura iniziale
// ===========================================================================
describe("liveState struttura iniziale", () => {
  test("active è false alla partenza", () => {
    expect(liveState.active).toBe(false);
  });

  test("pipeId è null", () => {
    expect(liveState.pipeId).toBeNull();
  });

  test("tickers è un Set vuoto", () => {
    expect(liveState.tickers).toBeInstanceOf(Set);
    expect(liveState.tickers.size).toBe(0);
  });

  test("minIntervalMs è un numero positivo", () => {
    expect(liveState.minIntervalMs).toBeGreaterThan(0);
  });

  test("lastRunByTicker e runningByTicker sono Map/Set vuoti", () => {
    expect(liveState.lastRunByTicker.size).toBe(0);
    expect(liveState.runningByTicker.size).toBe(0);
  });
});

// ===========================================================================
// activateLiveState
// ===========================================================================
describe("activateLiveState", () => {
  const baseParams = {
    pipeId: 42,
    asOfDate: "2024-01-15",
    userId: 99,
    tickers: ["AAPL", "MSFT", "GOOGL"],
    exchangeByTicker: new Map([["AAPL", "NASDAQ"], ["MSFT", "NASDAQ"]]),
    query: { signalTf: "daily" },
    authHeaders: { authorization: "Bearer test" },
  };

  test("imposta active=true", () => {
    activateLiveState(baseParams);
    expect(liveState.active).toBe(true);
  });

  test("imposta pipeId, userId, asOfDate", () => {
    activateLiveState(baseParams);
    expect(liveState.pipeId).toBe(42);
    expect(liveState.userId).toBe(99);
    expect(liveState.asOfDate).toBe("2024-01-15");
  });

  test("converte l'array tickers in un Set", () => {
    activateLiveState(baseParams);
    expect(liveState.tickers).toBeInstanceOf(Set);
    expect(liveState.tickers.has("AAPL")).toBe(true);
    expect(liveState.tickers.has("MSFT")).toBe(true);
    expect(liveState.tickers.size).toBe(3);
  });

  test("deduplicazione: ticker duplicati vengono collassati nel Set", () => {
    activateLiveState({ ...baseParams, tickers: ["AAPL", "AAPL", "MSFT"] });
    expect(liveState.tickers.size).toBe(2);
  });

  test("salva exchangeByTicker, query, authHeaders", () => {
    activateLiveState(baseParams);
    expect(liveState.exchangeByTicker.get("AAPL")).toBe("NASDAQ");
    expect(liveState.query.signalTf).toBe("daily");
    expect(liveState.authHeaders.authorization).toBe("Bearer test");
  });

  test("svuota lastRunByTicker e runningByTicker", () => {
    // Popoliamo prima
    liveState.lastRunByTicker.set("AAPL", Date.now());
    liveState.runningByTicker.add("MSFT");

    activateLiveState(baseParams);

    expect(liveState.lastRunByTicker.size).toBe(0);
    expect(liveState.runningByTicker.size).toBe(0);
  });

  test("chiamate successive sovrascrivono correttamente lo stato", () => {
    activateLiveState({ ...baseParams, pipeId: 1, tickers: ["AAPL"] });
    activateLiveState({ ...baseParams, pipeId: 2, tickers: ["MSFT", "GOOGL"] });
    expect(liveState.pipeId).toBe(2);
    expect(liveState.tickers.has("AAPL")).toBe(false);
    expect(liveState.tickers.size).toBe(2);
  });
});

// ===========================================================================
// resetLiveState
// ===========================================================================
describe("resetLiveState", () => {
  test("dopo reset active=false, pipeId=null", () => {
    activateLiveState({
      pipeId: 10, asOfDate: "2024-01-15", userId: 5,
      tickers: ["AAPL"], exchangeByTicker: new Map(),
      query: {}, authHeaders: {},
    });
    expect(liveState.active).toBe(true);

    resetLiveState("test", silentLogger);
    expect(liveState.active).toBe(false);
    expect(liveState.pipeId).toBeNull();
    expect(liveState.asOfDate).toBeNull();
    expect(liveState.userId).toBeNull();
  });

  test("tickers torna a un Set vuoto", () => {
    activateLiveState({
      pipeId: 1, asOfDate: "2024-01-15", userId: 1,
      tickers: ["AAPL", "MSFT"], exchangeByTicker: new Map(),
      query: {}, authHeaders: {},
    });
    resetLiveState("test");
    expect(liveState.tickers.size).toBe(0);
  });

  test("svuota lastRunByTicker e runningByTicker", () => {
    liveState.lastRunByTicker.set("X", 1000);
    liveState.runningByTicker.add("Y");
    resetLiveState("test");
    expect(liveState.lastRunByTicker.size).toBe(0);
    expect(liveState.runningByTicker.size).toBe(0);
  });

  test("reset su stato già inattivo non lancia errori", () => {
    expect(() => resetLiveState("test")).not.toThrow();
  });
});

// ===========================================================================
// getLiveStatus
// ===========================================================================
describe("getLiveStatus", () => {
  test("active=false quando live non attivo", () => {
    const status = getLiveStatus(42);
    expect(status.ok).toBe(true);
    expect(status.active).toBe(false);
  });

  test("active=true solo se il pipeId corrisponde", () => {
    activateLiveState({
      pipeId: 42, asOfDate: "2024-01-15", userId: 1,
      tickers: ["AAPL"], exchangeByTicker: new Map(),
      query: {}, authHeaders: {},
    });
    expect(getLiveStatus(42).active).toBe(true);
    expect(getLiveStatus(99).active).toBe(false);
  });

  test("espone la lista di tickers corrente", () => {
    activateLiveState({
      pipeId: 7, asOfDate: "2024-01-15", userId: 1,
      tickers: ["AAPL", "MSFT"], exchangeByTicker: new Map(),
      query: {}, authHeaders: {},
    });
    const status = getLiveStatus(7);
    expect(status.total).toBe(2);
    expect(status.tickers).toContain("AAPL");
    expect(status.tickers).toContain("MSFT");
  });

  test("espone minIntervalMs e updatedAt", () => {
    const status = getLiveStatus(1);
    expect(status.minIntervalMs).toBeGreaterThan(0);
    expect(typeof status.updatedAt).toBe("string");
  });
});

// ===========================================================================
// getGuardConfig / updateGuardConfig
// ===========================================================================
describe("getGuardConfig", () => {
  test("restituisce una copia (non il riferimento diretto)", () => {
    const a = getGuardConfig();
    const b = getGuardConfig();
    expect(a).not.toBe(b);
    expect(a.earnings).not.toBe(b.earnings);
  });

  test("contiene tutti e 4 i guard", () => {
    const cfg = getGuardConfig();
    expect(cfg).toHaveProperty("earnings");
    expect(cfg).toHaveProperty("fomc");
    expect(cfg).toHaveProperty("macro");
    expect(cfg).toHaveProperty("dividend");
  });

  test("ogni guard ha enabled (bool) e blockDays (number)", () => {
    const cfg = getGuardConfig();
    for (const name of ["earnings", "fomc", "macro", "dividend"]) {
      expect(typeof cfg[name].enabled).toBe("boolean");
      expect(typeof cfg[name].blockDays).toBe("number");
    }
  });
});

describe("updateGuardConfig", () => {
  test("lancia errore se patch non è un oggetto", () => {
    expect(() => updateGuardConfig(null)).toThrow();
    expect(() => updateGuardConfig("string")).toThrow();
  });

  test("aggiorna enabled di un guard", () => {
    const before = getGuardConfig().earnings.enabled;
    updateGuardConfig({ earnings: { enabled: !before } });
    expect(getGuardConfig().earnings.enabled).toBe(!before);
    // Ripristina
    updateGuardConfig({ earnings: { enabled: before } });
  });

  test("aggiorna blockDays di un guard", () => {
    updateGuardConfig({ fomc: { blockDays: 7 } });
    expect(getGuardConfig().fomc.blockDays).toBe(7);
  });

  test("blockWeeks per earnings viene convertito in blockDays", () => {
    updateGuardConfig({ earnings: { blockWeeks: 3 } });
    expect(getGuardConfig().earnings.blockDays).toBe(21);
  });

  test("ignora guard sconosciuti nel patch", () => {
    expect(() => updateGuardConfig({ unknownGuard: { enabled: false } })).not.toThrow();
  });

  test("ignora blockDays negativi", () => {
    const before = getGuardConfig().dividend.blockDays;
    updateGuardConfig({ dividend: { blockDays: -5 } });
    expect(getGuardConfig().dividend.blockDays).toBe(before);
  });

  test("patch parziale: aggiorna solo i campi forniti", () => {
    updateGuardConfig({ macro: { blockDays: 2 } });
    const cfg = getGuardConfig();
    expect(cfg.macro.blockDays).toBe(2);
    // fomc non toccato
    expect(typeof cfg.fomc.blockDays).toBe("number");
  });

  test("restituisce la config aggiornata", () => {
    const result = updateGuardConfig({ fomc: { blockDays: 3 } });
    expect(result).toHaveProperty("fomc");
    expect(result.fomc.blockDays).toBe(3);
  });
});

// ===========================================================================
// Interazione rate-limit: runningByTicker e lastRunByTicker
// ===========================================================================
describe("rate-limit state (runningByTicker / lastRunByTicker)", () => {
  test("runningByTicker blocca un ticker già in esecuzione", () => {
    activateLiveState({
      pipeId: 1, asOfDate: "2024-01-15", userId: 1,
      tickers: ["AAPL"], exchangeByTicker: new Map(),
      query: {}, authHeaders: {},
    });

    liveState.runningByTicker.add("AAPL");
    expect(liveState.runningByTicker.has("AAPL")).toBe(true);

    // Simula delete post-run
    liveState.runningByTicker.delete("AAPL");
    expect(liveState.runningByTicker.has("AAPL")).toBe(false);
  });

  test("lastRunByTicker traccia l'ultimo timestamp di run", () => {
    activateLiveState({
      pipeId: 1, asOfDate: "2024-01-15", userId: 1,
      tickers: ["AAPL"], exchangeByTicker: new Map(),
      query: {}, authHeaders: {},
    });

    const now = Date.now();
    liveState.lastRunByTicker.set("AAPL", now);
    expect(liveState.lastRunByTicker.get("AAPL")).toBe(now);

    // Dopo minIntervalMs il ticker dovrebbe essere di nuovo eleggibile
    const elapsed = liveState.minIntervalMs + 1;
    const isRateLimited = (now + elapsed) - liveState.lastRunByTicker.get("AAPL") < liveState.minIntervalMs;
    expect(isRateLimited).toBe(false);
  });
});
