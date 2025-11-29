"use strict";

const cron = require("node-cron");
const axios = require("axios");

// Mapping giorno-settimana → formati cron
const DOW_MAP = {
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
  SUN: 0   // node-cron accetta 0 o 7 per domenica
};

class SchedulerEngine {
  /**
   * @param {object} opts
   * @param {object} opts.logger    - logger del microservizio
   * @param {string} opts.defaultTimezone
   */
  constructor({ logger, defaultTimezone = "UTC" } = {}) {
    this.logger = logger || console;
    this.defaultTimezone = defaultTimezone;
    this.tasks = [];
  }

  _logInfo(fn, msg, extra) {
    if (extra) this.logger.info(`[${fn}] ${msg}`, extra);
    else this.logger.info(`[${fn}] ${msg}`);
  }

  _logError(fn, msg, extra) {
    if (extra) this.logger.error(`[${fn}] ${msg}`, extra);
    else this.logger.error(`[${fn}] ${msg}`);
  }

  stop() {
    for (const t of this.tasks) {
      try { t.task.stop(); } catch {}
    }
    this.tasks = [];
  }

  /**
   * Avvia tutti i job (sostituisce quelli esistenti)
   * @param {Array} jobs
   */
  start(jobs = []) {
    this.stop();

    if (!Array.isArray(jobs) || !jobs.length) {
      this.logger.info("[start] Nessun job da schedulare");
      return;
    }

    for (const job of jobs) {
      if (!job.enabled) continue;
      if (!job.rules || !job.rules.length) continue;

      for (const rule of job.rules) {
        const cronExprs = this._buildCronFromRule(rule);
        for (const expr of cronExprs) {
          const tz = job.timezone || this.defaultTimezone;

          const task = cron.schedule(
            expr,
            () => this._runJob(job),
            { timezone: tz }
          );

          this.tasks.push({ jobKey: job.jobKey, expr, task });
        this.logger.info(
          `[start] Registrato job=${job.jobKey} cron="${expr}" tz=${tz}`
        );
        }
      }
    }
  }

  _buildCronFromRule(rule) {
    // supportiamo sia rule.time che rule.times[]
    const times = rule.times
      ? (Array.isArray(rule.times) ? rule.times : [rule.times])
      : (rule.time ? [rule.time] : []);

    if (!times.length) throw new Error("rule senza time/times");

    const list = [];

    for (const t of times) {
      const [hh, mm] = String(t).split(":").map(v => parseInt(v, 10));
      if (Number.isNaN(hh) || Number.isNaN(mm)) {
        throw new Error(`orario non valido: ${t}`);
      }

      if (rule.ruleType === "weekly") {
        const dows = (rule.daysOfWeek || []).map(d => DOW_MAP[String(d).toUpperCase()]);
        if (!dows.length) throw new Error("weekly rule senza daysOfWeek");
        const dowExpr = dows.join(",");
        // mm hh * * dow
        list.push(`${mm} ${hh} * * ${dowExpr}`);
      } else if (rule.ruleType === "monthly") {
        const doms = (rule.daysOfMonth || []).map(d => parseInt(d, 10)).filter(Boolean);
        if (!doms.length) throw new Error("monthly rule senza daysOfMonth");
        const domExpr = doms.join(",");
        // mm hh dom * *
        list.push(`${mm} ${hh} ${domExpr} * *`);
      } else if (rule.ruleType === "daily") {
        // mm hh * * *
        list.push(`${mm} ${hh} * * *`);
      } else {
        throw new Error(`ruleType non supportato: ${rule.ruleType}`);
      }
    }

    return list;
  }

  async _runJob(job, attempt = 1) {
    const { method, url, headers, body, timeoutMs, retry } = job;
    const maxAttempts = retry?.maxAttempts || 1;
    const backoffMs = retry?.backoffMs || 5000;

    try {
        this.logger.info(
        `[_runJob] job=${job.jobKey} attempt=${attempt} → ${method} ${url}`
        );

      const resp = await axios({
        method: (method || "GET").toUpperCase(),
        url,
        timeout: timeoutMs || 15000,
        headers: headers || {},
        data: body || undefined
      });

        this.logger.info(
        `[_runJob] job=${job.jobKey} completato, status=${resp.status}`
        );
    } catch (err) {
        this.logger.error(
        `[_runJob] job=${job.jobKey} errore attempt=${attempt}: ${err.message || err}`
        );

      if (attempt < maxAttempts) {
        setTimeout(() => this._runJob(job, attempt + 1), backoffMs);
      }
    }
  }
}

module.exports = {
  SchedulerEngine
};
