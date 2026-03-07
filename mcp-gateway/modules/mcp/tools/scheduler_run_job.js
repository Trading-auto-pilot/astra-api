// modules/mcp/tools/scheduler_run_job.js
"use strict";

const { traefikFetch } = require("./_http");

module.exports = {
  name: "scheduler_run_job",
  description: "Manually triggers a scheduled job by its job_key. Use scheduler_list_jobs first to get the available job keys. Returns the job execution result.",

  inputSchema: {
    job_key: {
      type: "string",
      description: "The job_key of the job to run (e.g. 'daily-score-update'). Get available keys with scheduler_list_jobs.",
      required: true,
    },
  },

  validate(input) {
    if (!input?.job_key || typeof input.job_key !== "string" || !input.job_key.trim()) {
      return "job_key is required";
    }
    return null;
  },

  async handler(ctx, input) {
    const { logger } = ctx;
    const jobKey = String(input.job_key).trim();
    const path = `/scheduler/jobs/${encodeURIComponent(jobKey)}/run`;

    logger?.info?.(`[mcp/scheduler_run_job] triggering job: ${jobKey}`);

    try {
      const body = await traefikFetch(path, "POST", {});
      logger?.info?.(`[mcp/scheduler_run_job] job "${jobKey}" triggered successfully`);
      return { ok: true, data: body };
    } catch (err) {
      const msg = err?.message || String(err);
      // 404 = job key not found
      if (msg.includes("404")) {
        return {
          ok: false,
          error: { code: "JOB_NOT_FOUND", message: `Job "${jobKey}" not found. Use scheduler_list_jobs to see available keys.` },
        };
      }
      logger?.warning?.(`[mcp/scheduler_run_job] failed: ${msg}`);
      return {
        ok: false,
        error: { code: "FETCH_ERROR", message: msg },
      };
    }
  },
};
