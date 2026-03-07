// modules/mcp/tools/read_logs.js
"use strict";

const { traefikFetch } = require("./_http");

const VALID_LEVELS = new Set(["trace", "log", "info", "warning", "error"]);

module.exports = {
  name: "read_logs",
  description: `Reads system logs from the database.

Filters available:
- level: one or more of trace, log, info, warning, error (comma-separated = OR)
- microservice: exact service name (e.g. "tickerscanner", "decision-engine")
- module_name: filter by module name inside the service
- function_name: filter by function name
- from / to: date-time range (ISO 8601, e.g. "2026-03-01T00:00:00")
- message: exact message match; use comma-separated values for OR (e.g. "timeout,ECONNREFUSED")
- limit: max rows returned (1–1000, default 100)
- offset: pagination offset
- sort_dir: "asc" or "desc" (default "desc", newest first)

Note: message filtering is exact-match only (no fuzzy/LIKE). Use comma-separated values to match multiple messages.`,

  inputSchema: {
    level:         { type: "string",  description: "Log levels to include, comma-separated: trace,log,info,warning,error", required: false },
    microservice:  { type: "string",  description: "Filter by service name (e.g. tickerscanner)", required: false },
    module_name:   { type: "string",  description: "Filter by module name inside the service", required: false },
    function_name: { type: "string",  description: "Filter by function name", required: false },
    from:          { type: "string",  description: "Start datetime (ISO 8601), e.g. 2026-03-01T00:00:00", required: false },
    to:            { type: "string",  description: "End datetime (ISO 8601), e.g. 2026-03-05T23:59:59", required: false },
    message:       { type: "string",  description: "Exact message match; use comma-separated for OR (e.g. 'timeout,ECONNREFUSED')", required: false },
    limit:         { type: "number",  description: "Max rows to return (1–1000, default 100)", required: false },
    offset:        { type: "number",  description: "Pagination offset (default 0)", required: false },
    sort_dir:      { type: "string",  description: "Sort direction: asc or desc (default desc = newest first)", required: false },
  },

  validate(input) {
    if (input?.limit != null && (typeof input.limit !== "number" || input.limit < 1 || input.limit > 1000)) {
      return "limit must be a number between 1 and 1000";
    }
    if (input?.offset != null && (typeof input.offset !== "number" || input.offset < 0)) {
      return "offset must be a non-negative number";
    }
    if (input?.level != null) {
      const parts = String(input.level).split(",").map(s => s.trim()).filter(Boolean);
      const invalid = parts.filter(p => !VALID_LEVELS.has(p));
      if (invalid.length) return `invalid level(s): ${invalid.join(", ")}. Valid: trace, log, info, warning, error`;
    }
    if (input?.sort_dir != null && !["asc", "desc"].includes(String(input.sort_dir).toLowerCase())) {
      return "sort_dir must be 'asc' or 'desc'";
    }
    return null;
  },

  async handler(ctx, input) {
    const { logger } = ctx;

    const params = new URLSearchParams();

    const limit    = input?.limit    ?? 100;
    const offset   = input?.offset   ?? 0;
    const sort_dir = input?.sort_dir ?? "desc";

    params.set("limit",    String(limit));
    params.set("offset",   String(offset));
    params.set("sort_by",  "id");
    params.set("sort_dir", sort_dir);

    if (input?.level)         params.set("level",        input.level);
    if (input?.microservice)  params.set("microservice",  input.microservice);
    if (input?.module_name)   params.set("moduleName",    input.module_name);
    if (input?.function_name) params.set("functionName",  input.function_name);
    if (input?.message)       params.set("message",       input.message);

    // Date range via datahub __ suffix operators
    if (input?.from) params.set("timestamp__gte", input.from);
    if (input?.to)   params.set("timestamp__lte", input.to);

    const path = `/cachemanager/Log?${params.toString()}`;

    try {
      const body = await traefikFetch(path);
      const logs = Array.isArray(body?.data)  ? body.data
        : Array.isArray(body?.items) ? body.items
        : Array.isArray(body)        ? body
        : body?.data ?? body?.items ?? [];

      logger?.info?.(`[mcp/read_logs] fetched ${Array.isArray(logs) ? logs.length : "?"} log entries`);
      return {
        ok: true,
        data: {
          logs,
          total: body?.total ?? body?.count ?? null,
          limit,
          offset,
        },
      };
    } catch (err) {
      logger?.warning?.(`[mcp/read_logs] fetch failed: ${err?.message || String(err)}`);
      return {
        ok: false,
        error: { code: "FETCH_ERROR", message: err?.message || String(err) },
      };
    }
  },
};
