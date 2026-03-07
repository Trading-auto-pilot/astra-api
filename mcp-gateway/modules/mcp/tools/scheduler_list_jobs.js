// modules/mcp/tools/scheduler_list_jobs.js
"use strict";

const { traefikFetch } = require("./_http");

module.exports = {
  name: "scheduler_list_jobs",
  description: "Lists all scheduled jobs. Returns job key, description, cron expression, enabled status, last run time and result, next scheduled run. Use include_disabled=true to also see disabled jobs.",

  inputSchema: {
    include_disabled: {
      type: "boolean",
      description: "If true, includes disabled jobs (default: false, only active jobs)",
      required: false,
    },
  },

  async handler(ctx, input) {
    const { logger } = ctx;

    const includeDisabled = input?.include_disabled === true;
    const path = includeDisabled
      ? "/scheduler/jobs?include_disabled=true"
      : "/scheduler/jobs";

    try {
      const body = await traefikFetch(path);
      const jobs = Array.isArray(body?.items) ? body.items
        : Array.isArray(body?.data) ? body.data
        : Array.isArray(body) ? body
        : [];

      logger?.info?.(`[mcp/scheduler_list_jobs] fetched ${jobs.length} job(s)`);
      return { ok: true, data: { jobs, total: jobs.length } };
    } catch (err) {
      logger?.warning?.(`[mcp/scheduler_list_jobs] fetch failed: ${err?.message || String(err)}`);
      return {
        ok: false,
        error: { code: "FETCH_ERROR", message: err?.message || String(err) },
      };
    }
  },
};
