"use strict";

// ---------------------------------------------------------------------------
// helpers – utility condivise per decision-engine
// ---------------------------------------------------------------------------

const axios = require("axios");
const { createHash } = require("crypto");

// --- Type helpers ----------------------------------------------------------

const asNumber = (value, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const asBool = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const norm = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(norm)) return true;
  if (["false", "0", "no", "off"].includes(norm)) return false;
  return fallback;
};

// --- Date helpers ----------------------------------------------------------

const subDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() - days);
  return next;
};

const normalizeDateParam = (value) => {
  if (!value) return null;
  return String(value).slice(0, 10);
};

const resolveSnapshotDate = (value) => {
  const normalized = normalizeDateParam(value);
  return normalized || new Date().toISOString().slice(0, 10);
};

const buildSymbolLogRef = (ticker, dateValue) => {
  const normalizedTicker = String(ticker || "").trim().toUpperCase();
  const normalizedDate = resolveSnapshotDate(dateValue);
  if (!normalizedTicker) return null;
  const hash = createHash("sha1")
    .update(`${normalizedTicker}:${normalizedDate}`)
    .digest("hex")
    .slice(0, 12);
  return `symref:${normalizedTicker}:${normalizedDate}:${hash}`;
};

// --- Candle helpers --------------------------------------------------------

const pickPrice = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const normalizeTimestamp = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    return value < 1e12 ? value * 1000 : value;
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

const normalizeCandle = (candle) => {
  return {
    high: pickPrice(candle?.h ?? candle?.high),
    low: pickPrice(candle?.l ?? candle?.low),
    close: pickPrice(candle?.c ?? candle?.close),
    volume: pickPrice(candle?.v ?? candle?.volume),
    t: normalizeTimestamp(candle?.t ?? candle?.timestamp),
  };
};

const normalizeAndSortCandles = (rawCandles) => {
  return rawCandles
    .map(normalizeCandle)
    .filter((c) => Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close))
    .sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
};

// --- Auth helpers ----------------------------------------------------------

const pickAuthHeaders = (req) => {
  const headers = {};
  const passthrough = [
    "authorization",
    "x-user-id",
    "x-api-key",
    "x-api-key-id",
    "x-api-keyid",
    "x-auth-subject-type",
  ];
  passthrough.forEach((key) => {
    const value = req?.headers?.[key];
    if (value) headers[key] = value;
  });
  return headers;
};

const fetchUserId = async (req, authServiceUrl, timeout, logger) => {
  const headerUser = req?.headers?.["x-user-id"] ?? req?.headers?.["x-userid"];
  if (headerUser && Number.isFinite(Number(headerUser))) return Number(headerUser);

  const authHeader = req?.headers?.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith("bearer")) {
    const url = `${authServiceUrl}/auth/admin/me`;
    try {
      const resp = await axios.get(url, {
        headers: { Authorization: authHeader },
        timeout,
      });
      const me = resp.data || {};
      const id = me?.user?.id ?? me?.id ?? me?.tokenPayload?.sub;
      if (Number.isFinite(Number(id))) return Number(id);
    } catch (err) {
      logger?.warning?.(
        `[decision-engine] fetchUserId bearer failed ${err?.message || String(err)}`
      );
    }
  }

  return null;
};

// --- Data helpers ----------------------------------------------------------

const isTrendOk = (row) => {
  const trend =
    row?.fullResult?.signal?.pattern?.trendOk ??
    row?.fullResult?.pattern?.trendOk ??
    row?.signal?.pattern?.trendOk ??
    row?.pattern?.trendOk ??
    row?.trendOk ??
    null;
  return trend === true;
};

const isSupportNotAvailable = (payload) => {
  const msg = String(payload?.error || payload?.message || "").toLowerCase();
  return msg.includes("support not available");
};

module.exports = {
  asNumber,
  asBool,
  subDays,
  normalizeDateParam,
  resolveSnapshotDate,
  buildSymbolLogRef,
  pickPrice,
  normalizeTimestamp,
  normalizeCandle,
  normalizeAndSortCandles,
  pickAuthHeaders,
  fetchUserId,
  isTrendOk,
  isSupportNotAvailable,
};
