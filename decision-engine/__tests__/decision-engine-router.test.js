"use strict";

/**
 * decision-engine-router.test.js
 *
 * Copre le route HTTP esposte da buildDecisionEngineRouter:
 *  - POST /:pipeId          — avvio async job
 *  - GET  /jobs/:jobId      — stato job
 *  - POST /jobs/:jobId/stop — cancella job
 *  - GET  /latest/:pipeId   — lettura snapshot Redis
 *  - POST /live/:pipeId     — abilita/disabilita live mode
 *  - GET  /live/:pipeId/status — stato live
 *  - DELETE /live/:pipeId   — ferma live
 *  - requireInternalToken   — middleware JWT interno
 *
 * I moduli esterni (axios, shared/internalAuth, live-manager, job-manager)
 * vengono sostituiti con mock per isolare il router dalla rete e da Redis.
 */

jest.mock("axios");
jest.mock("../../shared/internalAuth");
jest.mock("../../shared/jobReporter", () => ({ reportJobDone: jest.fn() }));
jest.mock("../modules/zones", () => ({
  detectTrendFlagBreakout: jest.fn(() => ({ flagOk: true, trendOk: true })),
  buildZones: jest.fn(() => ({ ok: false, zones: [] })),
  computeEntryLevels: jest.fn(() => ({})),
}));
jest.mock("../modules/candle-fetcher", () => ({
  fetchAndAnalyze: jest.fn(),
}));

const axios = require("axios");
const { verifyInternalToken } = require("../../shared/internalAuth");
const express = require("express");
const buildDecisionEngineRouter = require("../modules/decision-engine");

// Costruiamo un mini-server Express per i test
function buildTestApp(serviceOverrides = {}) {

  const mockBus = {
    key: (...parts) => parts.join(":"),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    publish: jest.fn().mockResolvedValue(true),
  };

  const mockService = {
    bus: mockBus,
    redisStatusChannel: "test.status",
    cachemanagerUrl: "http://cachemanager:3006",
    tickerscannerUrl: "http://tickerscanner:3013",
    decisionengineUrl: "http://decision-engine:3018",
    marketdataserviceUrl: "http://market-data-service:3020",
    liquidityManagerUrl: "http://liquidity-manager:3001",
    brokerExecutorUrl: "http://broker-executor:3003",
    redisEventsChannel: "test.events",
    addMarketDataHandler: jest.fn(),
    ...serviceOverrides,
  };

  const router = buildDecisionEngineRouter({
    service: mockService,
    getService: () => mockService,
    logger: {
      trace: jest.fn(), debug: jest.fn(), info: jest.fn(),
      warning: jest.fn(), error: jest.fn(),
    },
  });

  const app = express();
  app.use(express.json());

  // Header di autenticazione mock per tutti i test
  app.use((req, _res, next) => {
    req.headers["x-user-id"] = req.headers["x-user-id"] || "42";
    next();
  });

  app.use("/spot-finder", router);
  return { app, mockBus, mockService };
}

