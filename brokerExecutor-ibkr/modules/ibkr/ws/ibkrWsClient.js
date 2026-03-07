"use strict";

const https = require("https");
const { asInt } = require("../../../../shared/helpers");
const {
  SUBSCRIBE_LIVE_ORDERS,
  UNSUBSCRIBE_LIVE_ORDERS,
  decodeWsMessage,
} = require("./ibkrWsProtocols");

function resolveWebSocketImpl() {
  try {
    // Prefer 'ws' package because it supports TLS agent/options in Node.
    return { impl: require("ws"), kind: "ws" };
  } catch {
    if (typeof globalThis.WebSocket === "function") {
      return { impl: globalThis.WebSocket, kind: "global" };
    }
    return null;
  }
}

class IbkrWsClient {
  constructor({ logger, onLiveOrderMessage, onStatus }) {
    this.logger = logger;
    this.onLiveOrderMessage = onLiveOrderMessage;
    this.onStatus = onStatus;

    this.wsUrl =
      process.env.IBKR_WS_URL ||
      process.env.IBKRGW_WS_URL ||
      "wss://ibkrgw-paper:5000/v1/api/ws";
    this.reconnectMinMs = asInt(process.env.IBKR_WS_RECONNECT_MIN_MS, 1000);
    this.reconnectMaxMs = asInt(process.env.IBKR_WS_RECONNECT_MAX_MS, 30000);
    this.heartbeatMs = asInt(process.env.IBKR_WS_HEARTBEAT_MS, 25000);
    this.insecureTls =
      String(
        process.env.IBKR_WS_INSECURE_TLS ??
          process.env.IBKR_INSECURE_TLS ??
          "false"
      ).toLowerCase() === "true";

    this.wsRuntime = resolveWebSocketImpl();
    this.WebSocketImpl = this.wsRuntime?.impl || null;
    this.wsKind = this.wsRuntime?.kind || "none";
    this.socket = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.currentDelayMs = this.reconnectMinMs;
    this.stopped = false;
    this.connected = false;
    this.nextReconnectAt = null;
    this.lastConnectedAt = null;
    this.lastMessageAt = null;
    this.lastError = null;
    this.lastClose = null;
    this.lastStatus = "idle";
  }

  async start() {
    if (!this.WebSocketImpl) {
      throw new Error("No WebSocket client available. Install 'ws' or use Node runtime with global WebSocket.");
    }
    this.stopped = false;
    this._connect();
  }

  async stop() {
    this.stopped = true;
    this.lastStatus = "stopping";
    this._clearTimers();
    await this._safeUnsubscribe();
    this._closeSocket("stop");
    this.lastStatus = "stopped";
  }

  _connect() {
    if (this.stopped) return;
    if (this.socket) return;

    this.logger.info(
      `[start] opening ws connection url=${this.wsUrl} insecureTls=${this.insecureTls} wsKind=${this.wsKind}`
    );
    this.lastStatus = "connecting";
    this.onStatus?.("connecting", { url: this.wsUrl });

    try {
      const wsOptions = {};
      if (this.insecureTls) {
        // Only pass the agent option - 'ws' library doesn't support standalone rejectUnauthorized
        wsOptions.agent = new https.Agent({
          rejectUnauthorized: false,
          keepAlive: true
        });
      }
      let ws;
      if (this.wsKind === "ws") {
        ws = new this.WebSocketImpl(
          this.wsUrl,
          [],
          Object.keys(wsOptions).length ? wsOptions : undefined
        );
      } else {
        // Global WebSocket in Node has no reliable TLS-agent options.
        ws = new this.WebSocketImpl(this.wsUrl);
        if (this.insecureTls) {
          this.logger.warning(
            "[_connect] insecureTls requested but global WebSocket runtime may ignore TLS options"
          );
        }
      }
      this.socket = ws;

      ws.onopen = () => this._onOpen();
      ws.onmessage = (event) => this._onMessage(event?.data);
      ws.onerror = (err) => this._onError(err);
      ws.onclose = (event) => this._onClose(event);

      if (typeof ws.on === "function") {
        ws.on("open", () => this._onOpen());
        ws.on("message", (data) => this._onMessage(data));
        ws.on("error", (err) => this._onError(err));
        ws.on("close", (code, reason) =>
          this._onClose({ code, reason: reason ? String(reason) : "" })
        );
      }
    } catch (err) {
      this.logger.error(`[start] ws connect failed: ${err?.message || String(err)}`);
      this._scheduleReconnect();
    }
  }

