"use strict";

// Env vars:
// - IBKRGW_BASE_URL (tcp://host:port or host:port)
// - REDIS_URL (fallback redis connection)
const { createClient } = require("redis");
const axios = require("axios");
const WebSocket = require("ws");
const dns = require("dns");
const https = require("https");
const { getConfigString, getConfigBoolean } = require("../../shared/loadSettings");

const REDIS_TICKERS_KEY = "MARKET_DATA:TICKERS";
const REDIS_FIELDS_KEY = "MARKET_DATA:FIELDS";
const REDIS_SNAPSHOT_INTERVAL_KEY = "MARKET_DATA:SNAPSHOT_INTERVAL_MS";
const DEFAULT_SNAPSHOT_INTERVAL_MS = 60000;
const DEFAULT_QUEUE_DELAY_MS = 150;
let moduleInstance = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseIbkrBaseUrl = (raw) => {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const url = new URL(trimmed);
      return {
        host: url.hostname,
        port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
        protocol: url.protocol,
      };
    } catch {
      return null;
    }
  }
  const normalized = trimmed.startsWith("tcp://") ? trimmed.slice(6) : trimmed;
  const [host, portStr] = normalized.split(":");
  const port = Number(portStr);
  if (!host || !Number.isFinite(port)) return null;
  return { host, port, protocol: "http:" };
};

const buildWsUrl = (base) => {
  if (!base) return null;
  let trimmed = String(base).trim();
  if (trimmed.startsWith("tcp://")) {
    trimmed = trimmed.slice(6);
  }
  if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) {
    return `${trimmed.replace(/\/+$/, "")}/v1/api/ws`;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const wsProto = trimmed.startsWith("https://") ? "wss://" : "ws://";
    return `${wsProto}${trimmed.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/v1/api/ws`;
  }
  return `ws://${trimmed.replace(/\/+$/, "")}/v1/api/ws`;
};

