// modules/connectivity.js
"use strict";

const axios = require("axios");
const https = require("https");
const { asBool, asInt } = require("../../shared/helpers");

class IbkrConnectivity {
  constructor({
    logger,
    getSetting,
    publishTelemetry,
    publishHook,
    getEnv,
    getStatus,
  }) {
    this.logger = logger;
    this.getSetting = getSetting;
    this.publishTelemetry = publishTelemetry;
    this.publishHook = publishHook;
    this.getEnv = getEnv;
    this.getStatus = getStatus;
    this._timer = null;
    this._running = false;
    this._lastIntervalMs = null;
    this._client = null;
    this._reauthInFlight = null;
    this._disconnectHookSent = false;
    this.state = {
      gwStatus: "GW_DOWN",
      gwStatusCode: null,
      gwError: null,
      baseUrl: null,
      insecureTls: false,
      authenticated: false,
      connected: false,
      authStatusCode: null,
      authError: null,
      lastAuthPayload: null,
      lastAuthAt: null,
      lastTickleAt: null,
      lastTickleStatus: null,
      lastTickleError: null,
      lastTicklePayload: null,
      lastCheckAt: null,
      lastSsodhInitAt: null,
      lastSsodhInitStatus: null,
      lastSsodhInitOk: null,
      lastSsodhInitError: null,
      lastSsodhInitPayload: null,
    };
  }

  async _emitAuth401Telemetry() {
    if (typeof this.publishTelemetry !== "function") return;
    const payload = {
      type: "keepalive",
      ts: Date.now(),
      env: typeof this.getEnv === "function" ? this.getEnv() : process.env.ENV || "DEV",
      status: typeof this.getStatus === "function" ? this.getStatus() : null,
      lastAuthStatus: this.state.authStatusCode ?? 401,
      lastTickleStatus: this.state.lastTickleStatus,
      lastTickleAt: this.state.lastTickleAt,
      __source: "ibkr-bridge",
    };
    try {
      await this.publishTelemetry(payload);
      this.logger.trace?.("[connectivity] telemetry published (401)");
    } catch (err) {
      this.logger.warning?.(
        `[connectivity] telemetry publish failed: ${err?.message || String(err)}`
      );
    }
  }

  async _emitSsodhTelemetry(result) {
    if (typeof this.publishTelemetry !== "function") return;
    const payload = {
      type: "ssodhInit",
      ts: Date.now(),
      env: typeof this.getEnv === "function" ? this.getEnv() : process.env.ENV || "DEV",
      status: typeof this.getStatus === "function" ? this.getStatus() : null,
      ssodhInit: result || null,
      lastSsodhInitAt: this.state.lastSsodhInitAt,
      __source: "ibkr-bridge",
    };
    try {
      await this.publishTelemetry(payload);
      this.logger.trace?.("[connectivity] telemetry published (ssodh)");
    } catch (err) {
      this.logger.warning?.(
        `[connectivity] telemetry publish failed (ssodh): ${err?.message || String(err)}`
      );
    }
  }

  async _emitCombinedTelemetry() {
    if (typeof this.publishTelemetry !== "function") return;
    const payload = {
      type: "telemetry",
      ts: Date.now(),
      env: typeof this.getEnv === "function" ? this.getEnv() : process.env.ENV || "DEV",
      status: typeof this.getStatus === "function" ? this.getStatus() : null,
      authStatus: {
        status: this.state.authStatusCode,
        data: this.state.lastAuthPayload,
        error: this.state.authError,
        at: this.state.lastAuthAt,
      },
      tickle: {
        status: this.state.lastTickleStatus,
        data: this.state.lastTicklePayload,
        error: this.state.lastTickleError,
        at: this.state.lastTickleAt,
      },
      ssodhInit: this.state.lastSsodhInitPayload,
      lastSsodhInitAt: this.state.lastSsodhInitAt,
      __source: "ibkr-bridge",
    };
    try {
      await this.publishTelemetry(payload);
      this.logger.trace?.("[connectivity] telemetry published (combined)");
    } catch (err) {
      this.logger.warning?.(
        `[connectivity] telemetry publish failed (combined): ${err?.message || String(err)}`
      );
    }
  }

