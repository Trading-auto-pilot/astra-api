"use strict";

const { IbkrAdapter, createError } = require("./ibkrAdapter");
const { normalizeOrder, normalizePosition, extractReferencePrice } = require("./ibkrMapper");
const { InMemoryIdempotencyRepository } = require("../../repositories/idempotencyRepository");
const { validateUpdateOrderPayload } = require("../../validation/brokerExecutorIbkr.validation");
const { getConfigString, getConfigNumber } = require("../../../shared/loadSettings");

class IbkrOrdersService {
  constructor({ logger }) {
    this.logger = logger;
    this.adapter = new IbkrAdapter({ logger });
    this.idempotencyRepo = new InMemoryIdempotencyRepository();
    this.accountId = getConfigString("IBKR_ACCOUNT_ID", "");
    this.resolvedAccountId = "";
    this.idempotencyTtlHours = getConfigNumber("IBKR_IDEMPOTENCY_HOURS", 6);
  }

  async _requireAccountId() {
    // Always prefer dynamically resolved account (reflects current IBKR session)
    const resolved = String(this.resolvedAccountId || "").trim();
    if (resolved) return resolved;

    try {
      const accounts = await this.adapter.getAccounts();
      const first = Array.isArray(accounts) ? accounts[0] : null;

      const guessed =
        (typeof first === "string" ? first : null) ||
        (first && typeof first === "object"
          ? String(
              first.accountId ||
                first.account ||
                first.id ||
                first.acctId ||
                first.acctCode ||
                ""
            ).trim()
          : "");

      if (guessed) {
        this.resolvedAccountId = guessed;
        this.logger.info(`[resolveAccountId] Using IBKR accountId=${guessed} (dynamic)`);
        return guessed;
      }
    } catch (err) {
      this.logger.warning(
        `[resolveAccountId] Unable to resolve accountId from IBKR: ${err?.message || String(err)}`
      );
    }

    // Fall back to env var only if dynamic resolution fails
    const configured = String(this.accountId || "").trim();
    if (configured) {
      this.logger.warning(`[resolveAccountId] Falling back to IBKR_ACCOUNT_ID env var: ${configured}`);
      return configured;
    }

    throw createError(
      "CONFIG_MISSING",
      "IBKR_ACCOUNT_ID is required for brokerExecutor-ibkr",
      500
    );
  }

  _idempotencyKey(externalCorrelationId) {
    return `create:${externalCorrelationId}`;
  }

  async listOpenOrders() {
    const accountId = await this._requireAccountId();
    const rawOrders = await this.adapter.getOpenOrders(accountId);
    return rawOrders.map((raw) => normalizeOrder(raw));
  }

  async listPositions() {
    const accountId = await this._requireAccountId();
    const rawPositions = await this.adapter.getPositions(accountId);
    return rawPositions.map((raw) => normalizePosition(raw, { accountId }));
  }

  async createBracketOrder(payload) {
    const accountId = await this._requireAccountId();
    const externalCorrelationId = payload.externalCorrelationId || null;

    if (externalCorrelationId) {
      const existing = this.idempotencyRepo.get(this._idempotencyKey(externalCorrelationId));
      if (existing?.value?.order) {
        this.logger.info(`[createBracketOrder] Idempotency hit externalCorrelationId=${externalCorrelationId}`);
        return { ...existing.value, idempotent: true };
      }
    }

    const placed = await this.adapter.placeBracketOrder({
      accountId,
      ...payload,
    });

    let fresh = null;
    if (placed.orderId) {
      fresh = await this.adapter.getOrderById(accountId, placed.orderId);
    }

    const order = normalizeOrder(fresh || {}, {
      side: placed.side,
      symbol: placed.symbol,
      quantity: placed.quantity,
      limitPrice: placed.limitPrice,
      stopLossPrice: placed.stopLossPrice,
      stopLossLimitPrice: placed.stopLossLimitPrice,
      takeProfitPrice: placed.takeProfitPrice,
      tif: placed.tif,
      orderId: placed.orderId || placed.parentCoid,
      externalCorrelationId: placed.externalCorrelationId,
      decisionEngineRunId: placed.decisionEngineRunId,
    });

    const result = { order };
    if (externalCorrelationId) {
      this.idempotencyRepo.set(
        this._idempotencyKey(externalCorrelationId),
        result,
        this.idempotencyTtlHours * 60 * 60 * 1000
      );
    }

    this.logger.info(
      `[createBracketOrder] Order created orderId=${order.orderId || "-"} symbol=${order.symbol || payload.symbol}`
    );
    return result;
  }