const buildHttpBase = (base) => {
  if (!base) return null;
  let trimmed = String(base).trim().replace(/\/+$/, "");
  if (trimmed.startsWith("tcp://")) {
    trimmed = trimmed.slice(6);
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `http://${trimmed}`;
};

const normalizeTickers = (tickers) => {
  if (!Array.isArray(tickers)) return null;
  const cleaned = tickers
    .map((t) => (typeof t === "string" ? t.trim().toUpperCase() : ""))
    .filter(Boolean);
  if (!cleaned.length && tickers.length > 0) return [];
  return Array.from(new Set(cleaned));
};

const createRedisAdapter = async (redisClient, logger) => {
  if (redisClient && typeof redisClient.get === "function" && typeof redisClient.set === "function") {
    return {
      get: (key) => redisClient.get(key),
      set: (key, value) => redisClient.set(key, value),
    };
  }

  const url = getConfigString("REDIS_URL", "redis://redis:6379");
  const client = createClient({ url });
  client.on("error", (err) => {
    logger?.error?.(`[ibkrMarketData] redis error: ${err?.message || String(err)}`);
  });
  await client.connect();
  return {
    get: (key) => client.get(key),
    set: (key, value) => client.set(key, value),
  };
};

class IbkrMarketDataModule {
  constructor({ app, redisClient, redisBus, redisDataChannel, logger }) {
    this.app = app;
    this.logger = logger;
    this.redisClient = redisClient;
    this.redisBus = redisBus;
    this.redisDataChannel = redisDataChannel;

    this.redis = null;
    this.ws = null;
    this.wsConnected = false;
    this.reconnectDelayMs = 1000;
    this.gatewayBaseUrl = null;

    this.queue = [];
    this.queueRunning = false;
    this.queueDelayMs = DEFAULT_QUEUE_DELAY_MS;

    this.currentSubscribedTickers = new Set();
    this.conidByTicker = new Map();
    this.tickerByConid = new Map();
    this.subscribedConids = new Set();
    this.tickCounters = new Map();
    this.lastTickle = null;
    this.lastTickleAt = null;
    this.lastHmdsError = null;
    this.lastAuthStatus = null;
    this.lastHmdsInitAt = null;
    this.lastHmdsInitOk = null;
    this.sessionToken = null;
    this.sessionValue = null;
    this.snapshotTimer = null;
    this.snapshotIntervalMs = null;
    this.lastSnapshotAt = null;
    this.snapshotAlignTimer = null;
    this.mdFields = (getConfigString("MARKET_DATA_FIELDS", "31,84,86"))
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
  }

  async init() {
    this.redis = await createRedisAdapter(this.redisClient, this.logger);
    this._registerRoutes();
  }

  async start() {
    await this._loadFieldsFromRedis();
    await this._loadSnapshotIntervalFromRedis();
    const baseUrl = getConfigString(["IBKRGW_BASE_URL", "IBKR_BASE_URL"], "");
    const parsed = parseIbkrBaseUrl(baseUrl);
    if (!parsed) {
      this.logger?.error?.("[ibkrMarketData] IBKRGW_BASE_URL invalid or missing");
      return;
    }
    this.gatewayBaseUrl = buildHttpBase(baseUrl);
    this._connectGatewayWs(baseUrl);
    await this._loadAndSubscribeFromRedis();
  }

  getSubscribedTickers() {
    return Array.from(this.currentSubscribedTickers);
  }

  async _loadAndSubscribeFromRedis() {
    try {
      const raw = await this.redis.get(REDIS_TICKERS_KEY);
      const parsed = Array.isArray(raw) ? raw : raw ? JSON.parse(raw) : [];
      const normalized = normalizeTickers(parsed) ?? [];
      this._setSubscriptions(normalized, { skipPersist: true });
      this._publishSubscriptions({ added: [], removed: [] });
      this._ensureSnapshotAutoStart();
    } catch (err) {
      this.logger?.error?.(
        `[ibkrMarketData] failed to load tickers from Redis: ${err?.message || String(err)}`
      );
    }
  }

  async _loadFieldsFromRedis() {
    try {
      const raw = await this.redis.get(REDIS_FIELDS_KEY);
      const parsed = Array.isArray(raw) ? raw : raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) {
        this.mdFields = parsed.map((val) => String(val).trim()).filter(Boolean);
        this.logger?.info?.(
          `[ibkrMarketData] loaded ${this.mdFields.length} fields from Redis`
        );
      }
    } catch (err) {
      this.logger?.warning?.(
        `[ibkrMarketData] failed to load fields from Redis: ${err?.message || String(err)}`
      );
    }
  }

  async _loadSnapshotIntervalFromRedis() {
    try {
      const raw = await this.redis.get(REDIS_SNAPSHOT_INTERVAL_KEY);
      const parsed = raw ? parseInt(String(raw), 10) : null;
      if (Number.isFinite(parsed) && parsed >= 60000) {
        this.snapshotIntervalMs = parsed;
      } else {
        this.snapshotIntervalMs = DEFAULT_SNAPSHOT_INTERVAL_MS;
        await this._persistSnapshotInterval(DEFAULT_SNAPSHOT_INTERVAL_MS);
      }
    } catch (err) {
      this.snapshotIntervalMs = DEFAULT_SNAPSHOT_INTERVAL_MS;
      this.logger?.warning?.(
        `[ibkrMarketData] failed to load snapshot interval: ${err?.message || String(err)}`
      );
    }
  }

  async _connectGatewayWs(baseUrl) {
    const wsUrl = buildWsUrl(baseUrl);
    if (!wsUrl) {
      this.logger?.error?.("[ibkrMarketData] WS URL invalid");
      return;
    }

    const httpBase = this.gatewayBaseUrl || buildHttpBase(baseUrl);
    this.logger?.trace?.(
      `[ibkrMarketData] gateway endpoints ws=${wsUrl} http=${httpBase || "-"}`
    );
    this._logGatewayAddress(httpBase);

    if (this.ws) {
      try {
        this.ws.terminate();
      } catch {
        // ignore
      }
    }

    const insecure = getConfigBoolean("IBKR_INSECURE_TLS", false);
    await this._fetchSessionToken();
    const wsHeaders = this.sessionToken ? { Cookie: `api=${this.sessionToken}` } : undefined;
    this.ws = new WebSocket(wsUrl, {
      rejectUnauthorized: !insecure,
      ...(wsHeaders ? { headers: wsHeaders } : {}),
    });

    this.ws.on("open", () => {
      this.wsConnected = true;
      this.reconnectDelayMs = 1000;
      this.logger?.info?.(`[ibkrMarketData] connected to IBKR Gateway ws=${wsUrl}`);
      this._sendSessionToWs();
      this._resubscribeAll();
      this._processQueue();
    });

    this.ws.on("close", () => {
      this.wsConnected = false;
      this.logger?.warning?.("[ibkrMarketData] disconnected from IBKR Gateway");
      this._scheduleReconnect(baseUrl);
    });

    this.ws.on("error", (err) => {
      this.wsConnected = false;
      this.logger?.error?.(
        `[ibkrMarketData] IBKR ws error: ${err?.message || String(err)}`
      );
    });

    this.ws.on("message", (data) => {
      let payload = null;
      try {
        payload = JSON.parse(data.toString());
      } catch {
        payload = null;
      }
      if (!payload) return;
      if (payload?.message === "waiting for session") {
        this.logger?.info?.("[ibkrMarketData] websocket waiting for session");
        this._sendSessionToWs();
        return;
      }
      if (Array.isArray(payload)) {
        payload.forEach((msg) => this._handleWsPayload(msg));
      } else {
        this._handleWsPayload(payload);
      }
    });
  }

  _scheduleReconnect(baseUrl) {
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30000);
    setTimeout(() => {
      this.logger?.info?.(`[ibkrMarketData] reconnecting in ${delay}ms...`);
      this._connectGatewayWs(baseUrl);
    }, delay);
  }

  _registerRoutes() {
    this.app.get("/subscriptions", async (_req, res) => {
      try {
        const raw = await this.redis.get(REDIS_TICKERS_KEY);
        const parsed = Array.isArray(raw) ? raw : raw ? JSON.parse(raw) : [];
        return res.json(parsed);
      } catch (err) {
        this.logger?.error?.(
          `[ibkrMarketData] GET /subscriptions failed: ${err?.message || String(err)}`
        );
        return res.status(500).json({ ok: false, error: "failed to read subscriptions" });
      }
    });

    this.app.post("/subscriptions", async (req, res) => {
      const normalized = normalizeTickers(req?.body?.tickers);
      if (!normalized) {
        return res.status(400).json({ ok: false, error: "tickers must be an array of strings" });
      }

      try {
        await this.redis.set(REDIS_TICKERS_KEY, JSON.stringify(normalized));
      } catch (err) {
        this.logger?.error?.(
          `[ibkrMarketData] redis write failed: ${err?.message || String(err)}`
        );
        return res.status(500).json({ ok: false, error: "failed to save subscriptions" });
      }

      const { added, removed } = this._setSubscriptions(normalized);
      this._ensureSnapshotAutoStart();

      return res.json({
        ok: true,
        subscribed: Array.from(this.currentSubscribedTickers),
        added,
        removed,
      });
    });

    this.app.post("/subscriptions/resubscribe", (_req, res) => {
      this._resubscribeAllWithFields();
      return res.json({
        ok: true,
        subscribed: Array.from(this.currentSubscribedTickers),
      });
    });

    this.app.get("/fields", async (_req, res) => {
      try {
        const raw = await this.redis.get(REDIS_FIELDS_KEY);
        const parsed = Array.isArray(raw) ? raw : raw ? JSON.parse(raw) : null;
        return res.json({ ok: true, fields: parsed || this.mdFields });
      } catch (err) {
        this.logger?.error?.(
          `[ibkrMarketData] GET /fields failed: ${err?.message || String(err)}`
        );
        return res.status(500).json({ ok: false, error: "failed to read fields" });
      }
    });

    this.app.post("/fields", async (req, res) => {
      const incoming = Array.isArray(req?.body?.fields) ? req.body.fields : null;
      if (!incoming) {
        return res.status(400).json({ ok: false, error: "fields must be an array" });
      }
      const normalized = incoming
        .map((val) => String(val).trim())
        .filter(Boolean);
      if (!normalized.length) {
        return res.status(400).json({ ok: false, error: "fields array is empty" });
      }

      try {
        await this.redis.set(REDIS_FIELDS_KEY, JSON.stringify(normalized));
      } catch (err) {
        this.logger?.error?.(
          `[ibkrMarketData] redis write failed (fields): ${err?.message || String(err)}`
        );
        return res.status(500).json({ ok: false, error: "failed to save fields" });
      }

      this.mdFields = normalized;
      this._resubscribeAllWithFields();
      return res.json({ ok: true, fields: normalized });
    });

    this.app.get("/ibkr/status", (_req, res) => {
      return res.json({
        ok: true,
        wsConnected: this.wsConnected,
        lastTickleAt: this.lastTickleAt,
        lastHmdsError: this.lastHmdsError,
        lastAuthStatus: this.lastAuthStatus,
        lastHmdsInitAt: this.lastHmdsInitAt,
        lastHmdsInitOk: this.lastHmdsInitOk,
        snapshot: {
          intervalMs: this.snapshotIntervalMs,
          running: !!this.snapshotTimer,
          lastSnapshotAt: this.lastSnapshotAt,
        },
      });
    });

    this.app.get("/snapshot/loop", (_req, res) => {
      return res.json({
        ok: true,
        intervalMs: this.snapshotIntervalMs,
        running: !!this.snapshotTimer,
        lastSnapshotAt: this.lastSnapshotAt,
      });
    });

    this.app.post("/snapshot/loop", async (req, res) => {
      const raw = req?.body?.intervalMs ?? req?.query?.intervalMs;
      const parsed = parseInt(String(raw ?? ""), 10);
      if (!Number.isFinite(parsed) || parsed < 10000) {
        return res.status(400).json({
          ok: false,
          error: "intervalMs must be >= 10000",
        });
      }
      await this._persistSnapshotInterval(parsed);
      this._startSnapshotLoopAligned(parsed);
      await this._fetchSnapshotOnce();
      return res.json({
        ok: true,
        intervalMs: this.snapshotIntervalMs,
        running: !!this.snapshotTimer,
      });
    });

    this.app.delete("/snapshot/loop", (_req, res) => {
      this._stopSnapshotLoop();
      return res.json({ ok: true });
    });

    this.app.put("/snapshot/interval", async (req, res) => {
      const raw = req?.body?.intervalMs ?? req?.query?.intervalMs;
      const parsed = parseInt(String(raw ?? ""), 10);
      if (!Number.isFinite(parsed) || parsed < 60000) {
        return res.status(400).json({
          ok: false,
          error: "intervalMs must be >= 60000",
        });
      }
      await this._persistSnapshotInterval(parsed);
      if (this.currentSubscribedTickers.size) {
        this._startSnapshotLoopAligned(parsed);
      }
      return res.json({ ok: true, intervalMs: this.snapshotIntervalMs });
    });

    this.app.delete("/subscriptions/:ticker", async (req, res) => {
      const bodyTickers = Array.isArray(req?.body?.tickers) ? req.body.tickers : null;
      const paramTicker = typeof req?.params?.ticker === "string" ? req.params.ticker : "";
      const normalized = normalizeTickers(bodyTickers || (paramTicker ? [paramTicker] : []));

      if (!normalized || normalized.length === 0) {
        return res
          .status(400)
          .json({ ok: false, error: "ticker param or body tickers array is required" });
      }

      let current = Array.from(this.currentSubscribedTickers);
      try {
        const raw = await this.redis.get(REDIS_TICKERS_KEY);
        current = Array.isArray(raw) ? raw : raw ? JSON.parse(raw) : current;
      } catch (err) {
        this.logger?.warning?.(
          `[ibkrMarketData] redis read failed for delete: ${err?.message || String(err)}`
        );
      }

      const currentSet = new Set(
        (normalizeTickers(current) ?? []).map((t) => String(t).toUpperCase())
      );
      const removed = normalized.filter((t) => currentSet.has(t));
      const next = Array.from(new Set(currentSet));
      removed.forEach((t) => {
        const idx = next.indexOf(t);
        if (idx >= 0) next.splice(idx, 1);
      });

      try {
        await this.redis.set(REDIS_TICKERS_KEY, JSON.stringify(next));
      } catch (err) {
        this.logger?.error?.(
          `[ibkrMarketData] redis write failed (delete): ${err?.message || String(err)}`
        );
        return res.status(500).json({ ok: false, error: "failed to save subscriptions" });
      }

      const { added, removed: removedNow } = this._setSubscriptions(next);

      return res.json({
        ok: true,
        subscribed: Array.from(this.currentSubscribedTickers),
        added,
        removed: removedNow.length ? removedNow : removed,
      });
    });
  }

  _setSubscriptions(nextTickers, { skipPersist } = {}) {
    const nextSet = new Set(nextTickers);
    const currentSet = new Set(this.currentSubscribedTickers);

    const added = nextTickers.filter((t) => !currentSet.has(t));
    const removed = Array.from(currentSet).filter((t) => !nextSet.has(t));

    removed.forEach((ticker) => this._enqueue({ type: "unsubscribe", ticker }));
    added.forEach((ticker) => this._enqueue({ type: "subscribe", ticker }));

    this.currentSubscribedTickers = nextSet;

    if (!skipPersist) {
      this.logger?.info?.(
        `[ibkrMarketData] subscriptions updated: added=${added.length} removed=${removed.length}`
      );
    }
    this._publishSubscriptions({ added, removed });
    return { added, removed };
  }

  _publishSubscriptions({ added, removed }) {
    if (!this.redisBus || !this.redisDataChannel) return;
    try {
      this.redisBus.publish(this.redisDataChannel, {
        type: "subscriptions",
        tickers: Array.from(this.currentSubscribedTickers),
        added,
        removed,
      });
    } catch (err) {
      this.logger?.warning?.(
        `[ibkrMarketData] publish subscriptions failed: ${err?.message || String(err)}`
      );
    }
  }

  _publishMarketData(payload) {
    if (!this.redisBus || !this.redisDataChannel) return;
    try {
      const tickers = payload.ticker ? [payload.ticker] : [];
      if (tickers.length > 0) {
        this.logger?.trace?.(
          `[ibkrMarketData] arrivati i dati live per i tickers ${tickers.join(", ")} | ${JSON.stringify({
            ticker: payload.ticker,
            conid: payload.conid,
            dataMode: payload.dataMode,
            payload: payload.payload,
          })}`
        );
      }
      this.redisBus.publish(this.redisDataChannel, {
        type: "marketData",
        ts: Date.now(),
        ...payload,
      });
    } catch (err) {
      this.logger?.warning?.(
        `[ibkrMarketData] publish marketData failed: ${err?.message || String(err)}`
      );
    }
  }

  _logGatewayAddress(httpBase) {
    if (!httpBase) return;
    try {
      const host = new URL(httpBase).hostname;
      dns.lookup(host, (err, address) => {
        if (err) {
          this.logger?.warning?.(
            `[ibkrMarketData] gateway host resolve failed host=${host} err=${err?.message || String(err)}`
          );
          return;
        }
        this.logger?.info?.(
          `[ibkrMarketData] gateway resolved host=${host} ip=${address}`
        );
      });
    } catch (err) {
      this.logger?.warning?.(
        `[ibkrMarketData] gateway resolve error ${err?.message || String(err)}`
      );
    }
  }

  async _fetchSessionToken() {
    const httpBase = this.gatewayBaseUrl;
    if (!httpBase) return null;
    const insecure = getConfigBoolean("IBKR_INSECURE_TLS", false);
    const httpsAgent = insecure ? new https.Agent({ rejectUnauthorized: false }) : undefined;
    try {
      const resp = await axios.get(`${httpBase}/v1/api/tickle`, {
        timeout: 8000,
        httpsAgent,
      });
      this.lastTickle = resp?.data || null;
      this.lastTickleAt = new Date().toISOString();
      this.lastHmdsError = resp?.data?.hmds?.error || null;
      this.lastAuthStatus = resp?.data?.iserver?.authStatus || null;
      if (this.lastHmdsError) {
        this.logger?.warning?.(
          `[ibkrMarketData] HMDS error=${this.lastHmdsError} (market data bridge not ready)`
        );
      }
      this.logger?.trace?.(
        `[ibkrMarketData] tickle response status=${resp?.status ?? "-"} data=${JSON.stringify(
          resp?.data || {}
        )}`
      );
      const session = resp?.data?.session;
      if (!session) {
        this.logger?.warning?.(
          `[ibkrMarketData] tickle without session: ${JSON.stringify(resp?.data || {})}`
        );
        return null;
      }
      this.sessionValue = String(session);
      this.sessionToken = JSON.stringify({ session: this.sessionValue });
      return this.sessionValue;
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      this.logger?.warning?.(
        `[ibkrMarketData] tickle failed status=${status ?? "-"} data=${JSON.stringify(data || {})}`
      );
      return null;
    }
  }

  async _sendSessionToWs() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.sessionValue) {
      await this._fetchSessionToken();
    }
    if (!this.sessionValue) return;
    this.ws.send(JSON.stringify({ session: this.sessionValue }));
    this.logger?.info?.("[ibkrMarketData] websocket session sent");
    await this._ensureHmdsInit();
    await this._setMarketDataType();
  }

  async _ensureHmdsInit() {
    const httpBase = this.gatewayBaseUrl;
    if (!httpBase) return;
    const insecure = getConfigBoolean("IBKR_INSECURE_TLS", false);
    const httpsAgent = insecure ? new https.Agent({ rejectUnauthorized: false }) : undefined;
    try {
      const resp = await axios.get(`${httpBase}/v1/api/hmds/auth/init`, {
        timeout: 8000,
        httpsAgent,
      });
      this.lastHmdsInitAt = new Date().toISOString();
      this.lastHmdsInitOk = resp.status >= 200 && resp.status < 300;
      this.logger?.info?.(
        `[ibkrMarketData] hmds auth init status=${resp.status} ok=${this.lastHmdsInitOk}`
      );
    } catch (err) {
      this.lastHmdsInitAt = new Date().toISOString();
      this.lastHmdsInitOk = false;
      const status = err?.response?.status;
      const data = err?.response?.data;
      this.logger?.warning?.(
        `[ibkrMarketData] hmds auth init failed status=${status ?? "-"} data=${JSON.stringify(data || {})}`
      );
    }
  }

  async _setMarketDataType() {
    const httpBase = this.gatewayBaseUrl;
    if (!httpBase) return;
    const insecure = getConfigBoolean("IBKR_INSECURE_TLS", false);
    const httpsAgent = insecure ? new https.Agent({ rejectUnauthorized: false }) : undefined;
    try {
      const resp = await axios.post(
        `${httpBase}/v1/api/iserver/marketdata/type`,
        { marketDataType: 1 },
        {
          timeout: 8000,
          httpsAgent,
          headers: { "Content-Type": "application/json" },
        }
      );
      this.logger?.log?.(
        `[ibkrMarketData] market data type set to 1 (live) | status=${resp.status} response=${JSON.stringify(resp?.data || {})}`
      );
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      this.logger?.warning?.(
        `[ibkrMarketData] failed to set market data type | status=${status ?? "-"} data=${JSON.stringify(data || {})}`
      );
    }
  }

  _traceTick(ticker, type, payload) {
    if (!this.logger?.trace) return;
    const key = `${ticker}:${type}`;
    const count = (this.tickCounters.get(key) || 0) + 1;
    this.tickCounters.set(key, count);
    if (count <= 5 || count % 200 === 0) {
      this.logger.trace(`[ibkrMarketData] ${type} ${ticker}`, {
        count,
        ...payload,
      });
    }
  }

  async _resolveConid(ticker) {
    const cached = this.conidByTicker.get(ticker);
    if (cached) return cached;
    const bridgeUrl = (
      getConfigString(["IBKR_BRIDGE_URL", "IBKRBRIDGE_URL"], "http://ibkr-bridge:3017")
    ).replace(/\/+$/, "");
    const url = `${bridgeUrl}/mirror/iserver/secdef/search?symbol=${encodeURIComponent(
      ticker
    )}&name=true`;
    try {
      const resp = await axios.get(url, { timeout: 8000 });
      const list = Array.isArray(resp?.data) ? resp.data : [];
      const item = list[0] || null;
      const conid = item?.conid || item?.conidEx || null;
      if (!conid) {
        this.logger?.warning?.(`[ibkrMarketData] conid not found for ${ticker}`);
        return null;
      }
      this.conidByTicker.set(ticker, String(conid));
      this.tickerByConid.set(String(conid), ticker);
      return String(conid);
    } catch (err) {
      this.logger?.warning?.(
        `[ibkrMarketData] conid lookup failed for ${ticker}: ${err?.message || String(err)}`
      );
      return null;
    }
  }

  _handleWsPayload(msg) {
    if (!msg || typeof msg !== "object") return;
    const conid =
      msg?.conid ||
      msg?.contract_id ||
      (typeof msg?.topic === "string" && msg.topic.includes("smd+")
        ? msg.topic.split("smd+")[1]
        : null);
    const ticker = conid ? this.tickerByConid.get(String(conid)) : null;
    if (ticker) {
      this._publishMarketData({ ticker, conid, payload: msg, dataMode: "live" });
      this._traceTick(ticker, "smd", { conid });
    }
  }

  _enqueue(task) {
    this.queue.push(task);
    this._processQueue();
  }

  async _processQueue() {
    if (this.queueRunning || !this.wsConnected) return;
    this.queueRunning = true;
    while (this.queue.length && this.wsConnected) {
      const task = this.queue.shift();
      try {
        if (task.type === "subscribe") await this._subscribeTicker(task.ticker);
        if (task.type === "unsubscribe") await this._unsubscribeTicker(task.ticker);
      } catch (err) {
        this.logger?.error?.(
          `[ibkrMarketData] queue task failed: ${err?.message || String(err)}`
        );
      }
      await sleep(this.queueDelayMs);
    }
    this.queueRunning = false;
  }

  async _subscribeTicker(ticker) {
    if (!this.wsConnected || !this.ws) return;
    const conid = await this._resolveConid(ticker);
    if (!conid) return;
    if (this.subscribedConids.has(conid)) return;
    const msg = `smd+${conid}+${JSON.stringify({ fields: this.mdFields })}`;
    this.ws.send(msg);
    this.subscribedConids.add(conid);
    this.logger?.info?.(`[ibkrMarketData] subscribe ${ticker} (conid=${conid})`);
  }

  async _unsubscribeTicker(ticker) {
    if (!this.wsConnected || !this.ws) return;
    const conid = this.conidByTicker.get(ticker);
    if (!conid) return;
    const msg = `umd+${conid}+{}`;
    this.ws.send(msg);
    this.subscribedConids.delete(conid);
    this.logger?.info?.(`[ibkrMarketData] unsubscribe ${ticker} (conid=${conid})`);
  }

  _resubscribeAllWithFields() {
    const tickers = Array.from(this.currentSubscribedTickers);
    if (!tickers.length) return;
    for (const conid of Array.from(this.subscribedConids)) {
      this.ws?.send?.(`umd+${conid}+{}`);
    }
    this.subscribedConids.clear();
    tickers.forEach((ticker) => this._enqueue({ type: "subscribe", ticker }));
    this.logger?.info?.(
      `[ibkrMarketData] resubscribe requested for ${tickers.length} tickers (fields updated)`
    );
  }

  _startSnapshotLoopAligned(intervalMs) {
    this._stopSnapshotLoop();
    this.snapshotIntervalMs = intervalMs;
    const now = Date.now();
    const nextTick = Math.ceil(now / intervalMs) * intervalMs;
    const delay = Math.max(0, nextTick - now);
    this.snapshotAlignTimer = setTimeout(() => {
      this._fetchSnapshotOnce();
      this.snapshotTimer = setInterval(() => {
        this._fetchSnapshotOnce();
      }, intervalMs);
      this.snapshotAlignTimer = null;
    }, delay);
    this.logger?.info?.(
      `[ibkrMarketData] snapshot loop started intervalMs=${intervalMs} alignDelayMs=${delay}`
    );
  }

  _stopSnapshotLoop() {
    if (this.snapshotAlignTimer) {
      clearTimeout(this.snapshotAlignTimer);
      this.snapshotAlignTimer = null;
    }
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
      this.logger?.info?.("[ibkrMarketData] snapshot loop stopped");
    }
    this.snapshotIntervalMs = null;
  }

  async _persistSnapshotInterval(intervalMs) {
    try {
      await this.redis.set(REDIS_SNAPSHOT_INTERVAL_KEY, String(intervalMs));
      this.snapshotIntervalMs = intervalMs;
    } catch (err) {
      this.logger?.warning?.(
        `[ibkrMarketData] failed to save snapshot interval: ${err?.message || String(err)}`
      );
    }
  }

  _ensureSnapshotAutoStart() {
    if (!this.currentSubscribedTickers.size) {
      this.logger?.info?.("[ibkrMarketData] _ensureSnapshotAutoStart: no tickers subscribed, snapshot loop not started");
      return;
    }
    const interval = this.snapshotIntervalMs || DEFAULT_SNAPSHOT_INTERVAL_MS;
    if (!this.snapshotTimer && !this.snapshotAlignTimer) {
      this.logger?.info?.(
        `[ibkrMarketData] _ensureSnapshotAutoStart: starting loop intervalMs=${interval} tickers=${this.currentSubscribedTickers.size}`
      );
      this._startSnapshotLoopAligned(interval);
    } else {
      this.logger?.info?.(
        `[ibkrMarketData] _ensureSnapshotAutoStart: loop already running intervalMs=${this.snapshotIntervalMs} tickers=${this.currentSubscribedTickers.size}`
      );
    }
  }

  async _fetchSnapshotOnce() {
    const tickers = Array.from(this.currentSubscribedTickers);
    if (!tickers.length) {
      this.logger?.info?.("[ibkrMarketData] snapshot skipped: no subscribed tickers");
      return;
    }

    this.logger?.info?.(
      `[ibkrMarketData] snapshot requested: tickers=${tickers.join(",")} count=${tickers.length}`
    );

    for (const ticker of tickers) {
      await this._resolveConid(ticker);
    }

    const conids = Array.from(this.subscribedConids);
    if (!conids.length) {
      this.logger?.warning?.(
        `[ibkrMarketData] snapshot aborted: ${tickers.length} tickers subscribed but no conids resolved (check ibkr-bridge connectivity or secdef lookup)`
      );
      return;
    }

    const unresolvedTickers = tickers.filter((t) => !this.conidByTicker.has(t));
    if (unresolvedTickers.length) {
      this.logger?.warning?.(
        `[ibkrMarketData] snapshot: ${unresolvedTickers.length} tickers without conid: ${unresolvedTickers.join(",")}`
      );
    }

    this.logger?.info?.(
      `[ibkrMarketData] snapshot request to ibkr-bridge: conids=${conids.join(",")} fields=${this.mdFields.join(",")}`
    );

    const bridgeUrl = (
      getConfigString(["IBKR_BRIDGE_URL", "IBKRBRIDGE_URL"], "http://ibkr-bridge:3017")
    ).replace(/\/+$/, "");
    try {
      const resp = await axios.get(`${bridgeUrl}/mirror/iserver/marketdata/snapshot`, {
        params: {
          conids: conids.join(","),
          fields: this.mdFields.join(","),
        },
        timeout: 8000,
      });
      const items = Array.isArray(resp?.data) ? resp.data : [];
      this.lastSnapshotAt = new Date().toISOString();

      if (!items.length) {
        this.logger?.warning?.(
          `[ibkrMarketData] snapshot returned 0 items for ${conids.length} conids — IBKR may not have data ready yet (first request after subscribe often returns empty)`
        );
      } else {
        this.logger?.info?.(
          `[ibkrMarketData] snapshot received ${items.length} items at ${this.lastSnapshotAt}`
        );
      }

      let published = 0;
      items.forEach((item) => {
        const conid = String(item?.conid || item?.conidEx || "");
        const ticker = this.tickerByConid.get(conid);
        if (!ticker) {
          this.logger?.warning?.(
            `[ibkrMarketData] snapshot item with unknown conid=${conid}, skipping`
          );
          return;
        }
        this._publishMarketData({ ticker, conid, payload: item, dataMode: "snapshot" });
        published++;
      });

      if (items.length && published === 0) {
        this.logger?.warning?.(
          `[ibkrMarketData] snapshot: ${items.length} items received but 0 published (no ticker matched any conid in tickerByConid map)`
        );
      } else if (published > 0) {
        this.logger?.info?.(
          `[ibkrMarketData] snapshot published ${published}/${items.length} items to channel=${this.redisDataChannel}`
        );
      }
    } catch (err) {
      this.logger?.warning?.(
        `[ibkrMarketData] snapshot request failed: ${err?.message || String(err)}`
      );
    }
  }

  async _resubscribeAll() {
    const tickers = Array.from(this.currentSubscribedTickers);
    for (const ticker of tickers) {
      await this._subscribeTicker(ticker);
    }
  }
}

module.exports = {
  init: async ({ app, redisClient, redisBus, redisDataChannel, logger }) => {
    moduleInstance = new IbkrMarketDataModule({
      app,
      redisClient,
      redisBus,
      redisDataChannel,
      logger,
    });
    await moduleInstance.init();
    return moduleInstance;
  },
  start: async () => {
    if (!moduleInstance) return;
    await moduleInstance.start();
  },
  getSubscribedTickers: () =>
    moduleInstance ? moduleInstance.getSubscribedTickers() : [],
};
