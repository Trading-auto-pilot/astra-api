"use strict";

/**
 * job-manager.test.js
 *
 * Copre:
 *  - Job CRUD: newJobId, getJob, updateJob, cancelJob
 *  - Redis key: buildSpotFinderRedisKey
 *  - Snapshot: loadSnapshotResults, persistSpotFinderSnapshot, updateSnapshotResult
 *  - Ticker utils: buildRankingDailyParams, applyPipeLimit, fetchRankingDailyTickers, fetchUserFundamentalsTickers
 *  - autoSubscribeTrendTickers
 */

jest.mock("axios");
jest.mock("../../shared/jobReporter", () => ({ reportJobDone: jest.fn() }));

const axios = require("axios");
const {
  newJobId,
  getJob,
  updateJob,
  cancelJob,
  buildSpotFinderRedisKey,
  loadSnapshotResults,
  persistSpotFinderSnapshot,
  updateSnapshotResult,
  buildRankingDailyParams,
  applyPipeLimit,
  fetchRankingDailyTickers,
  fetchUserFundamentalsTickers,
} = require("../modules/job-manager");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeBus = (stored = {}) => {
  const store = { ...stored };
  return {
    key: (...parts) => parts.join(":"),
    get: jest.fn(async (k) => store[k] ?? null),
    set: jest.fn(async (k, v) => { store[k] = v; }),
    _store: store,
  };
};

const silentLogger = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
};

// ===========================================================================
// Job CRUD
// ===========================================================================
describe("Job CRUD", () => {
  test("newJobId genera ID univoci con prefisso spot_", () => {
    const a = newJobId();
    const b = newJobId();
    expect(a).toMatch(/^spot_/);
    expect(a).not.toBe(b);
  });

  test("getJob restituisce undefined/null se il job non esiste", () => {
    expect(getJob("nonexistent_job") ?? null).toBeNull();
  });

  test("updateJob su job inesistente restituisce null", () => {
    expect(updateJob("nonexistent_job", { status: "completed" }) ?? null).toBeNull();
  });

  test("cancelJob su job inesistente restituisce null", () => {
    expect(cancelJob("nonexistent_job") ?? null).toBeNull();
  });

  test("cancelJob non cancella un job già completato", async () => {
    // startAsyncJob crea il job internamente — simuliamo creandolo tramite
    // un percorso che sappiamo popola asyncJobs. Usiamo startAsyncJob con
    // una tickerlist vuota in modo che finisca subito.
    axios.get = jest.fn().mockResolvedValue({ data: { ok: true, data: [] } });
    axios.post = jest.fn().mockResolvedValue({ data: { ok: true } });

    const { startAsyncJob } = require("../modules/job-manager");
    const bus = makeBus();
    const jobId = await startAsyncJob({
      bus,
      statusChannel: null,
      pipeId: 1,
      userId: 42,
      query: {},
      req: { query: {}, headers: {} },
      decisionengineUrl: "http://de:3018",
      marketdataserviceUrl: "http://mds:3020",
      tickerscannerUrl: "http://ts:3013",
      cacheManagerTimeoutMs: 5000,
      tickerscannerTimeoutMs: 5000,
      relaxedSpotFinderParams: {},
      logger: silentLogger,
    });

    // Attendi che il job finisca (è asincrono, usa setImmediate interno)
    await new Promise((r) => setTimeout(r, 50));

    const job = getJob(jobId);
    expect(["completed", "running"]).toContain(job?.status);

    // Prova a cancellarlo: se è già completato non dovrebbe cambiare status
    const prev = job?.status;
    cancelJob(jobId);
    if (prev === "completed") {
      expect(getJob(jobId)?.status).toBe("completed");
    }
  });
});

// ===========================================================================
// buildSpotFinderRedisKey
// ===========================================================================
describe("buildSpotFinderRedisKey", () => {
  test("usa bus.key() quando disponibile", () => {
    const bus = { key: (...p) => "ENV:" + p.join(":") };
    expect(buildSpotFinderRedisKey(bus, 1, 42, "2024-01-15"))
      .toBe("ENV:spot-finder:1:42:2024-01-15");
  });

  test("fallback senza bus.key()", () => {
    expect(buildSpotFinderRedisKey({}, 1, 42, "2024-01-15"))
      .toBe("spot-finder:1:42:2024-01-15");
  });

  test("fallback senza bus", () => {
    expect(buildSpotFinderRedisKey(null, 2, 99, "2024-03-01"))
      .toBe("spot-finder:2:99:2024-03-01");
  });
});