  async updateBracketOrder(orderId, payload) {
    const accountId = await this._requireAccountId();
    const allOrders = await this.adapter.getOpenOrders(accountId);
    const current = allOrders.find((item) => {
      const id = String(item?.orderId ?? item?.order_id ?? item?.id ?? "");
      return id === String(orderId);
    }) || null;
    if (!current) {
      throw createError("ORDER_NOT_FOUND", `Order ${orderId} not found`, 404);
    }

    const currentParentOrderId = String(
      current?.parent_order_id ?? current?.parentId ?? current?.parent_id ?? ""
    ).trim();
    const isChildOrder = !!currentParentOrderId;

    if (isChildOrder) {
      throw createError(
        "ORDER_UPDATE_UNSUPPORTED",
        "Child orders are not directly editable. Edit the parent order to update LIMIT/SL/TP.",
        409
      );
    }

    const referencePrice = extractReferencePrice(current);
    const side = String(current?.side || current?.order_action || "BUY").toUpperCase();
    const validated = validateUpdateOrderPayload(payload, {
      referencePrice,
      side,
    });

    await this.adapter.updateBracketOrder({
      accountId,
      parentOrderId: orderId,
      limitPrice: validated.limitPrice,
      stopLossPrice: validated.stopLossPrice,
      stopLossLimitPrice: validated.stopLossLimitPrice,
      takeProfitPrice: validated.takeProfitPrice,
    });

    const refreshed = await this.adapter.getOrderById(accountId, orderId);
    const order = normalizeOrder(refreshed || current, {
      limitPrice: validated.limitPrice,
      stopLossPrice: validated.stopLossPrice,
      stopLossLimitPrice: validated.stopLossLimitPrice,
      takeProfitPrice: validated.takeProfitPrice,
      decisionEngineRunId: validated.decisionEngineRunId,
    });

    this.logger.info(`[updateBracketOrder] Order updated orderId=${orderId}`);
    return { order };
  }

  async deleteOrder(orderId) {
    const accountId = await this._requireAccountId();
    const allOrders = await this.adapter.getOpenOrders(accountId);
    const target = allOrders.find((item) => {
      const id = String(item?.orderId ?? item?.order_id ?? item?.id ?? "");
      return id === String(orderId);
    }) || null;

    if (!target) {
      throw createError("ORDER_NOT_FOUND", `Order ${orderId} not found`, 404);
    }

    const targetParentOrderId = String(
      target?.parent_order_id ?? target?.parentId ?? target?.parent_id ?? ""
    ).trim();
    const isParent = !targetParentOrderId;

    const cancelled = [];

    if (isParent) {
      // For bracket orders: cancel PARENT first, IBKR will auto-cancel children
      await this.adapter.cancelOrder({ accountId, orderId: String(orderId) });
      cancelled.push(String(orderId));

      // Collect child order IDs for the response (they are auto-cancelled by IBKR)
      const children = allOrders.filter((item) => {
        const p = String(item?.parent_order_id ?? item?.parentId ?? item?.parent_id ?? "").trim();
        return p && p === String(orderId);
      });
      for (const child of children) {
        const childId = String(child?.orderId ?? child?.order_id ?? child?.id ?? "").trim();
        if (childId) cancelled.push(childId);
      }
    } else {
      // For standalone orders: just cancel the order
      await this.adapter.cancelOrder({ accountId, orderId: String(orderId) });
      cancelled.push(String(orderId));
    }

    this.logger.info(
      `[deleteOrder] Cancelled orders: ${cancelled.join(",")} (requested=${orderId})`
    );
    return {
      ok: true,
      deletedOrderId: String(orderId),
      cancelledOrderIds: cancelled,
      cancelledCount: cancelled.length,
    };
  }
}

module.exports = {
  IbkrOrdersService,
};