  async _emitFirstDisconnectionHookIfNeeded() {
    const ssodhAuthStatus = this.state?.lastSsodhInitPayload?.authStatus?.status;
    const disconnected = Number(ssodhAuthStatus) === 401;
    const reconnected =
      Number(this.state.authStatusCode) === 200 &&
      this.state.authenticated === true &&
      this.state.connected === true;

    if (reconnected && this._disconnectHookSent) {
      this._disconnectHookSent = false;
      this.logger.info(
        "[connectivity] connection restored: disconnection hook flag reset"
      );
    }

    if (!disconnected || this._disconnectHookSent) {
      return;
    }

    if (typeof this.publishHook !== "function") {
      this.logger.warning?.(
        "[connectivity] publishHook missing: cannot publish disconnection hook"
      );
      return;
    }

    const payload = {
      severity: "warning",
      message:
        "IBKR disconnected: auth status is 401 during ssodh init/auth check",
      authStatus: {
        status: this.state.authStatusCode,
        data: this.state.lastAuthPayload,
        error: this.state.authError,
        at: this.state.lastAuthAt,
      },
      tickle: {
        status: this.state.lastTickleStatus,
        data: this.state.lastTicklePayload,
        error: this.state.lastTickleError,
        at: this.state.lastTickleAt,
      },
      ssodhInit: this.state.lastSsodhInitPayload || null,
      lastSsodhInitAt: this.state.lastSsodhInitAt || null,
    };

    try {
      await this.publishHook("IBKR.AUTH.DISCONNECTED", payload);
      this._disconnectHookSent = true;
      this.logger.warning?.(
        "[connectivity] hook published: IBKR.AUTH.DISCONNECTED"
      );
    } catch (err) {
      this.logger.warning?.(
        `[connectivity] disconnection hook publish failed: ${err?.message || String(err)}`
      );
    }
  }

  _readSettings() {
    const baseUrl =
      this.getSetting?.("IBKRGW_BASE_URL") ||
      process.env.IBKRGW_BASE_URL ||
      this.getSetting?.("IBKR_BASE_URL") ||
      process.env.IBKR_BASE_URL ||
      "";
    const ssoDispatcherUrl =
      this.getSetting?.("IBKRGW_SSO_URL") ||
      process.env.IBKRGW_SSO_URL ||
      "http://ibkrgw-paper:5000/sso/Dispatcher?hardware_info=eyJpZCI6IjNjYzU0NWJmIiwibWFjIjoiMTY6RUY6QUY6NkQ6QzY6OUEifQ%3D%3D";
    const insecureTls = asBool(
      this.getSetting?.("IBKR_INSECURE_TLS") ?? process.env.IBKR_INSECURE_TLS,
      false
    );
    const tickleIntervalMs = asInt(
      this.getSetting?.("TICKLE_INTERVAL_MS") ?? process.env.TICKLE_INTERVAL_MS,
      50000
    );
    const authCheckIntervalMs = asInt(
      this.getSetting?.("AUTH_CHECK_INTERVAL_MS") ?? process.env.AUTH_CHECK_INTERVAL_MS,
      15000
    );
    const requestTimeoutMs = asInt(
      this.getSetting?.("IBKR_REQUEST_TIMEOUT_MS") ?? process.env.IBKR_REQUEST_TIMEOUT_MS,
      20000
    );
    const ssodhInitIntervalMs = asInt(
      this.getSetting?.("IBKR_SSODH_INIT_INTERVAL_MS") ?? process.env.IBKR_SSODH_INIT_INTERVAL_MS,
      60000
    );
    return {
      baseUrl,
      insecureTls,
      tickleIntervalMs,
      authCheckIntervalMs,
      ssoDispatcherUrl,
      requestTimeoutMs,
      ssodhInitIntervalMs,
    };
  }

