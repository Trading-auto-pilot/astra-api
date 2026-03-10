"use strict";

const axios = require("axios");
const { createDatahubAdapter } = require("../../shared/datahubAdapter");
const { SchedulerEngine } = require("./schedulerEngine");

class SchedulerCore {
  /**
   * @param {object} opts
   * @param {object} opts.mainInstance - istanza di Scheduler (main.js)
   */
  constructor({ mainInstance }) {
    this.main = mainInstance;
    this.logger = mainInstance.getLogger();
    this.dbmanagerUrl = mainInstance.dbmanagerUrl;
    this.defaultTimezone = process.env.SCHEDULER_TZ || "Asia/Dubai";

    this.engine = new SchedulerEngine({
      logger: this.logger,
      defaultTimezone: this.defaultTimezone,
      dbmanagerUrl: this.dbmanagerUrl,
      getSetting: this.main.getSetting || null,
      bus: this.main.bus || null,
      env: this.main.env || process.env.ENV || "DEV",
      onJobLastRun: ({ job, status, lastRunAt }) => this._updateJobLastRunInCache(job, status, lastRunAt),
    });

    this.jobsCache = [];
  }

  async init() {
    this.logger.info("[SchedulerCore.init] Avvio scheduler...");
    await this.engine.subscribeToHooks();
    await this.reloadJobs();
  }

  /**
   * Normalize a raw scheduler_rules DB row to camelCase.
   * days_of_week is a MySQL SET type returned as comma-separated string.
   */
  _normalizeRule(row) {
    if (!row) return null;
    return {
      id:          row.id,
      ruleType:    row.rule_type    ?? "daily",
      daysOfWeek:  row.days_of_week
        ? String(row.days_of_week).split(",").map(s => s.trim()).filter(Boolean)
        : [],
      daysOfMonth: row.days_of_month ?? [],
      time:        row.time_hhmm    ?? "00:00",
    };
  }

  /**
   * Normalize a raw DB row (snake_case) to camelCase job object used by the engine.
   */
  _normalizeJob(row) {
    if (!row) return row;
    return {
      id:             row.id,
      jobKey:         row.job_key ?? row.jobKey ?? null,
      description:    row.description ?? null,
      enabled:        row.enabled,
      method:         row.method || "GET",
      url:            row.url ?? null,
      headers:        row.headers ?? null,
      body:           row.body ?? null,
      timeoutMs:      row.timeout_ms ?? row.timeoutMs ?? 15000,
      retry: {
        maxAttempts:  row.retry_max_attempts ?? row.retry?.maxAttempts ?? 1,
        backoffMs:    row.retry_backoff_ms   ?? row.retry?.backoffMs   ?? 5000,
      },
      timezone:       row.timezone || "UTC",
      rules:          row.rules ?? [],
      asyncTimeoutMs: row.async_timeout_ms ?? row.asyncTimeoutMs ?? null,
      lastRunAt:      row.last_run_at ?? row.lastRunAt ?? null,
      lastStatus:     row.last_status ?? row.lastStatus ?? null,
      lastError:      row.last_error ?? row.lastError ?? null,
      createdAt:      row.created_at ?? row.createdAt ?? null,
      updatedAt:      row.updated_at ?? row.updatedAt ?? null,
    };
  }

  async reloadJobs() {
    this.logger.info("[SchedulerCore.reloadJobs] Ricarico job da datahub...");

    // Create datahub adapter for automatic response conversion
    const http = createDatahubAdapter(axios.create({
      baseURL: this.dbmanagerUrl,
      timeout: 15000,
    }));

    const url = "/api/table/scheduler_jobs";
    let resp;
    try {
      resp = await http.get(url);
    } catch (err) {
      this.logger.error(
        "[SchedulerCore.reloadJobs] Errore chiamando datahub",
        err.message || err
      );
      throw err;
    }

    // createDatahubAdapter automatically converts { ok, data: [...] } to { items: [...] }
    const raw = Array.isArray(resp.data?.items) ? resp.data.items : (Array.isArray(resp.data) ? resp.data : []);

    // Fetch all rules from scheduler_rules and group by job_id
    let rulesByJobId = {};
    try {
      const rulesResp = await http.get("/api/table/scheduler_rules?limit=1000");
      const allRules = Array.isArray(rulesResp.data?.items) ? rulesResp.data.items : (Array.isArray(rulesResp.data) ? rulesResp.data : []);
      for (const r of allRules) {
        const jid = String(r.job_id);
        if (!rulesByJobId[jid]) rulesByJobId[jid] = [];
        rulesByJobId[jid].push(this._normalizeRule(r));
      }
    } catch (err) {
      this.logger.warning("[SchedulerCore.reloadJobs] Could not fetch scheduler_rules", err.message || err);
    }

    // Normalize to camelCase and attach rules
    this.jobsCache = raw.map(row => {
      const job = this._normalizeJob(row);
      job.rules = rulesByJobId[String(row.id)] ?? [];
      return job;
    });

    this.engine.start(this.jobsCache);

    this.logger.info(
      "[SchedulerCore.reloadJobs] Job caricati e scheduler avviato",
      { jobs: this.jobsCache.length }
    );

    return { ok: true, jobs: this.jobsCache.length };
  }

  getJobsSnapshot() {
    return this.jobsCache;
  }

  _updateJobLastRunInCache(job, status, lastRunAt) {
    if (!job?.jobKey && !job?.id) return;
    const nowIso = new Date().toISOString();
    const targetId = job?.id != null ? String(job.id) : null;
    const targetKey = job?.jobKey ? String(job.jobKey) : null;

    this.jobsCache = this.jobsCache.map((item) => {
      const itemId = item?.id != null ? String(item.id) : null;
      const itemKey = item?.jobKey ? String(item.jobKey) : null;
      const matched = (targetId && itemId === targetId) || (targetKey && itemKey === targetKey);
      if (!matched) return item;
      return {
        ...item,
        lastRunAt: lastRunAt,
        last_run_at: lastRunAt,
        lastStatus: status,
        last_status: status,
        updatedAt: nowIso,
        updated_at: nowIso,
      };
    });
  }

  /**
   * Esegue manualmente un job cercandolo per jobKey nella cache.
   * @param {string} jobKey
   * @param {object} [overrides] - override opzionali { headers, body }
   * @returns {{ ok: boolean, jobKey: string, message?: string, error?: string }}
   */
  async runJobByKey(jobKey, overrides = {}) {
    const job = this.jobsCache.find(
      (j) => j.jobKey === jobKey || j.job_key === jobKey
    );
    if (!job) {
      return { ok: false, jobKey, error: `Job "${jobKey}" non trovato nella cache` };
    }
    // Merge overrides nel job (senza mutare l'originale)
    const runJob = (overrides.headers || overrides.body !== undefined)
      ? { ...job, ...overrides }
      : job;
    this.logger.info(`[SchedulerCore.runJobByKey] Lancio manuale job=${jobKey}`);
    setImmediate(() => this.engine._runJob(runJob));
    return { ok: true, jobKey, message: `Job "${jobKey}" avviato manualmente` };
  }

  stop() {
    this.engine.stop();
  }
}

function createSchedulerCore(mainInstance) {
  return new SchedulerCore({ mainInstance });
}

module.exports = {
  SchedulerCore,
  createSchedulerCore
};
