"use strict";

const { FILTER_FIELD_MAP, ORDER_FIELD_MAP, allowedFilterNames } = require("./weightsConfig");

const getByPath = (obj, path) => {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = cur[p];
    } else {
      return undefined;
    }
  }
  return cur;
};

const getNumericField = (record, keys) => {
  for (const k of keys) {
    let v;
    if (k.includes(".")) {
      v = getByPath(record, k);
    } else if (record && typeof record === "object" && k in record) {
      v = record[k];
    }
    if (v === undefined) continue;
    const num = typeof v === "string" ? Number(v) : v;
    if (Number.isFinite(num)) return num;
  }
  return null;
};

const normalizeUserFilters = (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .filter((r) => allowedFilterNames.has(r.filter_name || r.name))
    .map((r) => ({
      name: r.filter_name || r.name,
      value: Number(r.value),
      comparator: (r.comparator || r.comp || "GT").toUpperCase(),
      enabled: r.enabled === 1 || r.enabled === true || r.enabled === "1",
    }));
};

const applyUserFilters = (records, filters) => {
  if (!Array.isArray(filters) || !filters.length) return records;
  return records.filter((rec) => {
    for (const f of filters) {
      if (!f?.enabled) continue;
      const targetKeys = FILTER_FIELD_MAP[f.name] || [];
      if (!targetKeys.length) continue;
      const recVal = getNumericField(rec, targetKeys);
      if (recVal === null) return false;
      const filterVal = Number(f.value);
      if (!Number.isFinite(filterVal)) continue;
      const cmp = (f.comparator || "GT").toUpperCase() === "LT" ? "LT" : "GT";
      if (cmp === "GT" && !(recVal >= filterVal)) return false;
      if (cmp === "LT" && !(recVal <= filterVal)) return false;
    }
    return true;
  });
};

const normalizeUserOrder = (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((r) => ({
      field: r.field || r.order_field || r.name,
      direction: (r.direction || r.dir || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC",
      order_id: Number.isFinite(Number(r.order_id)) ? Number(r.order_id) : 1,
    }))
    .filter((r) => Boolean(r.field))
    .sort((a, b) => (a.order_id || 0) - (b.order_id || 0));
};

const applyUserOrder = (records, orders) => {
  if (!Array.isArray(orders) || !orders.length) return records;
  const sorted = [...records];
  sorted.sort((a, b) => {
    for (const ord of orders) {
      const mappedKeys = ORDER_FIELD_MAP[ord.field] || [ord.field];
      const valA = getNumericField(a, mappedKeys);
      const valB = getNumericField(b, mappedKeys);
      const dir = ord.direction === "ASC" ? 1 : -1;
      if (valA === null && valB === null) continue;
      if (valA === null) return 1;
      if (valB === null) return -1;
      if (valA !== valB) return (valA - valB) * dir;
    }
    return 0;
  });
  return sorted;
};

const normalizeRecordForFilters = (record) => {
  if (!record || typeof record !== "object") return record;
  const next = { ...record };
  const tryParse = (val) => {
    if (typeof val !== "string") return val;
    try { return JSON.parse(val); } catch { return val; }
  };
  const normalizeExchange = (value) => {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const upper = raw.toUpperCase();
    if (upper.includes("NASDAQ")) return "NASDAQ";
    if (upper.includes("NEW YORK STOCK EXCHANGE") || upper === "NYSE") return "NYSE";
    if (upper.includes("NYSE AMERICAN") || upper.includes("AMEX")) return "AMEX";
    if (upper.includes("OTC")) return "OTC";
    if (upper.includes("LONDON STOCK EXCHANGE") || upper === "LSE") return "LSE";
    if (upper.includes("AUSTRALIAN SECURITIES EXCHANGE") || upper === "ASX") return "ASX";
    if (upper.includes("TORONTO STOCK EXCHANGE") || upper === "TSX") return "TSX";
    if (upper.includes("EURONEXT")) return "EURONEXT";
    if (upper.includes("FRANKFURT") || upper === "FRA") return "FRA";
    if (upper.includes("XETRA")) return "XETRA";
    if (upper.includes("SWISS") || upper === "SIX") return "SIX";
    if (upper.includes("HONG KONG") || upper === "HKEX") return "HKEX";
    if (upper.includes("TOKYO") || upper === "TSE") return "TSE";
    if (upper.includes("SHANGHAI") || upper === "SSE") return "SSE";
    if (upper.includes("SHENZHEN") || upper === "SZSE") return "SZSE";
    return raw;
  };
  if (typeof next.momentum_json === "string") next.momentum_json = tryParse(next.momentum_json);
  if (typeof next.momentum === "string") next.momentum = tryParse(next.momentum);
  if (!next.exchange && (next.exchange_full_name || next.exchangeFullName)) {
    const full = next.exchange_full_name || next.exchangeFullName;
    next.exchange = normalizeExchange(full);
    next.exchange_short = next.exchange;
  }
  return next;
};

/**
 * createFetchUserId - returns an async function to resolve user id from request headers
 */
function createFetchUserId({ axios, authServiceUrl, logger, fetchApiKeyId }) {
  const safeStr = (v) => { try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); } };
  return async function fetchUserId(req) {
    const headerUser = req?.headers?.["x-user-id"] ?? req?.headers?.["x-userid"];
    if (headerUser && Number.isFinite(Number(headerUser))) return Number(headerUser);

    const authHeader = req?.headers?.authorization;
    if (authHeader && authHeader.toLowerCase().startsWith("bearer")) {
      const url = `${authServiceUrl}/auth/admin/me`;
      try {
        const resp = await axios.get(url, { headers: { Authorization: authHeader }, timeout: 6000 });
        const me = resp.data || {};
        const id = me?.user?.id ?? me?.id ?? me?.tokenPayload?.sub;
        if (Number.isFinite(Number(id))) return Number(id);
      } catch (err) {
        logger.warning(`filterEngine fetchUserId bearer failed ${safeStr(err?.response?.data || err?.message || err)}`);
      }
    }

    const apiKeyId = req?.headers?.["x-api-key"] ?? req?.headers?.["x-api-keyid"];
    if (apiKeyId && Number.isFinite(Number(apiKeyId))) return Number(apiKeyId);

    const subjectType = (req?.headers?.["x-auth-subject-type"] || "").toLowerCase();
    const apiKeyValue = req?.headers?.["x-api-key"] || req?.headers?.["x-api-keyid"] || req?.headers?.["x-api-key-id"];
    if ((subjectType === "api_key" || apiKeyValue) && apiKeyValue) {
      const resolved = await fetchApiKeyId(apiKeyValue);
      if (resolved) return resolved;
    }

    logger.error(
      `filterEngine fetchUserId missing ${safeStr({
        headers: {
          "x-user-id": req?.headers?.["x-user-id"],
          "x-api-key-id": req?.headers?.["x-api-key-id"],
          "x-auth-subject-type": req?.headers?.["x-auth-subject-type"],
          "x-api-key": req?.headers?.["x-api-key"] ? "present" : "absent",
          auth: req?.headers?.authorization ? "present" : "absent",
        },
        path: req?.path,
        method: req?.method,
      })}`
    );
    return null;
  };
}

module.exports = {
  getByPath,
  getNumericField,
  normalizeUserFilters,
  applyUserFilters,
  normalizeUserOrder,
  applyUserOrder,
  normalizeRecordForFilters,
  createFetchUserId,
};
