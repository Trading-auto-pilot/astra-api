// modules/connectivity.js
"use strict";

const axios = require("axios");
const https = require("https");
const { asBool, asInt } = require("../../shared/helpers");

class IbkrConnectivity {
  constructor({ logger, getSetting }) {
    this.logger = logger;
    this.getSetting = getSetting;
    this._timer = null;
    this._running = false;
    this._lastIntervalMs = null;
    this._client = null;
    this._reauthInFlight = null;
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
      lastAuthAt: null,
      lastTickleAt: null,
      lastTickleStatus: null,
      lastTickleError: null,
      lastTicklePayload: null,
      lastCheckAt: null,
    };
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
    return { baseUrl, insecureTls, tickleIntervalMs, authCheckIntervalMs, ssoDispatcherUrl };
  }

  _buildClient(baseUrl, insecureTls) {
    const config = {
      baseURL: baseUrl,
      timeout: 8000,
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
    const { baseUrl, insecureTls } = settings;
    if (!baseUrl) {
      this._client = null;
      return;
    }
    if (this.state.baseUrl !== baseUrl || this.state.insecureTls !== insecureTls || !this._client) {
      this._client = this._buildClient(baseUrl, insecureTls);
    }
    this.state.baseUrl = baseUrl;
    this.state.insecureTls = insecureTls;
  }

  async _ensureReauth(settings) {
    if (this._reauthInFlight) {
      await this._reauthInFlight;
      return;
    }
    const { ssoDispatcherUrl } = settings || this._readSettings();
    if (!ssoDispatcherUrl) return;
    this._reauthInFlight = (async () => {
      try {
        this.logger.info(`[connectivity] sso reauth url=${ssoDispatcherUrl}`);
        const resp = await axios.get(ssoDispatcherUrl, {
          timeout: 8000,
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
    try {
      const resp = await this._requestWithReauth({ method: "GET", url: "/" });
      this.state.gwStatusCode = resp.status;
      this.state.gwError = null;
      if (resp.status === 200) {
        this.state.gwStatus = "GW_UP";
      } else {
        this.state.gwStatus = "GW_UP_BUT_ERROR";
      }
    } catch (err) {
      this.state.gwStatusCode = null;
      if (this._isNetworkDownError(err)) {
        this.state.gwStatus = "GW_DOWN";
      } else {
        this.state.gwStatus = "GW_UP_BUT_ERROR";
      }
      this.state.gwError = err?.message || String(err);
    }
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
      } else {
        this.state.authenticated = false;
        this.state.connected = false;
      }
    } catch (err) {
      this.state.authStatusCode = null;
      this.state.authError = err?.message || String(err);
      this.state.authenticated = false;
      this.state.connected = false;
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
}

module.exports = IbkrConnectivity;
