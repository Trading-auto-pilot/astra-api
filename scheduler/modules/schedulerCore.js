"use strict";

const axios = require("axios");
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
    });

    this.jobsCache = [];
  }

  async init() {
    this.logger.info("[SchedulerCore.init] Avvio scheduler...");
    await this.engine.subscribeToHooks();
    await this.reloadJobs();
  }

  async reloadJobs() {
    this.logger.info("[SchedulerCore.reloadJobs] Ricarico job da dbManager...");

    const url = `${this.dbmanagerUrl}/scheduler/jobs`;
    let resp;
    try {
      resp = await axios.get(url, { timeout: 15000 });
    } catch (err) {
      this.logger.error(
        "[SchedulerCore.reloadJobs] Errore chiamando dbManager",
        err.message || err
      );
      throw err;
    }

    if (!resp.data || !resp.data.ok) {
      const msg = `Risposta non valida da dbManager: ${JSON.stringify(resp.data)}`;
      this.logger.error("[SchedulerCore.reloadJobs] " + msg);
      throw new Error(msg);
    }

    const items = Array.isArray(resp.data.items) ? resp.data.items : [];
    this.jobsCache = items;

    this.engine.start(items);

    this.logger.info(
      "[SchedulerCore.reloadJobs] Job caricati e scheduler avviato",
      { jobs: items.length }
    );

    return { ok: true, jobs: items.length };
  }

  getJobsSnapshot() {
    return this.jobsCache;
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