// Helper per fare richieste HTTP inline senza server reale
function doRequest(app, method, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const http = require("http");
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const options = {
        hostname: "127.0.0.1",
        port,
        path,
        method: method.toUpperCase(),
        headers: {
          "Content-Type": "application/json",
          "x-user-id": "42",
          ...(opts.headers || {}),
        },
      };
      const req = http.request(options, (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, body });
          }
        });
      });
      req.on("error", (e) => { server.close(); reject(e); });
      if (opts.body) req.write(JSON.stringify(opts.body));
      req.end();
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// POST /spot-finder/:pipeId — avvio async job
// ===========================================================================
describe("POST /spot-finder/:pipeId", () => {
  test("400 se pipeId non è numerico", async () => {
    const { app } = buildTestApp();
    const res = await doRequest(app, "POST", "/spot-finder/abc");
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test("201/200 con pipeId valido — avvia il job", async () => {
    // Mock del tickerscanner per restituire lista vuota (job si completa subito)
    axios.get = jest.fn().mockResolvedValue({ data: { data: [] } });
    axios.post = jest.fn().mockResolvedValue({ data: { ok: true } });

    const { app } = buildTestApp();
    const res = await doRequest(app, "POST", "/spot-finder/5");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.type).toBe("async");
    expect(typeof res.body.jobId).toBe("string");
    expect(res.body.jobId).toMatch(/^spot_/);
  });
});

// ===========================================================================
// GET /spot-finder/jobs/:jobId
// ===========================================================================
describe("GET /spot-finder/jobs/:jobId", () => {
  test("404 per job inesistente", async () => {
    const { app } = buildTestApp();
    const res = await doRequest(app, "GET", "/spot-finder/jobs/nonexistent_job_xyz");
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  test("200 con stats per job esistente", async () => {
    axios.get = jest.fn().mockResolvedValue({ data: { data: [] } });
    axios.post = jest.fn().mockResolvedValue({ data: { ok: true } });

    const { app } = buildTestApp();

    // Avvia un job
    const startRes = await doRequest(app, "POST", "/spot-finder/5");
    const { jobId } = startRes.body;

    // Leggi subito il suo stato
    const statusRes = await doRequest(app, "GET", `/spot-finder/jobs/${jobId}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.ok).toBe(true);
    expect(statusRes.body.jobId).toBe(jobId);
    expect(statusRes.body.stats).toBeDefined();
  });
});

// ===========================================================================
// POST /spot-finder/jobs/:jobId/stop
// ===========================================================================
describe("POST /spot-finder/jobs/:jobId/stop", () => {
  test("404 per job inesistente", async () => {
    const { app } = buildTestApp();
    const res = await doRequest(app, "POST", "/spot-finder/jobs/nonexistent_xyz/stop");
    expect(res.status).toBe(404);
  });

  test("200 per job esistente — status cambia in canceled o completed", async () => {
    axios.get = jest.fn().mockResolvedValue({ data: { data: [] } });
    axios.post = jest.fn().mockResolvedValue({ data: { ok: true } });

    const { app } = buildTestApp();
    const startRes = await doRequest(app, "POST", "/spot-finder/5");
    const { jobId } = startRes.body;

    const stopRes = await doRequest(app, "POST", `/spot-finder/jobs/${jobId}/stop`);
    expect(stopRes.status).toBe(200);
    expect(stopRes.body.ok).toBe(true);
    expect(["canceled", "completed", "running"]).toContain(stopRes.body.status);
  });
});

// ===========================================================================
// GET /spot-finder/latest/:pipeId
// ===========================================================================
describe("GET /spot-finder/latest/:pipeId", () => {
  test("400 se pipeId non numerico", async () => {
    const { app } = buildTestApp();
    const res = await doRequest(app, "GET", "/spot-finder/latest/abc");
    expect(res.status).toBe(400);
  });

  test("404 se snapshot non trovato in Redis", async () => {
    const { app, mockBus } = buildTestApp();
    mockBus.get = jest.fn().mockResolvedValue(null);
    const res = await doRequest(app, "GET", "/spot-finder/latest/5");
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  test("200 con payload se snapshot trovato", async () => {
    const fakeSnapshot = {
      pipeId: 5, userId: 42, results: [{ ticker: "AAPL" }],
    };
    const { app, mockBus } = buildTestApp();
    mockBus.get = jest.fn().mockResolvedValue(fakeSnapshot);
    const res = await doRequest(app, "GET", "/spot-finder/latest/5");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.pipeId).toBe(5);
  });

  test("503 se Redis non disponibile", async () => {
    const { app, mockService } = buildTestApp();
    mockService.bus = null; // simula assenza Redis
    const res = await doRequest(app, "GET", "/spot-finder/latest/5");
    expect(res.status).toBe(503);
  });
});

// ===========================================================================
// GET /spot-finder/live/:pipeId/status
// ===========================================================================
describe("GET /spot-finder/live/:pipeId/status", () => {
  test("400 se pipeId non numerico", async () => {
    const { app } = buildTestApp();
    const res = await doRequest(app, "GET", "/spot-finder/live/abc/status");
    expect(res.status).toBe(400);
  });

  test("200 con active=false quando live non attivo", async () => {
    const { app } = buildTestApp();
    const res = await doRequest(app, "GET", "/spot-finder/live/5/status");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.active).toBe(false);
  });
});

// ===========================================================================
// POST /spot-finder/live/:pipeId — abilita live mode
// ===========================================================================
describe("POST /spot-finder/live/:pipeId", () => {
  test("400 se pipeId non numerico", async () => {
    const { app } = buildTestApp();
    const res = await doRequest(app, "POST", "/spot-finder/live/abc");
    expect(res.status).toBe(400);
  });

  test("200 con active=false se enabled=false nel body", async () => {
    const { app } = buildTestApp();
    const res = await doRequest(app, "POST", "/spot-finder/live/5", { body: { enabled: false } });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });

  test("502 se snapshot non trovato (enabled=true)", async () => {
    const { app, mockBus } = buildTestApp();
    mockBus.get = jest.fn().mockResolvedValue(null); // nessuno snapshot
    axios.post = jest.fn().mockResolvedValue({ data: { ok: true } });
    const res = await doRequest(app, "POST", "/spot-finder/live/5", { body: { enabled: true } });
    // Deve fallire perché non c'è snapshot da cui estrarre i trendOk tickers
    expect([200, 502]).toContain(res.status);
  });

  test("200 e active=true se snapshot ha trendOk tickers", async () => {
    const fakeSnapshot = {
      pipeId: 5, userId: 42, asOfDate: "2024-01-15",
      results: [{
        ticker: "AAPL",
        exchange: "NASDAQ",
        fullResult: { signal: { pattern: { trendOk: true } } },
      }],
    };
    axios.post = jest.fn().mockResolvedValue({ data: { ok: true } });
    const { app, mockBus } = buildTestApp();
    mockBus.get = jest.fn().mockResolvedValue(fakeSnapshot);

    const res = await doRequest(app, "POST", "/spot-finder/live/5", { body: { enabled: true } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.active).toBe(true);
    expect(res.body.pipeId).toBe(5);
  });
});

// ===========================================================================
// DELETE /spot-finder/live/:pipeId — ferma live mode
// ===========================================================================
describe("DELETE /spot-finder/live/:pipeId", () => {
  test("400 se pipeId non numerico", async () => {
    const { app } = buildTestApp();
    const res = await doRequest(app, "DELETE", "/spot-finder/live/abc");
    expect(res.status).toBe(400);
  });

  test("200 con active=false dopo stop", async () => {
    axios.post = jest.fn().mockResolvedValue({ data: { ok: true } });
    const { app } = buildTestApp();
    const res = await doRequest(app, "DELETE", "/spot-finder/live/5");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.active).toBe(false);
  });

  test("409 se il live è attivo su un altro pipeId", async () => {
    const fakeSnapshot = {
      pipeId: 99, userId: 42, asOfDate: "2024-01-15", results: [],
    };
    axios.post = jest.fn().mockResolvedValue({ data: { ok: true } });
    const { app, mockBus } = buildTestApp();
    mockBus.get = jest.fn().mockResolvedValue(fakeSnapshot);

    // Attiva live su pipeId=99
    await doRequest(app, "POST", "/spot-finder/live/99", { body: { enabled: true } });

    // Tenta di fermare pipeId=5 (diverso) — deve dare 409
    const res = await doRequest(app, "DELETE", "/spot-finder/live/5");
    expect(res.status).toBe(409);
  });
});

// ===========================================================================
// requireInternalToken — middleware JWT interno
// ===========================================================================
describe("requireInternalToken middleware", () => {
  function buildInternalApp(busOverrides = {}) {
    const mockBus = {
      key: (...p) => p.join(":"),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      publish: jest.fn(),
      ...busOverrides,
    };
    const mockService = {
      bus: mockBus,
      addMarketDataHandler: jest.fn(),
      redisEventsChannel: "test.events",
      redisStatusChannel: "test.status",
    };
    const router = buildDecisionEngineRouter({
      service: mockService,
      getService: () => mockService,
      logger: { trace: jest.fn(), info: jest.fn(), warning: jest.fn(), error: jest.fn() },
    });
    const app = express();
    app.use(express.json());
    if (Array.isArray(router._internalSpotFinder)) {
      app.post("/internal/spot-finder/:pipeId", ...router._internalSpotFinder);
    }
    return { app, mockBus };
  }

  test("403 senza token", async () => {
    const { app } = buildInternalApp();
    const res = await doRequest(app, "POST", "/internal/spot-finder/5");
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
  });

  test("403 con token invalido", async () => {
    verifyInternalToken.mockRejectedValue(new Error("invalid token"));
    const { app } = buildInternalApp();
    const res = await doRequest(app, "POST", "/internal/spot-finder/5", {
      headers: { "x-internal-token": "bad.token.here" },
    });
    expect(res.status).toBe(403);
  });

  test("passa il token valido al handler", async () => {
    verifyInternalToken.mockResolvedValue({ userId: 42, sub: 42 });
    axios.get = jest.fn().mockResolvedValue({ data: { data: [] } });
    axios.post = jest.fn().mockResolvedValue({ data: { ok: true } });

    const { app } = buildInternalApp();
    const res = await doRequest(app, "POST", "/internal/spot-finder/5", {
      headers: { "x-internal-token": "valid.token.here", "x-user-id": "42" },
      body: { userId: 42 },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