  async _onOpen() {
    if (!this.socket) return;
    this.connected = true;
    this.lastConnectedAt = new Date().toISOString();
    this.nextReconnectAt = null;
    this.lastStatus = "connected";
    this.currentDelayMs = this.reconnectMinMs;
    this.logger.info("[_onOpen] ws connected, subscribing live orders");
    this.onStatus?.("connected", null);

    this._send(SUBSCRIBE_LIVE_ORDERS);
    this._startHeartbeat();
  }

  _onMessage(raw) {
    this.lastMessageAt = new Date().toISOString();
    const decoded = decodeWsMessage(raw);
    if (decoded.topic === "sor") {
      this.onLiveOrderMessage?.(decoded.payload, decoded.raw);
      return;
    }

    if (decoded.topic === "uor" || decoded.topic === "unknown") return;
    if (decoded.topic === "text" && decoded.payload === "pong") return;
    this.logger.trace?.(`[_onMessage] ignored topic=${decoded.topic}`);
  }

  _onError(err) {
    this.lastError = {
      ts: new Date().toISOString(),
      message: err?.message || String(err),
    };
    this.lastStatus = "error";
    this.logger.warning(`[_onError] ws error: ${err?.message || String(err)}`);
    this.onStatus?.("error", { message: err?.message || String(err) });
  }

  _onClose(event) {
    const code = event?.code ?? null;
    const reason = event?.reason ? String(event.reason) : "";
    this.logger.warning(`[_onClose] ws closed code=${code ?? "-"} reason=${reason || "-"}`);

    this.connected = false;
    this.lastClose = {
      ts: new Date().toISOString(),
      code,
      reason,
    };
    this.lastStatus = "closed";
    this._clearHeartbeat();
    this._closeSocket("closed");
    this.onStatus?.("closed", { code, reason });

    if (!this.stopped) {
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const jitter = Math.floor(Math.random() * 500);
    const waitMs = Math.min(this.currentDelayMs + jitter, this.reconnectMaxMs);
    this.nextReconnectAt = new Date(Date.now() + waitMs).toISOString();
    this.lastStatus = "reconnecting";
    this.logger.warning(`[_scheduleReconnect] reconnect in ${waitMs}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.nextReconnectAt = null;
      this.currentDelayMs = Math.min(this.currentDelayMs * 2, this.reconnectMaxMs);
      this._connect();
    }, waitMs);
  }

  _startHeartbeat() {
    this._clearHeartbeat();
    if (!this.heartbeatMs || this.heartbeatMs <= 0) return;

    this.heartbeatTimer = setInterval(() => {
      if (!this.socket) return;
      try {
        if (typeof this.socket.ping === "function") {
          this.socket.ping();
        } else if (typeof this.socket.send === "function") {
          this.socket.send("pong");
        }
      } catch (err) {
        this.logger.warning(`[_startHeartbeat] heartbeat failed: ${err?.message || String(err)}`);
      }
    }, this.heartbeatMs);
  }

  _clearHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  _clearTimers() {
    this._clearHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  _send(message) {
    try {
      if (!this.socket) return;
      if (this.socket.readyState !== 1) return;
      this.socket.send(message);
    } catch (err) {
      this.logger.warning(`[_send] failed: ${err?.message || String(err)}`);
    }
  }

  async _safeUnsubscribe() {
    try {
      this._send(UNSUBSCRIBE_LIVE_ORDERS);
    } catch {
      // best effort
    }
  }

  _closeSocket(reason) {
    if (!this.socket) return;
    try {
      if (this.socket.readyState === 1 && typeof this.socket.close === "function") {
        this.socket.close(1000, reason || "shutdown");
      } else if (typeof this.socket.terminate === "function") {
        this.socket.terminate();
      }
    } catch {
      // ignore close errors
    }
    this.socket = null;
  }

  getStatus() {
    return {
      wsUrl: this.wsUrl,
      connected: this.connected,
      stopped: this.stopped,
      status: this.lastStatus,
      reconnectDelayMs: this.currentDelayMs,
      nextReconnectAt: this.nextReconnectAt,
      lastConnectedAt: this.lastConnectedAt,
      lastMessageAt: this.lastMessageAt,
      lastError: this.lastError,
      lastClose: this.lastClose,
      readyState: this.socket?.readyState ?? null,
    };
  }
}

module.exports = {
  IbkrWsClient,
};