  _buildClient(baseUrl, insecureTls, requestTimeoutMs) {
    const config = {
      baseURL: baseUrl,
      timeout: requestTimeoutMs,
      validateStatus: () => true,
    };
    if (baseUrl.startsWith("https://")) {
      config.httpsAgent = new https.Agent({
        rejectUnauthorized: !insecureTls,
        keepAlive: true,
      });
    }
    return axios.create(config);
  }

  _syncClient(settings) {
    const { baseUrl, insecureTls, requestTimeoutMs } = settings;
    if (!baseUrl) {
      this._client = null;
      return;
    }
    if (
      this.state.baseUrl !== baseUrl ||
      this.state.insecureTls !== insecureTls ||
      this.state.requestTimeoutMs !== requestTimeoutMs ||
      !this._client
    ) {
      this._client = this._buildClient(baseUrl, insecureTls, requestTimeoutMs);
    }
    this.state.baseUrl = baseUrl;
    this.state.insecureTls = insecureTls;
    this.state.requestTimeoutMs = requestTimeoutMs;
  }

  async _ensureReauth(settings) {
    if (this._reauthInFlight) {
      await this._reauthInFlight;
      return;
    }
    const { ssoDispatcherUrl, requestTimeoutMs } = settings || this._readSettings();
    if (!ssoDispatcherUrl) return;
    this._reauthInFlight = (async () => {
      try {
        this.logger.info(`[connectivity] sso reauth url=${ssoDispatcherUrl}`);
        const resp = await axios.get(ssoDispatcherUrl, {
          timeout: requestTimeoutMs,
          validateStatus: () => true,
        });
        if (resp.status === 200) {
          this.logger.trace?.(
            `[connectivity] sso reauth ok status=${resp.status}`
          );
        } else {
          this.logger.error(
            `[connectivity] sso reauth failed status=${resp.status} payload=${JSON.stringify(resp.data ?? null)}`
          );
        }
      } catch (err) {
        this.logger.warning(
          `[connectivity] sso reauth failed: ${err?.message || String(err)}`
        );
      }
    })();
    try {
      await this._reauthInFlight;
    } finally {
      this._reauthInFlight = null;
    }
  }

  async _requestWithReauth(config) {
    const settings = this._readSettings();
    this._syncClient(settings);
    if (!this._client) {
      return { status: null, data: null };
    }

    const resp = await this._client.request(config);
    if (resp?.status === 401) {
      await this._ensureReauth(settings);
      return this._client.request(config);
    }
    return resp;
  }

