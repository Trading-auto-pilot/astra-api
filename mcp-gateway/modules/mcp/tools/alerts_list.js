"use strict";

const { traefikFetch } = require("./_http");

const VALID_STATUSES = new Set(["sent", "failed"]);
const VALID_PROVIDERS = new Set(["email", "whatsapp"]);
const VALID_SORT_DIR = new Set(["asc", "desc"]);

module.exports = {
  name: "alerts_list",
  description: `Reads alert deliveries from alertingservice.

Filters available:
- status: sent, failed
- provider: email, whatsapp
- rule_id: numeric rule identifier
- from / to: datetime range for created_at (ISO 8601)
- limit: max rows returned (1-500, default 100)
- offset: pagination offset (default 0)
- sort_dir: asc or desc (default desc, newest first)`,

  inputSchema: {
    status: {
      type: "string",
      description: "Filter by delivery status: sent, failed",
      required: false,
    },
    provider: {
      type: "string",
      description: "Filter by provider: email, whatsapp",
      required: false,
    },
    rule_id: {
      type: "number",
      description: "Filter by rule id",
      required: false,
    },
    from: {
      type: "string",
      description: "Start datetime (ISO 8601), maps to created_at__gte",
      required: false,
    },
    to: {
      type: "string",
      description: "End datetime (ISO 8601), maps to created_at__lte",
      required: false,
    },
    limit: {
      type: "number",
      description: "Max rows to return (1-500, default 100)",
      required: false,
    },
    offset: {
      type: "number",
      description: "Pagination offset (default 0)",
      required: false,
    },
    sort_dir: {
      type: "string",
      description: "Sort direction: asc or desc (default desc)",
      required: false,
    },
  },

  validate(input) {
    if (input?.limit != null && (typeof input.limit !== "number" || input.limit < 1 || input.limit > 500)) {
      return "limit must be a number between 1 and 500";
    }
    if (input?.offset != null && (typeof input.offset !== "number" || input.offset < 0)) {
      return "offset must be a non-negative number";
    }
    if (input?.status != null) {
      const status = String(input.status).toLowerCase().trim();
      if (!VALID_STATUSES.has(status)) return "status must be one of: sent, failed";
    }
    if (input?.provider != null) {
      const provider = String(input.provider).toLowerCase().trim();
      if (!VALID_PROVIDERS.has(provider)) return "provider must be one of: email, whatsapp";
    }
    if (input?.rule_id != null && (typeof input.rule_id !== "number" || input.rule_id < 0)) {
      return "rule_id must be a non-negative number";
    }
    if (input?.sort_dir != null) {
      const sortDir = String(input.sort_dir).toLowerCase();
      if (!VALID_SORT_DIR.has(sortDir)) return "sort_dir must be 'asc' or 'desc'";
    }
    return null;
  },

  async handler(ctx, input) {
    const { logger } = ctx;

    const params = new URLSearchParams();
    const limit = input?.limit ?? 100;
    const offset = input?.offset ?? 0;
    const sortDir = String(input?.sort_dir ?? "desc").toLowerCase();

    params.set("limit", String(limit));
    params.set("offset", String(offset));
    params.set("sort_by", "id");
    params.set("sort_dir", sortDir);

    if (input?.status) params.set("status", String(input.status).toLowerCase().trim());
    if (input?.provider) params.set("provider", String(input.provider).toLowerCase().trim());
    if (input?.rule_id != null) params.set("rule_id", String(input.rule_id));
    if (input?.from) params.set("created_at__gte", String(input.from));
    if (input?.to) params.set("created_at__lte", String(input.to));

    const path = `/alertingservice/alerting-deliveries?${params.toString()}`;

    try {
      const body = await traefikFetch(path);
      const alerts = Array.isArray(body?.items)
        ? body.items
        : Array.isArray(body?.data)
          ? body.data
          : Array.isArray(body)
            ? body
            : [];

      logger?.info?.(`[mcp/alerts_list] fetched ${alerts.length} alert(s)`);
      return {
        ok: true,
        data: {
          alerts,
          total: body?.total ?? body?.count ?? alerts.length,
          limit,
          offset,
        },
      };
    } catch (err) {
      logger?.warning?.(`[mcp/alerts_list] fetch failed: ${err?.message || String(err)}`);
      return {
        ok: false,
        error: { code: "FETCH_ERROR", message: err?.message || String(err) },
      };
    }
  },
};

