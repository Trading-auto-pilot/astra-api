"use strict";

const { traefikFetch } = require("./_http");

function mapBridgeFallbackGwStatus(gwStatus) {
  const s = String(gwStatus || "").toUpperCase();
  if (s === "GW_BRIDGE_OK") return "READY";
  if (s === "GW_NO_AUTH") return "NEED_AUTH";
  if (s === "GW_DOWN") return "DOWN";
  return "UNKNOWN";
}

// Mirrors frontend logic in astraai/src/layouts/MainLayout.tsx
function computeConnectionStatus(telemetry, fallback) {
  const authStatus = telemetry?.authStatus ?? null;
  const tickle = telemetry?.tickle ?? null;
  const ssodh = telemetry?.ssodhInit ?? null;

  const authOk = authStatus?.status === 200 && !authStatus?.error;
  const tickleOk = tickle?.status === 200 && !tickle?.error;
  const ssodhAuthOk = ssodh?.authStatus?.status === 200 && !ssodh?.authStatus?.error;
  const ssodhInitOk = ssodh?.ssodhInit?.status === 200 && !ssodh?.ssodhInit?.error;
  const ssodhKo = !ssodhAuthOk || !ssodhInitOk;

  if (!tickleOk && !tickle?.data?.session) return "DOWN";
  if (!authOk && !tickleOk && ssodhKo) return "DOWN";

  const a =
    authStatus?.data ??
    tickle?.data?.iserver?.authStatus ??
    ssodh?.authStatus?.data ??
    null;

  if (!a && (authOk || tickleOk)) return "NEED_AUTH";
  if (a?.authenticated === false || a?.connected === false) return "NEED_AUTH";
  if (a?.competing === true) return "COMPETING";

  if (
    a?.authenticated === true &&
    a?.connected === true &&
    a?.competing === false &&
    (authOk || tickleOk)
  ) {
    return "READY";
  }

  return fallback && fallback !== "UNKNOWN" ? fallback : "DOWN";
}

// Mirrors frontend logic in astraai/src/layouts/MainLayout.tsx
function computeMarketDataStatus(telemetry) {
  const hmds = telemetry?.tickle?.data?.hmds;
  if (hmds?.error) return "DOWN";
  if (hmds?.authStatus?.connected === true) return "UP";
  return "DOWN";
}

module.exports = {
  name: "ibkr_keepalive_status",
  description:
    "Checks IBKR session status using frontend-equivalent aggregation. Returns one of READY/NEED_AUTH/COMPETING/DOWN and marketDataActive.",

  inputSchema: {
    include_raw: {
      type: "boolean",
      description: "If true, includes raw payloads from ibkr-bridge and ibkr-keepalive (default: false)",
      required: false,
    },
  },

  async handler(ctx, input) {
    const { logger } = ctx;

    try {
      const [bridgeInfo, keepaliveInfo] = await Promise.all([
        traefikFetch("/ibkr-bridge/status/info"),
        traefikFetch("/ibkr-keepalive/status/info"),
      ]);

      const conn = bridgeInfo?.Connectivity || {};
      const telemetry = {
        authStatus: {
          status: bridgeInfo?.authStatus?.status ?? conn?.authStatusCode ?? null,
          data: bridgeInfo?.authStatus?.data ?? conn?.lastAuthPayload ?? null,
          error: bridgeInfo?.authStatus?.error ?? conn?.authError ?? null,
        },
        tickle: {
          status: conn?.lastTickleStatus ?? null,
          data: conn?.lastTicklePayload ?? null,
          error: conn?.lastTickleError ?? null,
        },
        ssodhInit: conn?.lastSsodhInitPayload ?? null,
      };

      const fallback = mapBridgeFallbackGwStatus(conn?.gwStatus);
      const aggregatedStatus = computeConnectionStatus(telemetry, fallback);
      const marketDataStatus = computeMarketDataStatus(telemetry);
      const marketDataActive = marketDataStatus === "UP";

      const keepalive = keepaliveInfo?.keepalive || {};
      const summary = {
        status: aggregatedStatus,
        marketDataActive,
        marketDataStatus,
        env: bridgeInfo?.ENV || keepaliveInfo?.ENV || null,
        bridgeGwStatus: conn?.gwStatus || null,
        bridgeAuthStatusCode: conn?.authStatusCode ?? null,
        bridgeTickleStatus: conn?.lastTickleStatus ?? null,
        bridgeLastTickleAt: conn?.lastTickleAt ?? null,
        keepaliveServiceStatus: keepaliveInfo?.STATUS || null,
        lastAuthStatus: keepalive?.lastAuthStatus ?? null,
        lastTickleStatus: keepalive?.lastTickleStatus ?? null,
        lastTickleAt: keepalive?.lastTickleAt ?? null,
      };

      logger?.info?.(
        `[mcp/ibkr_keepalive_status] status=${summary.status} marketDataActive=${summary.marketDataActive} authCode=${summary.bridgeAuthStatusCode} tickleCode=${summary.bridgeTickleStatus}`
      );

      return {
        ok: true,
        data: input?.include_raw
          ? {
              summary,
              raw: {
                bridgeInfo,
                keepaliveInfo,
                telemetry,
              },
            }
          : { summary },
      };
    } catch (err) {
      logger?.warning?.(
        `[mcp/ibkr_keepalive_status] fetch failed: ${err?.message || String(err)}`
      );
      return {
        ok: false,
        error: { code: "FETCH_ERROR", message: err?.message || String(err) },
      };
    }
  },
};
