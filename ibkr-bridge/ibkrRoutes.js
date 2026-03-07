// ibkrRoutes.js
"use strict";

const express = require("express");

/**
 * Build IBKR-specific routes
 * @param {Function} getService - Function that returns the service instance
 * @param {Object} logger - Logger instance
 * @returns {express.Router}
 */
module.exports = (getService, logger) => {
  const router = express.Router();

  /**
   * GET /mirror/*
   * Proxy verso IBKR GW per qualsiasi endpoint.
   * Esempio: /mirror/iserver/marketdata/snapshot -> /v1/api/iserver/marketdata/snapshot
   */
  router.all("/mirror/*", async (req, res) => {
    const service = getService();
    if (!service?.connectivity?.proxyIbkr) {
      return res.status(501).json({
        ok: false,
        error: "proxyIbkr() not implemented in connectivity",
      });
    }

    const originalUrl = req.originalUrl || "";
    const pathAndQuery = originalUrl.split("?")[0] || "";
    let pathFragment = pathAndQuery.replace(/^\/mirror\/?/, "");
    if (!pathFragment) {
      return res.status(400).json({
        ok: false,
        error: "path after /mirror is required",
      });
    }

    try {
      const queryParams = { ...req.query };
      const exchangeParam =
        queryParams.exchange || queryParams.market || queryParams.venue || null;
      if (exchangeParam) {
        delete queryParams.exchange;
        delete queryParams.market;
        delete queryParams.venue;
      }

      const result = await service.connectivity.proxyIbkr(pathFragment, {
        method: req.method,
        params: queryParams,
        data: req.body,
        headers: {
          "Content-Type": req.get("Content-Type"),
        },
      });

      if (!result?.ok) {
        return res.status(result?.status || 502).json({
          ok: false,
          error: result?.error || "IBKR request failed",
          status: result?.status ?? null,
          data: result?.data ?? null,
        });
      }

      let payload = result?.data ?? null;
      if (exchangeParam && pathFragment === "iserver/secdef/search") {
        const exchange = String(exchangeParam).trim().toUpperCase();
        const filterByExchange = (items) =>
          items.filter((item) => {
            const haystack = [
              item?.companyHeader,
              item?.description,
              item?.listingExchange,
              item?.exchange,
              item?.primaryExchange,
            ]
              .filter(Boolean)
              .map((v) => String(v).toUpperCase())
              .join(" ");
            return haystack.includes(exchange);
          });

        if (exchange) {
          if (Array.isArray(payload)) {
            payload = filterByExchange(payload);
          } else if (Array.isArray(payload?.data)) {
            payload = { ...payload, data: filterByExchange(payload.data) };
          }
        }
      }

      return res.status(result?.status || 200).json(payload ?? null);
    } catch (err) {
      logger.error(
        `[${req.method} /mirror] Error: ${err?.message || String(err)}`
      );
      return res.status(500).json({
        ok: false,
        error: err?.message || String(err),
      });
    }
  });

  /**
   * GET /accounts
   * Proxy verso IBKR GW per lista account disponibili.
   */
  router.get("/accounts", async (_req, res) => {
    const service = getService();
    if (!service?.connectivity?.getAccounts) {
      return res.status(501).json({
        ok: false,
        error: "getAccounts() not implemented in connectivity",
      });
    }

    try {
      const result = await service.connectivity.getAccounts();
      if (!result?.ok) {
        return res.status(result?.status || 502).json({
          ok: false,
          error: result?.error || "IBKR request failed",
          status: result?.status ?? null,
          data: result?.data ?? null,
        });
      }

      return res.status(result?.status || 200).json(result?.data ?? null);
    } catch (err) {
      logger.error(
        `[GET /accounts] Error: ${err?.message || String(err)}`
      );
      return res.status(500).json({
        ok: false,
        error: err?.message || String(err),
      });
    }
  });

  /**
   * GET /account
   * Proxy verso IBKR GW per i dettagli account (summary + performance).
   */
  router.get("/account", async (req, res) => {
    const service = getService();
    if (!service?.connectivity?.getAccount) {
      return res.status(501).json({
        ok: false,
        error: "getAccount() not implemented in connectivity",
      });
    }

    const accountId = String(req.query.accountId ?? req.query.id ?? "").trim();
    if (!accountId) {
      return res.status(400).json({
        ok: false,
        error: "accountId query param is required",
      });
    }

    try {
      const result = await service.connectivity.getAccount(accountId);
      if (!result?.ok) {
        return res.status(result?.status || 502).json({
          ok: false,
          error: result?.error || "IBKR request failed",
          status: result?.status ?? null,
          data: result?.data ?? null,
        });
      }

      return res.status(result?.status || 200).json(result?.data ?? null);
    } catch (err) {
      logger.error(
        `[GET /account] Error: ${err?.message || String(err)}`
      );
      return res.status(500).json({
        ok: false,
        error: err?.message || String(err),
      });
    }
  });

  return router;
};
