"use strict";

const axios = require("axios");
const https = require("https");
const { getConfigString, getConfigNumber, getConfigBoolean } = require("../../../shared/loadSettings");

function createError(code, message, statusCode = 500, details = null) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  if (details != null) err.details = details;
  return err;
}

class IbkrAdapter {
  constructor({ logger }) {
    this.logger = logger;
    this.bridgeUrl = getConfigString("IBKRBRIDGE_URL", "").trim();
    this.preferBridge = getConfigBoolean("IBKR_EXECUTOR_USE_BRIDGE", true);
    this.baseUrl =
      getConfigString(["IBKRGW_BASE_URL", "IBKR_BASE_URL"], "http://ibkrgw-paper:5000");
    this.timeoutMs = getConfigNumber("IBKR_REQUEST_TIMEOUT_MS", 20000);
    this.insecureTls = getConfigBoolean("IBKR_INSECURE_TLS", false);
    this.autoReplyConfirm =
      getConfigBoolean("IBKR_AUTO_REPLY_CONFIRM", true);

    const axiosCfg = {
      baseURL: this.baseUrl.replace(/\/+$/, ""),
      timeout: this.timeoutMs,
      validateStatus: () => true,
    };
    if (axiosCfg.baseURL.startsWith("https://")) {
      axiosCfg.httpsAgent = new https.Agent({
        rejectUnauthorized: !this.insecureTls,
        keepAlive: true,
      });
    }
    this.client = axios.create(axiosCfg);

    this.bridgeClient = this.bridgeUrl
      ? axios.create({
          baseURL: this.bridgeUrl.replace(/\/+$/, ""),
          timeout: this.timeoutMs,
          validateStatus: () => true,
        })
      : null;
  }

  _extractMessage(payload) {
    if (!payload) return null;
    if (typeof payload === "string") return payload;
    if (Array.isArray(payload)) {
      const first = payload[0];
      if (first && typeof first === "object") {
        return first.message || first.error || JSON.stringify(first);
      }
      return JSON.stringify(payload);
    }
    return payload.error || payload.message || null;
  }

  async _request(method, path, { params, data, headers } = {}) {
    const startedAt = Date.now();
    let response;

    const useBridge = this.preferBridge && !!this.bridgeClient;
    const requestPath = useBridge
      ? `/mirror/${path.replace(/^\/+/, "")}`
      : `/v1/api/${path.replace(/^\/+/, "")}`;

    try {
      const client = useBridge ? this.bridgeClient : this.client;
      response = await client.request({
        method,
        url: requestPath,
        params,
        data,
        headers,
      });
    } catch (err) {
      this.logger.error(`[ibkrRequest] Network error method=${method} path=${path}: ${err?.message || String(err)}`);
      throw createError("IBKR_UNAVAILABLE", "Unable to reach IBKR gateway", 503, {
        reason: err?.message || String(err),
      });
    }

    const latencyMs = Date.now() - startedAt;
    const status = Number(response?.status || 0);
    this.logger.info(
      `[ibkrRequest] source=${useBridge ? "ibkr-bridge" : "gateway"} method=${method} path=${path} status=${status} latencyMs=${latencyMs}`
    );

    if (status >= 200 && status < 300) return response.data;

    const message = this._extractMessage(response?.data) || `IBKR HTTP ${status}`;
    const code = status >= 500 ? "IBKR_UPSTREAM_ERROR" : "IBKR_REQUEST_ERROR";
    throw createError(code, message, status, response?.data);
  }

  async _resolveReplyIfNeeded(payload) {
    if (!Array.isArray(payload) || payload.length === 0) return payload;
    if (!this.autoReplyConfirm) return payload;

    let current = payload;
    for (let depth = 0; depth < 10; depth += 1) {
      const pending = current.find((item) => item && item.id && !item.order_id);
      if (!pending) return current;

      this.logger.warning(
        `[resolveReply] Auto confirming IBKR question replyId=${pending.id} message=${pending.message || "-"}`
      );

      current = await this._request("POST", `iserver/reply/${pending.id}`, {
        data: { confirmed: true },
      });
    }

    throw createError("IBKR_REPLY_LOOP", "Unable to resolve IBKR reply confirmation flow", 502);
  }

