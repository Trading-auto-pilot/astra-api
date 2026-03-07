"use strict";

const { traefikFetch } = require("./_http");

function buildRatioBar(ordersCount, positionsCount, width = 32) {
  const total = Math.max(ordersCount + positionsCount, 0);
  if (total === 0) return "░".repeat(width);

  const ordersBlocks = Math.round((ordersCount / total) * width);
  const positionsBlocks = Math.max(0, width - ordersBlocks);
  return `${"█".repeat(ordersBlocks)}${"░".repeat(positionsBlocks)}`;
}

function pct(value, total) {
  if (!total) return "0.0";
  return ((value / total) * 100).toFixed(1);
}

module.exports = {
  name: "broker_ibkr_snapshot",
  description:
    "Returns current IBKR broker snapshot: existing positions and open orders from broker-executor-ibkr. Supports optional filtering by symbol and accountId.",

  inputSchema: {
    symbol: {
      type: "string",
      description: "Optional symbol filter (e.g. AAPL). Applies to both positions and orders.",
      required: false,
    },
    accountId: {
      type: "string",
      description: "Optional account filter. Applies to positions; orders are not account-scoped in current API payload.",
      required: false,
    },
    include_ws_status: {
      type: "boolean",
      description: "If true, include /broker-executor-ibkr/ws/status in the response (default false).",
      required: false,
    },
  },

  validate(input) {
    if (input?.symbol != null && typeof input.symbol !== "string") {
      return "symbol must be a string";
    }
    if (input?.accountId != null && typeof input.accountId !== "string") {
      return "accountId must be a string";
    }
    return null;
  },

  async handler(ctx, input) {
    const { logger } = ctx;

    const symbolFilter = input?.symbol ? String(input.symbol).trim().toUpperCase() : null;
    const accountFilter = input?.accountId ? String(input.accountId).trim() : null;
    const includeWsStatus = input?.include_ws_status === true;

    try {
      const requests = [
        traefikFetch("/broker-executor-ibkr/positions"),
        traefikFetch("/broker-executor-ibkr/orders"),
      ];
      if (includeWsStatus) {
        requests.push(traefikFetch("/broker-executor-ibkr/ws/status"));
      }

      const [positionsBody, ordersBody, wsStatusBody] = await Promise.all(requests);

      const allPositions = Array.isArray(positionsBody?.items)
        ? positionsBody.items
        : Array.isArray(positionsBody?.data)
          ? positionsBody.data
          : Array.isArray(positionsBody)
            ? positionsBody
            : [];

      const allOrders = Array.isArray(ordersBody?.items)
        ? ordersBody.items
        : Array.isArray(ordersBody?.data)
          ? ordersBody.data
          : Array.isArray(ordersBody)
            ? ordersBody
            : [];

      let positions = allPositions;
      let orders = allOrders;

      if (symbolFilter) {
        positions = positions.filter((p) => String(p?.symbol || "").toUpperCase() === symbolFilter);
        orders = orders.filter((o) => String(o?.symbol || "").toUpperCase() === symbolFilter);
      }

      if (accountFilter) {
        positions = positions.filter((p) => String(p?.accountId || "") === accountFilter);
      }

      const totalOpenPositions = allPositions.length;
      const totalOpenOrders = allOrders.length;
      const filteredPositions = positions.length;
      const filteredOrders = orders.length;
      const filteredTotal = filteredOrders + filteredPositions;
      const ordersPct = pct(filteredOrders, filteredTotal);
      const positionsPct = pct(filteredPositions, filteredTotal);

      const summary = {
        symbol: symbolFilter,
        accountId: accountFilter,
        positionsCount: filteredPositions,
        ordersCount: filteredOrders,
        totalOpenPositions,
        totalOpenOrders,
      };

      const ratioBar = buildRatioBar(filteredOrders, filteredPositions);
      const overviewMarkdown = [
        `Ordini aperti: **${filteredOrders}** (${ordersPct}%)`,
        "",
        `\`${ratioBar}\``,
        "",
        `Posizioni aperte: **${filteredPositions}** (${positionsPct}%)`,
        "",
        "| Metrica | Valore |",
        "| --- | ---: |",
        `| Totale ordini aperti | ${totalOpenOrders} |`,
        `| Totale posizioni aperte | ${totalOpenPositions} |`,
        `| Ordini aperti (filtrati) | ${filteredOrders} |`,
        `| Posizioni aperte (filtrate) | ${filteredPositions} |`,
        `| Filtro simbolo | ${symbolFilter || "-"} |`,
        `| Filtro accountId | ${accountFilter || "-"} |`,
      ].join("\n");

      logger?.info?.(
        `[mcp/broker_ibkr_snapshot] positions=${summary.positionsCount} orders=${summary.ordersCount} symbol=${summary.symbol || "-"} accountId=${summary.accountId || "-"}`
      );

      const data = {
        summary,
        overviewMarkdown,
        positions,
        orders,
      };
      if (includeWsStatus) {
        data.wsStatus = wsStatusBody?.data ?? wsStatusBody ?? null;
      }

      return { ok: true, data };
    } catch (err) {
      logger?.warning?.(`[mcp/broker_ibkr_snapshot] fetch failed: ${err?.message || String(err)}`);
      return {
        ok: false,
        error: { code: "FETCH_ERROR", message: err?.message || String(err) },
      };
    }
  },
};