// ===========================================================================
// loadSnapshotResults
// ===========================================================================
describe("loadSnapshotResults", () => {
  test("lancia errore se bus non disponibile", async () => {
    await expect(loadSnapshotResults(null, 1, 42, null)).rejects.toThrow("redis not available");
    await expect(loadSnapshotResults({}, 1, 42, null)).rejects.toThrow("redis not available");
  });

  test("restituisce results vuoto se chiave non trovata", async () => {
    const bus = makeBus();
    const { snapshotDate, results } = await loadSnapshotResults(bus, 1, 42, "2024-01-15");
    expect(results).toEqual([]);
    expect(snapshotDate).toBe("2024-01-15");
  });

  test("restituisce i results salvati", async () => {
    const fakeResults = [{ ticker: "AAPL" }, { ticker: "MSFT" }];
    const bus = makeBus({
      "spot-finder:1:42:2024-01-15": { results: fakeResults },
    });
    const { results } = await loadSnapshotResults(bus, 1, 42, "2024-01-15");
    expect(results).toEqual(fakeResults);
  });

  test("results non array nello snapshot → restituisce []", async () => {
    const bus = makeBus({
      "spot-finder:1:42:2024-01-15": { results: null },
    });
    const { results } = await loadSnapshotResults(bus, 1, 42, "2024-01-15");
    expect(results).toEqual([]);
  });

  test("usa la data di oggi se dateParamRaw è null", async () => {
    const bus = makeBus();
    const today = new Date().toISOString().slice(0, 10);
    const { snapshotDate } = await loadSnapshotResults(bus, 1, 42, null);
    expect(snapshotDate).toBe(today);
  });
});

// ===========================================================================
// persistSpotFinderSnapshot
// ===========================================================================
describe("persistSpotFinderSnapshot", () => {
  test("restituisce false se bus non disponibile", async () => {
    expect(await persistSpotFinderSnapshot(null, 1, 42, {}, "2024-01-15", silentLogger)).toBe(false);
    expect(await persistSpotFinderSnapshot({}, 1, 42, {}, "2024-01-15", silentLogger)).toBe(false);
  });

  test("persiste il payload corretto e restituisce true", async () => {
    const bus = makeBus();
    const job = {
      id: "job_1",
      status: "completed",
      total: 3,
      processed: 3,
      ok: 2,
      errorCount: 1,
      results: [{ ticker: "AAPL" }],
      errors: ["err1"],
      startedAt: "2024-01-15T10:00:00Z",
      updatedAt: "2024-01-15T10:01:00Z",
      finishedAt: "2024-01-15T10:02:00Z",
    };
    const result = await persistSpotFinderSnapshot(bus, 1, 42, job, "2024-01-15", silentLogger);
    expect(result).toBe(true);
    expect(bus.set).toHaveBeenCalledTimes(1);

    const [key, payload] = bus.set.mock.calls[0];
    expect(key).toBe("spot-finder:1:42:2024-01-15");
    expect(payload.pipeId).toBe(1);
    expect(payload.userId).toBe(42);
    expect(payload.status).toBe("completed");
    expect(payload.stats.total).toBe(3);
    expect(payload.stats.ok).toBe(2);
    expect(payload.results).toEqual([{ ticker: "AAPL" }]);
  });

  test("gestisce errore Redis restituendo false", async () => {
    const bus = {
      key: (...p) => p.join(":"),
      set: jest.fn().mockRejectedValue(new Error("Redis down")),
    };
    const result = await persistSpotFinderSnapshot(bus, 1, 42, {}, "2024-01-15", silentLogger);
    expect(result).toBe(false);
  });
});

// ===========================================================================
// updateSnapshotResult
// ===========================================================================
describe("updateSnapshotResult", () => {
  test("restituisce false se bus non disponibile", async () => {
    expect(await updateSnapshotResult(null, 1, 42, "2024-01-15", { ticker: "AAPL" }, silentLogger))
      .toBe(false);
  });

  test("aggiunge un nuovo ticker allo snapshot esistente", async () => {
    const bus = makeBus({
      "spot-finder:1:42:2024-01-15": {
        pipeId: 1, userId: 42,
        results: [{ ticker: "MSFT" }],
        errors: [],
        stats: {},
      },
    });
    const ok = await updateSnapshotResult(bus, 1, 42, "2024-01-15", { ticker: "AAPL", score: 80 }, silentLogger);
    expect(ok).toBe(true);
    const saved = bus._store["spot-finder:1:42:2024-01-15"];
    const tickers = saved.results.map((r) => r.ticker);
    expect(tickers).toContain("AAPL");
    expect(tickers).toContain("MSFT");
  });

  test("sovrascrive un ticker già esistente (upsert per ticker)", async () => {
    const bus = makeBus({
      "spot-finder:1:42:2024-01-15": {
        pipeId: 1, userId: 42,
        results: [{ ticker: "AAPL", score: 50 }],
        errors: [],
        stats: {},
      },
    });
    await updateSnapshotResult(bus, 1, 42, "2024-01-15", { ticker: "AAPL", score: 99 }, silentLogger);
    const saved = bus._store["spot-finder:1:42:2024-01-15"];
    const appleRows = saved.results.filter((r) => r.ticker === "AAPL");
    expect(appleRows).toHaveLength(1);
    expect(appleRows[0].score).toBe(99);
  });

  test("restituisce false se ticker è vuoto o mancante", async () => {
    const bus = makeBus({
      "spot-finder:1:42:2024-01-15": { results: [], errors: [], stats: {} },
    });
    const ok = await updateSnapshotResult(bus, 1, 42, "2024-01-15", { ticker: "" }, silentLogger);
    expect(ok).toBe(false);
  });
});