  start() {
    if (this._timer) return;
    const settings = this._readSettings();
    this.logger.info(
      `[connectivity] IBKRGW_BASE_URL=${settings.baseUrl || "-"} insecureTls=${settings.insecureTls}`
    );
    this._tick();
    const { authCheckIntervalMs } = this._readSettings();
    this._lastIntervalMs = authCheckIntervalMs;
    this._timer = setInterval(() => this._tick(), authCheckIntervalMs);
    this.logger.info(
      `[connectivity] loop started intervalMs=${authCheckIntervalMs}`
    );
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  getState() {
    return { ...this.state };
  }

  async _tick() {
    if (this._running) {
      this.logger.trace?.("[connectivity] tick skipped: already running");
      return;
    }
    const startedAt = Date.now();
    this._running = true;
    try {
      const settings = this._readSettings();
      if (settings.authCheckIntervalMs !== this._lastIntervalMs) {
        if (this._timer) clearInterval(this._timer);
        this._lastIntervalMs = settings.authCheckIntervalMs;
        this._timer = setInterval(() => this._tick(), settings.authCheckIntervalMs);
        this.logger.info(
          `[connectivity] interval updated intervalMs=${settings.authCheckIntervalMs}`
        );
      }

      this._syncClient(settings);
      this.state.lastCheckAt = new Date().toISOString();

      if (!settings.baseUrl) {
        this.state.gwStatus = "GW_DOWN";
        this.state.gwStatusCode = null;
        this.state.gwError = "IBKR_BASE_URL missing";
        this.state.authenticated = false;
        this.state.connected = false;
        return;
      }

      await this._checkGateway();
      await this._checkAuth();
      await this._tickleIfDue(settings.tickleIntervalMs);
      await this._ssodhInitIfDue(settings.ssodhInitIntervalMs);
      await this._emitFirstDisconnectionHookIfNeeded();
      await this._emitCombinedTelemetry();
    } catch (err) {
      this.logger.error(
        `[connectivity] tick error: ${err?.message || String(err)}`
      );
    } finally {
      const elapsedMs = Date.now() - startedAt;
      this.logger.trace?.(
        `[connectivity] tick done elapsedMs=${elapsedMs}`
      );
      this._running = false;
    }
  }

  _isNetworkDownError(err) {
    const code = err?.code;
    return (
      code === "ENOTFOUND" ||
      code === "ECONNREFUSED" ||
      code === "ETIMEDOUT" ||
      code === "EAI_AGAIN"
    );
  }

  async _checkGateway() {
    // No GET / check: consider gateway up if baseUrl is configured.
    this.state.gwStatusCode = 200;
    this.state.gwStatus = "GW_UP";
    this.state.gwError = null;
  }

  async _checkAuth() {
    try {
      const resp = await this._requestWithReauth({
        method: "GET",
        url: "/v1/api/iserver/auth/status",
      });
      this.state.authStatusCode = resp.status;
      this.state.authError = null;
      if (resp.status === 200 && resp.data) {
        this.state.authenticated = !!resp.data.authenticated;
        this.state.connected = !!resp.data.connected;
        this.state.lastAuthPayload = resp.data ?? null;
      } else {
        this.state.authenticated = false;
        this.state.connected = false;
        this.state.lastAuthPayload = resp.data ?? null;
      }
    } catch (err) {
      this.state.authStatusCode = null;
      this.state.authError = err?.message || String(err);
      this.state.authenticated = false;
      this.state.connected = false;
      this.state.lastAuthPayload = null;
    }

    if (
      this.state.gwStatusCode === 200 &&
      typeof this.state.authStatusCode === "number" &&
      this.state.authStatusCode >= 400 &&
      this.state.authStatusCode < 500
    ) {
      this.state.gwStatus = "GW_NO_AUTH";
    }

    this.state.lastAuthAt = new Date().toISOString();
  }


  async getAccount(accountId) {
    const settings = this._readSettings();
    this._syncClient(settings);
    if (!settings.baseUrl || !this._client) {
      return {
        ok: false,
        status: null,
        data: null,
        error: "IBKR_BASE_URL missing",
      };
    }

    if (!accountId) {
      return {
        ok: false,
        status: 400,
        data: null,
        error: "accountId missing",
      };
    }

    const safeId = encodeURIComponent(String(accountId));

    try {
      const summaryResp = await this._requestWithReauth({
        method: "GET",
        url: `/v1/api/portfolio/${safeId}/summary`,
      });
      const summaryOk = summaryResp.status >= 200 && summaryResp.status < 300;
      if (!summaryOk) {
        return {
          ok: false,
          status: summaryResp.status,
          data: summaryResp.data ?? null,
          error: "IBKR summary request failed",
        };
      }

      let performance = null;
      let performanceError = null;

      try {
        const perfResp = await this._requestWithReauth({
          method: "GET",
          url: "/v1/api/pa/performance",
          params: { acctId: accountId, accountId },
        });
        const perfOk = perfResp.status >= 200 && perfResp.status < 300;
        if (perfOk) {
          performance = perfResp.data ?? null;
        } else {
          performanceError = {
            status: perfResp.status,
            error: "IBKR performance request failed",
            data: perfResp.data ?? null,
          };
        }
      } catch (err) {
        performanceError = {
          status: null,
          error: err?.message || String(err),
        };
      }

      return {
        ok: true,
        status: summaryResp.status,
        data: {
          accountId,
          summary: summaryResp.data ?? null,
          performance,
          performanceError,
        },
        error: null,
      };
    } catch (err) {
      return {
        ok: false,
        status: null,
        data: null,
        error: err?.message || String(err),
      };
    }
  }

  async getAccounts() {
    const settings = this._readSettings();
    this._syncClient(settings);
    if (!settings.baseUrl || !this._client) {
      return {
        ok: false,
        status: null,
        data: null,
        error: "IBKR_BASE_URL missing",
      };
    }

    try {
      const resp = await this._requestWithReauth({
        method: "GET",
        url: "/v1/api/portfolio/accounts",
      });
      return {
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        data: resp.data ?? null,
        error: null,
      };
    } catch (err) {
      return {
        ok: false,
        status: null,
        data: null,
        error: err?.message || String(err),
      };
    }
  }

  async getAuthStatus() {
    const settings = this._readSettings();
    this._syncClient(settings);
    if (!settings.baseUrl || !this._client) {
      return {
        ok: false,
        status: null,
        data: null,
        error: "IBKR_BASE_URL missing",
      };
    }

    try {
      const resp = await this._requestWithReauth({
        method: "GET",
        url: "/v1/api/iserver/auth/status",
      });
      return {
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        data: resp.data ?? null,
        error: null,
      };
    } catch (err) {
      return {
        ok: false,
        status: null,
        data: null,
        error: err?.message || String(err),
      };
    }
  }

  async proxyIbkr(pathFragment, { method = "GET", params, data, headers } = {}) {
    const settings = this._readSettings();
    this._syncClient(settings);
    if (!settings.baseUrl || !this._client) {
      return {
        ok: false,
        status: null,
        data: null,
        error: "IBKR_BASE_URL missing",
      };
    }

    const raw = String(pathFragment ?? "").trim();
    if (!raw) {
      return {
        ok: false,
        status: 400,
        data: null,
        error: "path missing",
      };
    }

    const cleaned = raw.replace(/^\/+/, "");
    const prefix = "v1/api/";
    const targetPath = cleaned.startsWith(prefix)
      ? `/${cleaned}`
      : `/v1/api/${cleaned}`;

    try {
      const resp = await this._requestWithReauth({
        url: targetPath,
        method,
        params,
        data,
        headers,
      });
      return {
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        data: resp.data ?? null,
        error: null,
      };
    } catch (err) {
      return {
        ok: false,
        status: null,
        data: null,
        error: err?.message || String(err),
      };
    }
  }

  async initIserverBridge() {
    const settings = this._readSettings();
    this._syncClient(settings);
    if (!settings.baseUrl || !this._client) {
      return {
        ok: false,
        status: null,
        data: null,
        error: "IBKR_BASE_URL missing",
      };
    }

    try {
      const statusResp = await this._requestWithReauth({
        method: "GET",
        url: "/v1/api/iserver/auth/status",
      });
      const statusOk = statusResp.status >= 200 && statusResp.status < 300;
      if (!statusOk) {
        return {
          ok: false,
          status: statusResp.status,
          data: statusResp.data ?? null,
          error: "IBKR auth status failed",
        };
      }

      const initResp = await this._requestWithReauth({
        method: "POST",
        url: "/v1/api/iserver/auth/ssodh/init",
      });
      const initOk = initResp.status >= 200 && initResp.status < 300;
      if (!initOk) {
        return {
          ok: false,
          status: initResp.status,
          data: initResp.data ?? null,
          error: "IBKR ssodh init failed",
        };
      }

      return {
        ok: true,
        status: initResp.status,
        data: {
          authStatus: statusResp.data ?? null,
          ssodhInit: initResp.data ?? null,
        },
        error: null,
      };
    } catch (err) {
      return {
        ok: false,
        status: null,
        data: null,
        error: err?.message || String(err),
      };
    }
  }

  async _tickleIfDue(intervalMs) {
    const now = Date.now();
    const last = this.state.lastTickleAt ? new Date(this.state.lastTickleAt).getTime() : 0;
    if (now - last < intervalMs) return;
    try {
      const startedAt = Date.now();
      const resp = await this._requestWithReauth({
        method: "POST",
        url: "/v1/api/tickle",
      });
      const elapsedMs = Date.now() - startedAt;
      this.state.lastTickleStatus = resp.status;
      this.state.lastTicklePayload = resp.data ?? null;
      this.state.lastTickleError = null;
      if (this.state.gwStatus === "GW_UP") {
        const hmdsAuth = resp?.data?.hmds?.authStatus;
        if (hmdsAuth?.authenticated === true && hmdsAuth?.connected === true) {
          this.state.gwStatus = "GW_BRIDGE_OK";
        }
      }
      this.logger.trace?.(
        `[connectivity] tickle ok status=${resp.status} latencyMs=${elapsedMs} at=${new Date().toISOString()}`
      );
      if (resp.status >= 400) {
        this.logger.warning(
          `[connectivity] tickle warning status=${resp.status} payload=${JSON.stringify(resp.data ?? null)}`
        );
      }
    } catch (err) {
      this.state.lastTickleStatus = null;
      this.state.lastTicklePayload = null;
      this.state.lastTickleError = err?.message || String(err);
      this.logger.error(
        `[connectivity] tickle error: ${err?.message || String(err)}`
      );
    }
    this.state.lastTickleAt = new Date().toISOString();
  }

  async _ssodhInitIfDue(intervalMs) {
    if (!intervalMs || intervalMs <= 0) return;
    const now = Date.now();
    const last = this.state.lastSsodhInitAt
      ? new Date(this.state.lastSsodhInitAt).getTime()
      : 0;
    if (now - last < intervalMs) return;
    let result = null;
    try {
      const statusResp = await this._requestWithReauth({
        method: "GET",
        url: "/v1/api/iserver/auth/status",
      });
      const statusOk = statusResp.status >= 200 && statusResp.status < 300;

      const initResp = await this._requestWithReauth({
        method: "POST",
        url: "/v1/api/iserver/auth/ssodh/init",
      });
      const initOk = initResp.status >= 200 && initResp.status < 300;

      this.state.lastSsodhInitStatus = initResp.status;
      this.state.lastSsodhInitOk = initOk;
      this.state.lastSsodhInitError = initOk ? null : "IBKR ssodh init failed";

      result = {
        authStatus: {
          ok: statusOk,
          status: statusResp.status,
          data: statusResp.data ?? null,
          error: statusOk ? null : "IBKR auth status failed",
        },
        ssodhInit: {
          ok: initOk,
          status: initResp.status,
          data: initResp.data ?? null,
          error: initOk ? null : "IBKR ssodh init failed",
        },
      };

      if (!statusOk) {
        this.logger.warning(
          `[connectivity] ssodh status warning status=${statusResp.status} payload=${JSON.stringify(statusResp.data ?? null)}`
        );
      }
      if (!initOk) {
        this.logger.warning(
          `[connectivity] ssodh init warning status=${initResp.status} payload=${JSON.stringify(initResp.data ?? null)}`
        );
      } else {
        this.logger.trace?.(
          `[connectivity] ssodh init ok status=${initResp.status}`
        );
      }
    } catch (err) {
      this.state.lastSsodhInitStatus = null;
      this.state.lastSsodhInitOk = false;
      this.state.lastSsodhInitError = err?.message || String(err);
      result = {
        authStatus: {
          ok: false,
          status: null,
          data: null,
          error: err?.message || String(err),
        },
        ssodhInit: {
          ok: false,
          status: null,
          data: null,
          error: err?.message || String(err),
        },
      };
      this.logger.warning(
        `[connectivity] ssodh init error: ${err?.message || String(err)}`
      );
    }
    this.state.lastSsodhInitAt = new Date().toISOString();
    this.state.lastSsodhInitPayload = result;
    // Combined telemetry is emitted once per tick in _tick().
  }
}

module.exports = IbkrConnectivity;
