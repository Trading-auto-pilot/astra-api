// modules/scheduler.js
"use strict";

const { getDbConnection, formatDateForMySQL } = require("./core");
const createLogger = require("../../shared/logger");

const MICROSERVICE = "DBManager";
const MODULE_NAME = "scheduler";
const MODULE_VERSION = "1.0";

const logger = createLogger(
  MICROSERVICE,
  MODULE_NAME,
  MODULE_VERSION,
  process.env.LOG_LEVEL || "info"
);

// Utility per JSON fields
function parseJsonField(v) {
  if (!v) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v;
}

function toJsonField(v) {
  if (v == null) return null;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/**
 * Ritorna TUTTI i job (raw, senza join con le rules).
 */
async function getAllSchedulerJobsRaw() {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query("SELECT * FROM scheduler_jobs");
    logger.info(`[getAllSchedulerJobsRaw] rows=${rows.length}`);
    return rows;
  } catch (err) {
    logger.error("[getAllSchedulerJobsRaw] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Ritorna job + regole in forma “pronta” per lo scheduler microservizio.
 * se onlyEnabled = true → filtra enabled = 1
 */
async function getSchedulerJobsForScheduler(onlyEnabled = true) {
  const conn = await getDbConnection();
  try {
    const [jobs] = await conn.query(
      onlyEnabled
        ? "SELECT * FROM scheduler_jobs WHERE enabled = 1"
        : "SELECT * FROM scheduler_jobs"
    );

    if (!Array.isArray(jobs) || jobs.length === 0) {
      logger.info("[getSchedulerJobsForScheduler] no jobs found");
      return [];
    }

    const jobIds = jobs.map((j) => j.id).filter(Boolean);

    let rules = [];
    if (jobIds.length) {
      [rules] = await conn.query(
        "SELECT * FROM scheduler_rules WHERE job_id IN (?) ORDER BY id",
        [jobIds]
      );
    }

    const rulesByJob = new Map();
    for (const r of rules) {
      if (!rulesByJob.has(r.job_id)) rulesByJob.set(r.job_id, []);
      rulesByJob.get(r.job_id).push({
        id: r.id,
        ruleType: r.rule_type, // 'daily' | 'weekly' | 'monthly'
        daysOfWeek: r.days_of_week
          ? String(r.days_of_week).split(",").filter(Boolean)
          : [],
        daysOfMonth: r.days_of_month ? parseJsonField(r.days_of_month) || [] : [],
        time: r.time_hhmm, // HH:MM
      });
    }

    const out = jobs.map((j) => ({
      id: j.id,
      jobKey: j.job_key,
      description: j.description,
      enabled: !!j.enabled,
      openMarket: !!j.market_aware,
      exchanges: parseJsonField(j.market_exchanges) || [],
      method: j.method || "GET",
      url: j.url,
      headers: parseJsonField(j.headers) || {},
      body: parseJsonField(j.body) || null,
      timeoutMs: j.timeout_ms || 15000,
      retry: {
        maxAttempts: j.retry_max_attempts || 1,
        backoffMs: j.retry_backoff_ms || 5000,
      },
      timezone: j.timezone || "UTC",
      // include both camelCase and snake_case for frontend compatibility
      lastRunAt: j.last_run_at || null,
      last_run_at: j.last_run_at || null,
      lastStatus: j.last_status || null,
      last_status: j.last_status || null,
      rules: rulesByJob.get(j.id) || [],
    }));

    logger.info(
      `[getSchedulerJobsForScheduler] jobs=${out.length} rules=${rules.length}`
    );
    return out;
  } catch (err) {
    logger.error("[getSchedulerJobsForScheduler] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Crea un nuovo job + regole.
 * payload:
 * {
 *   jobKey, description, enabled, method, url,
 *   headers, body, timeoutMs, retry{maxAttempts,backoffMs},
 *   timezone,
 *   rules: [{ ruleType, daysOfWeek, daysOfMonth, time }]
 * }
 */
async function createSchedulerJobWithRules(payload) {
  const conn = await getDbConnection();
  try {
    await conn.beginTransaction();

    const retry = payload.retry || {};
    const [resJob] = await conn.query(
      `INSERT INTO scheduler_jobs
         (job_key, description, enabled, market_aware, market_exchanges, method, url, headers, body,
          timeout_ms, retry_max_attempts, retry_backoff_ms, timezone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.jobKey,
        payload.description || null,
        payload.enabled ? 1 : 0,
        payload.openMarket ? 1 : 0,
        toJsonField(payload.exchanges || null),
        payload.method || "GET",
        payload.url,
        toJsonField(payload.headers || null),
        toJsonField(payload.body || null),
        payload.timeoutMs || 15000,
        retry.maxAttempts || 1,
        retry.backoffMs || 5000,
        payload.timezone || "UTC",
      ]
    );

    const jobId = resJob.insertId;

    const rules = Array.isArray(payload.rules) ? payload.rules : [];
    for (const r of rules) {
      await conn.query(
        `INSERT INTO scheduler_rules
           (job_id, rule_type, days_of_week, days_of_month, time_hhmm)
           VALUES (?, ?, ?, ?, ?)`,
        [
          jobId,
          r.ruleType,
          r.daysOfWeek && r.daysOfWeek.length ? r.daysOfWeek.join(",") : null,
          r.daysOfMonth && r.daysOfMonth.length
            ? toJsonField(r.daysOfMonth)
            : null,
          r.time,
        ]
      );
    }

    await conn.commit();

    logger.info(
      `[createSchedulerJobWithRules] jobId=${jobId} rules=${rules.length}`
    );
    return { ok: true, jobId, rules: rules.length };
  } catch (err) {
    await conn.rollback();
    logger.error("[createSchedulerJobWithRules] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Aggiorna un job + sostituisce completamente le sue regole.
 */
async function updateSchedulerJobWithRules(jobId, payload) {
  const conn = await getDbConnection();
  try {
    await conn.beginTransaction();

    const retry = payload.retry || {};

    const [resUpd] = await conn.query(
      `UPDATE scheduler_jobs
         SET job_key = ?, description = ?, enabled = ?, method = ?, url = ?,
             headers = ?, body = ?, timeout_ms = ?,
             retry_max_attempts = ?, retry_backoff_ms = ?, timezone = ?,
             market_aware = ?, market_exchanges = ?
         WHERE id = ?`,
      [
        payload.jobKey,
        payload.description || null,
        payload.enabled ? 1 : 0,
        payload.method || "GET",
        payload.url,
        toJsonField(payload.headers || null),
        toJsonField(payload.body || null),
        payload.timeoutMs || 15000,
        retry.maxAttempts || 1,
        retry.backoffMs || 5000,
        payload.timezone || "UTC",
        payload.openMarket ? 1 : 0,
        toJsonField(payload.exchanges || null),
        jobId,
      ]
    );

    if (!resUpd.affectedRows) {
      await conn.rollback();
      logger.warning(
        `[updateSchedulerJobWithRules] jobId=${jobId} not found for update`
      );
      return { ok: false, notFound: true };
    }

    await conn.query("DELETE FROM scheduler_rules WHERE job_id = ?", [jobId]);

    const rules = Array.isArray(payload.rules) ? payload.rules : [];
    for (const r of rules) {
      await conn.query(
        `INSERT INTO scheduler_rules
           (job_id, rule_type, days_of_week, days_of_month, time_hhmm)
           VALUES (?, ?, ?, ?, ?)`,
        [
          jobId,
          r.ruleType,
          r.daysOfWeek && r.daysOfWeek.length ? r.daysOfWeek.join(",") : null,
          r.daysOfMonth && r.daysOfMonth.length
            ? toJsonField(r.daysOfMonth)
            : null,
          r.time,
        ]
      );
    }

    await conn.commit();

    logger.info(
      `[updateSchedulerJobWithRules] jobId=${jobId} rules=${rules.length}`
    );
    return { ok: true, jobId, rules: rules.length };
  } catch (err) {
    await conn.rollback();
    logger.error("[updateSchedulerJobWithRules] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Cancella un job (le regole vanno in cascade).
 */
async function deleteSchedulerJob(jobId) {
  const conn = await getDbConnection();
  try {
    const [res] = await conn.query(
      "DELETE FROM scheduler_jobs WHERE id = ?",
      [jobId]
    );
    logger.info(
      `[deleteSchedulerJob] jobId=${jobId} affectedRows=${res.affectedRows}`
    );
    return { ok: true, affectedRows: res.affectedRows };
  } catch (err) {
    logger.error("[deleteSchedulerJob] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Aggiorna last_run_at e last_status per un job.
 */
async function updateSchedulerJobLastRun(jobId, payload) {
  const conn = await getDbConnection();
  try {
    const { last_run_at, last_status } = payload || {};
    const isNumericId = typeof jobId === "number" || /^\d+$/.test(String(jobId || ""));
    const whereField = isNumericId ? "id" : "job_key";
    const [res] = await conn.query(
      `
      UPDATE scheduler_jobs
      SET last_run_at = ?, last_status = ?
      WHERE ${whereField} = ?
      `,
      [formatDateForMySQL(last_run_at) || null, last_status || null, jobId]
    );
    logger.info(
      `[updateSchedulerJobLastRun] jobId=${jobId} field=${whereField} affectedRows=${res.affectedRows}`
    );
    return { ok: true, updated: res.affectedRows };
  } catch (err) {
    logger.error("[updateSchedulerJobLastRun] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Legge un singolo job con rules.
 */
async function getSchedulerJobById(jobId) {
  const conn = await getDbConnection();
  try {
    const [jobs] = await conn.query(
      "SELECT * FROM scheduler_jobs WHERE id = ?",
      [jobId]
    );
    if (!jobs.length) return null;

    const job = jobs[0];

    const [rules] = await conn.query(
      "SELECT * FROM scheduler_rules WHERE job_id = ? ORDER BY id",
      [jobId]
    );

    const out = {
      id: job.id,
      jobKey: job.job_key,
      description: job.description,
      enabled: !!job.enabled,
      method: job.method || "GET",
      url: job.url,
      openMarket: !!job.market_aware,
      exchanges: parseJsonField(job.market_exchanges) || [],
      headers: parseJsonField(job.headers) || {},
      body: parseJsonField(job.body) || null,
      timeoutMs: job.timeout_ms || 15000,
      retry: {
        maxAttempts: job.retry_max_attempts || 1,
        backoffMs: job.retry_backoff_ms || 5000,
      },
      timezone: job.timezone || "UTC",
      lastRunAt: job.last_run_at || null,
      last_run_at: job.last_run_at || null,
      lastStatus: job.last_status || null,
      last_status: job.last_status || null,
      rules: rules.map((r) => ({
        id: r.id,
        ruleType: r.rule_type,
        daysOfWeek: r.days_of_week
          ? String(r.days_of_week).split(",").filter(Boolean)
          : [],
        daysOfMonth: r.days_of_month ? parseJsonField(r.days_of_month) || [] : [],
        time: r.time_hhmm,
      })),
    };

    logger.info(`[getSchedulerJobById] jobId=${jobId} rules=${rules.length}`);
    return out;
  } catch (err) {
    logger.error("[getSchedulerJobById] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  getAllSchedulerJobsRaw,
  getSchedulerJobsForScheduler,
  createSchedulerJobWithRules,
  updateSchedulerJobWithRules,
  deleteSchedulerJob,
  getSchedulerJobById,
  updateSchedulerJobLastRun,
};
