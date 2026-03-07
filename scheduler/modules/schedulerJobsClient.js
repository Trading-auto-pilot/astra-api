// modules/schedulerJobsClient.js
"use strict";

const axios = require("axios");
const { createDatahubAdapter } = require("../../shared/datahubAdapter");

/**
 * Client for scheduler_jobs table via datahub
 *
 * @param {string} dbmanagerUrl - URL of datahub service
 * @param {object} logger - Logger instance
 */
function createSchedulerJobsClient(dbmanagerUrl, logger) {
  const api = createDatahubAdapter(axios.create({
    baseURL: dbmanagerUrl,
    timeout: 15000,
  }));

  return {
    /**
     * Get all jobs, optionally including disabled ones
     */
    async list(includeDisabled = false) {
      try {
        // For now, datahub returns all jobs - filtering can be done client-side if needed
        const res = await api.get("/api/table/scheduler_jobs");
        const items = res.data?.items ?? res.data ?? [];

        if (!includeDisabled) {
          // Filter out disabled jobs if needed
          return items.filter(job => job.enabled !== false && job.enabled !== 0);
        }

        return items;
      } catch (err) {
        logger?.error?.("[schedulerJobsClient.list] error", err.message || err);
        throw err;
      }
    },

    /**
     * Get a single job by ID
     */
    async get(id) {
      try {
        const res = await api.get(`/api/table/scheduler_jobs/${id}`);
        return res.data ?? null;
      } catch (err) {
        logger?.error?.("[schedulerJobsClient.get] error", err.message || err);
        throw err;
      }
    },

    /**
     * Create a new job
     */
    async create(payload) {
      try {
        const res = await api.post("/api/table/scheduler_jobs", payload);
        return res.data;
      } catch (err) {
        logger?.error?.("[schedulerJobsClient.create] error", err.message || err);
        throw err;
      }
    },

    /**
     * Update an existing job
     */
    async update(id, payload) {
      try {
        // Filter out read-only fields that shouldn't be updated
        const readOnlyFields = ['id', 'created_at', 'updated_at'];
        const cleanPayload = { ...payload };
        readOnlyFields.forEach(field => delete cleanPayload[field]);

        // Log if we filtered any fields
        const filteredFields = Object.keys(payload).filter(k => !Object.keys(cleanPayload).includes(k));
        if (filteredFields.length > 0) {
          logger?.log?.(`[schedulerJobsClient.update] Filtered out read-only fields: ${filteredFields.join(", ")}`);
        }

        const res = await api.put(`/api/table/scheduler_jobs/${id}`, cleanPayload);
        return res.data;
      } catch (err) {
        logger?.error?.("[schedulerJobsClient.update] error", err.message || err);
        throw err;
      }
    },

    /**
     * Update last_run_at and last_status for a job
     */
    async updateLastRun(id, { last_run, last_status, last_error = null }) {
      try {
        // Map last_run to last_run_at (correct column name in DB)
        const payload = { last_run_at: last_run, last_status };
        if (last_error !== null) {
          payload.last_error = last_error;
        }
        const res = await api.put(`/api/table/scheduler_jobs/${id}`, payload);
        return res.data;
      } catch (err) {
        logger?.error?.("[schedulerJobsClient.updateLastRun] error", err.message || err);
        throw err;
      }
    },

    /**
     * Delete a job
     */
    async delete(id) {
      try {
        const res = await api.delete(`/api/table/scheduler_jobs/${id}`);
        return res.data;
      } catch (err) {
        logger?.error?.("[schedulerJobsClient.delete] error", err.message || err);
        throw err;
      }
    },

    /**
     * Fetch all rows from scheduler_rules (up to 1000).
     * Returns raw DB rows.
     */
    async listAllRules() {
      try {
        const res = await api.get("/api/table/scheduler_rules?limit=1000");
        return res.data?.items ?? res.data ?? [];
      } catch (err) {
        logger?.error?.("[schedulerJobsClient.listAllRules] error", err.message || err);
        return [];
      }
    },

    /**
     * Replace all rules for a given job_id.
     * Deletes existing rules then inserts the new ones.
     * @param {number} jobId
     * @param {Array} rules - array of { ruleType, daysOfWeek, daysOfMonth, time }
     */
    async replaceRules(jobId, rules) {
      // 1. Fetch existing rules for this job
      let existing = [];
      try {
        const res = await api.get(`/api/table/scheduler_rules?job_id=${jobId}&limit=100`);
        existing = res.data?.items ?? res.data ?? [];
      } catch (err) {
        logger?.error?.("[schedulerJobsClient.replaceRules] error fetching existing rules", err.message || err);
      }

      // 2. Delete each existing rule
      for (const r of existing) {
        try {
          await api.delete(`/api/table/scheduler_rules/${r.id}`);
        } catch (err) {
          logger?.error?.(`[schedulerJobsClient.replaceRules] error deleting rule id=${r.id}`, err.message || err);
        }
      }

      // 3. Insert new rules
      for (const rule of (rules || [])) {
        const row = {
          job_id: jobId,
          rule_type: rule.ruleType || "daily",
          // days_of_week is a MySQL SET type: expects comma-separated string e.g. "MON,TUE"
          days_of_week: Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.length
            ? rule.daysOfWeek.join(",")
            : null,
          days_of_month: Array.isArray(rule.daysOfMonth) && rule.daysOfMonth.length
            ? rule.daysOfMonth
            : null,
          time_hhmm: rule.time || "00:00",
        };
        try {
          await api.post("/api/table/scheduler_rules", row);
        } catch (err) {
          logger?.error?.("[schedulerJobsClient.replaceRules] error inserting rule", err.message || err);
        }
      }
    },
  };
}

module.exports = {
  createSchedulerJobsClient,
};