// ===========================================================================
// buildRankingDailyParams
// ===========================================================================
describe("buildRankingDailyParams", () => {
  test("null o undefined → oggetto vuoto", () => {
    expect(buildRankingDailyParams(null)).toEqual({});
    expect(buildRankingDailyParams(undefined)).toEqual({});
  });

  test("include currentPrice se presente", () => {
    const p = buildRankingDailyParams({ price: "123.45" });
    expect(p.currentPrice).toBeCloseTo(123.45);
  });

  test("non include currentPrice se non finito", () => {
    const p = buildRankingDailyParams({ price: "abc" });
    expect(p.currentPrice).toBeUndefined();
  });

  test("tier LOW quando atr_14_pct basso", () => {
    // VOL_TIER_LOW_THRESHOLD = 1.5 di default
    const p = buildRankingDailyParams({ atr_14_pct: 0.5 });
    // deve avere almeno una chiave di override (minTouches, etc)
    expect(Object.keys(p).length).toBeGreaterThan(0);
  });

  test("tier HIGH quando atr_14_pct alto", () => {
    const p = buildRankingDailyParams({ atr_14_pct: 10 });
    expect(Object.keys(p).length).toBeGreaterThan(0);
  });

  test("tier NORMAL per valori intermedi", () => {
    const p = buildRankingDailyParams({ atr_14_pct: 2.5 });
    expect(Object.keys(p).length).toBeGreaterThan(0);
  });

  test("senza atr_14_pct non aggiunge tier params", () => {
    const p = buildRankingDailyParams({ price: 100 });
    // solo currentPrice, nessun tier
    expect(p).toEqual({ currentPrice: 100 });
  });
});

// ===========================================================================
// applyPipeLimit
// ===========================================================================
describe("applyPipeLimit", () => {
  const list = [{ ticker: "A" }, { ticker: "B" }, { ticker: "C" }];

  test("senza limit restituisce la lista completa", () => {
    expect(applyPipeLimit(list, {})).toHaveLength(3);
    expect(applyPipeLimit(list, { limit: "abc" })).toHaveLength(3);
    expect(applyPipeLimit(list, { limit: "0" })).toHaveLength(3);
  });

  test("tronca la lista al limit specificato", () => {
    expect(applyPipeLimit(list, { limit: "2" })).toHaveLength(2);
    expect(applyPipeLimit(list, { limit: "1" })).toHaveLength(1);
  });

  test("limit maggiore della lista restituisce tutti", () => {
    expect(applyPipeLimit(list, { limit: "100" })).toHaveLength(3);
  });
});