  async getOpenOrders(accountId) {
    const params = {};
    if (accountId) params.accountId = accountId;
    const payload = await this._request("GET", "iserver/account/orders", { params });

    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.orders)) return payload.orders;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  }

  async getAccounts() {
    const endpoints = ["portfolio/accounts", "iserver/accounts"];
    const errors = [];

    for (const endpoint of endpoints) {
      try {
        const payload = await this._request("GET", endpoint);
        if (Array.isArray(payload)) return payload;
        if (Array.isArray(payload?.accounts)) return payload.accounts;
        if (Array.isArray(payload?.acctIds)) return payload.acctIds;
        if (Array.isArray(payload?.data)) return payload.data;
      } catch (err) {
        errors.push({
          endpoint,
          statusCode: err?.statusCode || null,
          message: err?.message || String(err),
        });
      }
    }

    const last = errors[errors.length - 1];
    throw createError(
      "IBKR_ACCOUNTS_UNAVAILABLE",
      "Unable to load accounts from IBKR",
      last?.statusCode || 502,
      { attempts: errors }
    );
  }

  async getOrderById(accountId, orderId) {
    const orders = await this.getOpenOrders(accountId);
    const normalizedOrderId = String(orderId);
    const found = orders.find((item) => {
      const id = String(item?.orderId ?? item?.order_id ?? item?.id ?? "");
      return id === normalizedOrderId;
    });
    return found || null;
  }

  _asNumber(...values) {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  _sanitizeCoidPart(value, fallback = "order") {
    const raw = String(value || "").trim().toLowerCase();
    const cleaned = raw.replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^[-_]+|[-_]+$/g, "");
    return cleaned || fallback;
  }

  _buildBracketCoids(externalCorrelationId) {
    // Keep cOID short to avoid IBKR truncation collisions between TP/SL.
    // We keep role prefix at the beginning so uniqueness survives right-truncation.
    const fallback = `astra-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const base = this._sanitizeCoidPart(externalCorrelationId || fallback, "astra");
    const maxLen = 24;
    const withPrefix = (prefix) => {
      const allowedBaseLen = Math.max(4, maxLen - (prefix.length + 1));
      const shortBase = base.slice(0, allowedBaseLen);
      return `${prefix}-${shortBase}`;
    };
    return {
      parent: withPrefix("P"),
      tp: withPrefix("TP"),
      sl: withPrefix("SL"),
    };
  }

  _buildOrderUpdatePayload(order = {}, overrides = {}) {
    const conid = this._asNumber(order?.conid, order?.contract_id, order?.contractId);
    const quantity = this._asNumber(order?.quantity, order?.totalQuantity, order?.size, order?.qty);
    const side = String(order?.side || order?.order_action || order?.action || "").trim().toUpperCase();
    const orderType = String(order?.orderType || order?.order_type || order?.type || "")
      .trim()
      .toUpperCase();
    const tif = String(order?.tif || order?.timeInForce || "DAY").trim().toUpperCase();
    const secType = String(order?.secType || "STK").trim().toUpperCase();

    if (!Number.isFinite(conid) || !Number.isFinite(quantity) || !side || !orderType) {
      throw createError(
        "ORDER_UPDATE_PAYLOAD_INVALID",
        "Unable to build IBKR update payload from order snapshot",
        400,
        {
          required: ["conid", "quantity", "side", "orderType"],
          source: {
            conid: order?.conid ?? null,
            quantity: order?.quantity ?? order?.totalQuantity ?? order?.size ?? order?.qty ?? null,
            side: order?.side ?? order?.order_action ?? order?.action ?? null,
            orderType: order?.orderType ?? order?.order_type ?? order?.type ?? null,
          },
        }
      );
    }

    const payload = {
      conid,
      secType,
      orderType,
      side,
      tif,
      quantity,
    };

    if (
      orderType === "STP LMT" ||
      orderType === "STP_LMT" ||
      orderType === "STOP_LIMIT" ||
      orderType === "STOP LMT"
    ) {
      const auxPrice = this._asNumber(overrides?.auxPrice, order?.auxPrice, order?.stopPrice);
      const price = this._asNumber(overrides?.price, order?.price, order?.limitPrice, order?.lmt_price);
      if (!Number.isFinite(auxPrice) || !Number.isFinite(price)) {
        throw createError(
          "ORDER_UPDATE_PAYLOAD_INVALID",
          "Missing auxPrice/price for STOP LIMIT order update",
          400
        );
      }
      payload.auxPrice = auxPrice;
      payload.price = price;
    } else if (orderType === "STP" || orderType === "STOP") {
      const auxPrice = this._asNumber(overrides?.auxPrice, order?.auxPrice, order?.stopPrice);
      if (!Number.isFinite(auxPrice)) {
        throw createError("ORDER_UPDATE_PAYLOAD_INVALID", "Missing auxPrice for STOP order update", 400);
      }
      payload.auxPrice = auxPrice;
    } else {
      const price = this._asNumber(overrides?.price, order?.price, order?.limitPrice, order?.lmt_price);
      if (!Number.isFinite(price)) {
        throw createError("ORDER_UPDATE_PAYLOAD_INVALID", "Missing price for LIMIT order update", 400);
      }
      payload.price = price;
    }

    return payload;
  }

  async updateSingleOrder({ accountId, orderId, payload }) {
    const updatePayload = this._buildOrderUpdatePayload(payload.order, payload.overrides || {});
    return this._request("POST", `iserver/account/${accountId}/order/${orderId}`, {
      data: updatePayload,
    });
  }

  async cancelOrder({ accountId, orderId }) {
    const payload = await this._request("DELETE", `iserver/account/${accountId}/order/${orderId}`);
    return this._resolveReplyIfNeeded(payload);
  }

  async getPositions(accountId) {
    // IBKR API requires portfolio/accounts to be called before any portfolio sub-endpoint.
    // This primes the portfolio model for the session; errors are intentionally ignored.
    try {
      await this._request("GET", "portfolio/accounts");
    } catch { /* best-effort priming */ }

    const endpoints = [
      `portfolio/${accountId}/positions/0`,
      `portfolio/${accountId}/positions`,
      `portfolio2/${accountId}/positions`,
    ];

    const errors = [];
    for (const endpoint of endpoints) {
      try {
        const payload = await this._request("GET", endpoint);
        if (Array.isArray(payload)) return payload;
        if (Array.isArray(payload?.positions)) return payload.positions;
        if (Array.isArray(payload?.data)) return payload.data;
        return [];
      } catch (err) {
        errors.push({
          endpoint,
          statusCode: err?.statusCode || null,
          message: err?.message || String(err),
        });
      }
    }

    const last = errors[errors.length - 1];
    throw createError(
      "IBKR_POSITIONS_UNAVAILABLE",
      "Unable to load positions from IBKR",
      last?.statusCode || 502,
      { attempts: errors }
    );
  }

  async resolveConidBySymbol(symbol) {
    const payload = await this._request("GET", "iserver/secdef/search", {
      params: { symbol: String(symbol || "").trim().toUpperCase() },
    });

    const items = Array.isArray(payload) ? payload : [];

    const hasSection = (item, secType, exchangeHint) =>
      Array.isArray(item?.sections) &&
      item.sections.some(
        (s) =>
          s.secType === secType &&
          (!exchangeHint || String(s.exchange || "").toUpperCase().includes(exchangeHint))
      );

    // Priority: STK on SMART → STK on any exchange → first valid conid
    const preferred =
      items.find((i) => Number.isFinite(Number(i?.conid)) && hasSection(i, "STK", "SMART")) ||
      items.find((i) => Number.isFinite(Number(i?.conid)) && hasSection(i, "STK", null)) ||
      items.find((i) => Number.isFinite(Number(i?.conid)));

    if (!preferred) {
      throw createError("SYMBOL_NOT_FOUND", `No conid found for symbol ${symbol}`, 404);
    }

    const matchedSection = Array.isArray(preferred?.sections)
      ? preferred.sections.find((s) => s.secType === "STK" && String(s.exchange || "").toUpperCase().includes("SMART")) ||
        preferred.sections.find((s) => s.secType === "STK")
      : null;

    this.logger.info(
      `[resolveConidBySymbol] symbol=${symbol} conid=${preferred.conid}` +
      ` secType=${matchedSection?.secType ?? "?"}` +
      ` exchange=${matchedSection?.exchange ?? "?"}`
    );

    return Number(preferred.conid);
  }

  async placeBracketOrder({
    accountId,
    side,
    symbol,
    quantity,
    limitPrice,
    stopLossPrice,
    stopLossLimitPrice,
    takeProfitPrice,
    timeInForce,
    externalCorrelationId,
    decisionEngineRunId,
  }) {
    const allowedTif = new Set(["DAY", "GTC", "IOC", "OPG"]);
    const conid = await this.resolveConidBySymbol(symbol);
    const coids = this._buildBracketCoids(externalCorrelationId);
    const rawTif = String(timeInForce || "DAY").toUpperCase();
    const tif = allowedTif.has(rawTif) ? rawTif : "DAY";
    const parentSide = String(side || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
    const childSide = parentSide === "BUY" ? "SELL" : "BUY";
    const cleanSymbol = String(symbol || "").trim().toUpperCase();

    const parentOrder = {
      acctId: accountId,
      conid,
      secType: "STK",
      ticker: cleanSymbol,
      orderType: "LMT",
      side: parentSide,
      quantity,
      price: limitPrice,
      tif,
      outsideRTH: true,
      cOID: coids.parent,
      referrer: decisionEngineRunId || undefined,
    };

    const takeProfitOrder = {
      acctId: accountId,
      conid,
      secType: "STK",
      ticker: cleanSymbol,
      orderType: "LMT",
      side: childSide,
      quantity,
      price: takeProfitPrice,
      tif,
      outsideRTH: true,
      parentId: coids.parent,
      cOID: coids.tp,
    };

    const stopLossOrder = {
      acctId: accountId,
      conid,
      secType: "STK",
      ticker: cleanSymbol,
      orderType: "STP LMT",
      side: childSide,
      quantity,
      auxPrice: stopLossPrice,
      price: stopLossLimitPrice,
      tif,
      outsideRTH: true,
      parentId: coids.parent,
      cOID: coids.sl,
    };

    const payload = await this._request("POST", `iserver/account/${accountId}/orders`, {
      data: { orders: [parentOrder, takeProfitOrder, stopLossOrder] },
    });
    const finalPayload = await this._resolveReplyIfNeeded(payload);
    this.logger.info(
      `[placeBracketOrder] submit side=${parentSide} symbol=${cleanSymbol} qty=${quantity} coids=${coids.parent},${coids.tp},${coids.sl} ackCount=${Array.isArray(finalPayload) ? finalPayload.length : 0}`
    );
    if (!Array.isArray(finalPayload) || finalPayload.length < 3) {
      this.logger.warning(
        `[placeBracketOrder] bracket ack seems partial expected=3 actual=${Array.isArray(finalPayload) ? finalPayload.length : 0}`
      );
    }

    const parentAck =
      (Array.isArray(finalPayload) &&
        finalPayload.find((item) =>
          String(item?.local_order_id ?? item?.cOID ?? "").includes(coids.parent)
        )) ||
      (Array.isArray(finalPayload) ? finalPayload[0] : null);

    return {
      orderId: String(parentAck?.order_id || parentAck?.orderId || ""),
      parentCoid: coids.parent,
      raw: finalPayload,
      side: parentSide,
      symbol,
      quantity,
      limitPrice,
      stopLossPrice,
      stopLossLimitPrice,
      takeProfitPrice,
      tif,
      externalCorrelationId,
      decisionEngineRunId,
    };
  }

  async updateBracketChildren({
    accountId,
    parentOrderId,
    stopLossPrice,
    takeProfitPrice,
  }) {
    const orders = await this.getOpenOrders(accountId);
    const normalizedParentId = String(parentOrderId);

    const children = orders.filter((order) => {
      const p = String(order?.parent_order_id ?? order?.parentId ?? order?.parent_id ?? "");
      return p && p === normalizedParentId;
    });

    if (!children.length) {
      throw createError("ORDER_CHILDREN_NOT_FOUND", "Bracket child orders not found", 404);
    }

    const updates = [];
    for (const child of children) {
      const orderId = String(child?.orderId ?? child?.order_id ?? child?.id ?? "");
      const type = String(child?.orderType || child?.order_type || "").toUpperCase();
      if (!orderId || !type) continue;

      if (type === "LMT") {
        updates.push(
          this.updateSingleOrder({
            accountId,
            orderId,
            payload: { order: child, overrides: { price: takeProfitPrice } },
          })
        );
      }
      if (type === "STP" || type === "STOP") {
        updates.push(
          this.updateSingleOrder({
            accountId,
            orderId,
            payload: { order: child, overrides: { auxPrice: stopLossPrice } },
          })
        );
      }
    }

    if (!updates.length) {
      throw createError("ORDER_UPDATE_UNSUPPORTED", "Unable to identify SL/TP child orders", 409);
    }

    const results = await Promise.all(updates);
    return { updated: results.length, raw: results };
  }

  async updateBracketOrder({
    accountId,
    parentOrderId,
    limitPrice,
    stopLossPrice,
    stopLossLimitPrice,
    takeProfitPrice,
  }) {
    const orders = await this.getOpenOrders(accountId);
    const normalizedParentId = String(parentOrderId);

    const parent = orders.find((item) => {
      const id = String(item?.orderId ?? item?.order_id ?? item?.id ?? "");
      return id === normalizedParentId;
    });

    if (!parent) {
      throw createError("ORDER_NOT_FOUND", `Order ${parentOrderId} not found`, 404);
    }

    const children = orders.filter((order) => {
      const p = String(order?.parent_order_id ?? order?.parentId ?? order?.parent_id ?? "");
      return p && p === normalizedParentId;
    });

    const updates = [
      this.updateSingleOrder({
        accountId,
        orderId: normalizedParentId,
        payload: { order: parent, overrides: { price: limitPrice } },
      }),
    ];

    for (const child of children) {
      const orderId = String(child?.orderId ?? child?.order_id ?? child?.id ?? "");
      const type = String(child?.orderType || child?.order_type || "").toUpperCase();
      if (!orderId || !type) continue;

      if (type === "LMT") {
        updates.push(
          this.updateSingleOrder({
            accountId,
            orderId,
            payload: { order: child, overrides: { price: takeProfitPrice } },
          })
        );
        continue;
      }
      if (type === "STP LMT" || type === "STP_LMT" || type === "STOP_LIMIT" || type === "STOP LMT") {
        const currentStopLimit = this._asNumber(child?.price, child?.limitPrice, child?.lmt_price);
        updates.push(
          this.updateSingleOrder({
            accountId,
            orderId,
            payload: {
              order: child,
              overrides: {
                auxPrice: stopLossPrice,
                price: Number.isFinite(stopLossLimitPrice) ? stopLossLimitPrice : currentStopLimit,
              },
            },
          })
        );
        continue;
      }
      if (type === "STP" || type === "STOP") {
        updates.push(
          this.updateSingleOrder({
            accountId,
            orderId,
            payload: { order: child, overrides: { auxPrice: stopLossPrice } },
          })
        );
        continue;
      }
      throw createError(
        "ORDER_UPDATE_UNSUPPORTED",
        `Unsupported child order type: ${type}`,
        409
      );
    }

    const results = await Promise.all(updates);
    return { updated: results.length, raw: results };
  }
}

module.exports = {
  IbkrAdapter,
  createError,
};