// ===========================================================================
// fetchRankingDailyTickers
// ===========================================================================
describe("fetchRankingDailyTickers", () => {
  beforeEach(() => jest.clearAllMocks());

  test("lancia errore se date non fornita", async () => {
    await expect(
      fetchRankingDailyTickers("http://ts:3013", null, 5000, silentLogger)
    ).rejects.toThrow("score_date is required");
  });

  test("filtra ticker senza atr_14_pct", async () => {
    axios.get = jest.fn().mockResolvedValue({
      data: {
        items: [
          { symbol: "AAPL", reason_json: { atr_14_pct: 1.2, trend: {} } },
          { symbol: "NOATR", reason_json: {} },
        ],
      },
    });
    const result = await fetchRankingDailyTickers("http://ts", "2024-01-15", 5000, silentLogger);
    expect(result.map((r) => r.ticker)).toEqual(["AAPL"]);
  });

  test("filtra ticker con atr_14_pct troppo alto (> maxAtrPct default)", async () => {
    axios.get = jest.fn().mockResolvedValue({
      data: {
        items: [
          { symbol: "AAPL", reason_json: { atr_14_pct: 1.2, trend: {} } },
          { symbol: "VOLATILE", reason_json: { atr_14_pct: 99, trend: {} } },
        ],
      },
    });
    const result = await fetchRankingDailyTickers("http://ts", "2024-01-15", 5000, silentLogger);
    expect(result.map((r) => r.ticker)).toEqual(["AAPL"]);
  });

  test("applica filtro SMA50 se requireSma50=true", async () => {
    axios.get = jest.fn().mockResolvedValue({
      data: {
        items: [
          { symbol: "AAPL", reason_json: { atr_14_pct: 1.2, trend: { price_gt_sma50: true } } },
          { symbol: "BELOW50", reason_json: { atr_14_pct: 1.2, trend: { price_gt_sma50: false } } },
        ],
      },
    });
    const result = await fetchRankingDailyTickers("http://ts", "2024-01-15", 5000, silentLogger, { requireSma50: true });
    expect(result.map((r) => r.ticker)).toEqual(["AAPL"]);
  });

  test("applica filtro SMA200 se requireSma200=true", async () => {
    axios.get = jest.fn().mockResolvedValue({
      data: {
        items: [
          { symbol: "AAPL", reason_json: { atr_14_pct: 1.2, trend: { sma50_gt_sma200: true } } },
          { symbol: "DEATHX", reason_json: { atr_14_pct: 1.2, trend: { sma50_gt_sma200: false } } },
        ],
      },
    });
    const result = await fetchRankingDailyTickers("http://ts", "2024-01-15", 5000, silentLogger, { requireSma200: true });
    expect(result.map((r) => r.ticker)).toEqual(["AAPL"]);
  });

  test("normalizza risposta con data[] invece di items[]", async () => {
    axios.get = jest.fn().mockResolvedValue({
      data: { data: [{ symbol: "MSFT", reason_json: { atr_14_pct: 2.0, trend: {} } }] },
    });
    const result = await fetchRankingDailyTickers("http://ts", "2024-01-15", 5000, silentLogger);
    expect(result[0].ticker).toBe("MSFT");
  });

  test("arricchisce ogni ticker con meta", async () => {
    axios.get = jest.fn().mockResolvedValue({
      data: {
        items: [{ symbol: "AAPL", reason_json: { atr_14_pct: 1.5, price: 180, trend: {} } }],
      },
    });
    const result = await fetchRankingDailyTickers("http://ts", "2024-01-15", 5000, silentLogger);
    expect(result[0].meta.atr_14_pct).toBe(1.5);
    expect(result[0].meta.price).toBe(180);
  });
});

// ===========================================================================
// fetchUserFundamentalsTickers
// ===========================================================================
describe("fetchUserFundamentalsTickers", () => {
  beforeEach(() => jest.clearAllMocks());

  test("restituisce lista normalizzata da data[]", async () => {
    axios.get = jest.fn().mockResolvedValue({
      data: {
        data: [
          { ticker: "AAPL", exchange: "NASDAQ", asset_type: "EQUITY" },
          { ticker: "SPY",  exchange: "NYSE",   is_etf: "1" },
        ],
      },
    });
    const result = await fetchUserFundamentalsTickers("http://ts", 5, {}, null, 5000, silentLogger);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ ticker: "AAPL", exchange: "NASDAQ" });
  });

  test("filtra righe senza ticker", async () => {
    axios.get = jest.fn().mockResolvedValue({
      data: { data: [{ ticker: "", exchange: "NYSE" }, { ticker: "MSFT" }] },
    });
    const result = await fetchUserFundamentalsTickers("http://ts", 5, {}, null, 5000, silentLogger);
    expect(result).toHaveLength(1);
    expect(result[0].ticker).toBe("MSFT");
  });

  test("normalizza is_etf=1 in asset_type=ETF quando asset_type assente", async () => {
    axios.get = jest.fn().mockResolvedValue({
      data: { data: [{ ticker: "SPY", is_etf: "1" }] },
    });
    const result = await fetchUserFundamentalsTickers("http://ts", 5, {}, null, 5000, silentLogger);
    expect(result[0].asset_type).toBe("ETF");
  });

  test("normalizza is_etf=0 in asset_type=EQUITY quando asset_type assente", async () => {
    axios.get = jest.fn().mockResolvedValue({
      data: { data: [{ ticker: "AAPL", is_etf: "0" }] },
    });
    const result = await fetchUserFundamentalsTickers("http://ts", 5, {}, null, 5000, silentLogger);
    expect(result[0].asset_type).toBe("EQUITY");
  });

  test("include il parametro date nella query se specificato", async () => {
    axios.get = jest.fn().mockResolvedValue({ data: { data: [] } });
    await fetchUserFundamentalsTickers("http://ts", 5, {}, "2024-01-15", 5000, silentLogger);
    const url = axios.get.mock.calls[0][0];
    expect(url).toContain("2024-01-15");
  });
});
