"use strict";

const cron = require("node-cron");
const axios = require("axios");
const { randomUUID } = require("crypto");
const { resolveText } = require("../../shared/textResolver");
const { signInternalToken } = require("../../shared/internalAuth");
const { createSchedulerJobsClient } = require("./schedulerJobsClient");
const { getConfigString, getConfigInt } = require("../../shared/loadSettings");

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
   * @param {string} opts.dbmanagerUrl
   * @param {function} [opts.getSetting]
   * @param {object}   [opts.bus]   - istanza RedisBus per hook asincroni
   * @param {string}   [opts.env]   - ambiente (DEV, PROD, ...)
   */
  constructor({ logger, defaultTimezone = "UTC", dbmanagerUrl, getSetting, bus, env, onJobLastRun } = {}) {
    this.logger = logger || console;
    this.defaultTimezone = defaultTimezone;
    this.dbmanagerUrl = dbmanagerUrl;
    this.getSetting = getSetting;
    this.bus = bus || null;
    this.env = env || getConfigString(["ENV", "APP_ENV"], "DEV");
    this.serviceName = getConfigString("MICROSERVICE_NAME", "scheduler");
    this.eventsChannel = `${this.env}.${this.serviceName}.events`;
    this.tasks = [];

    // Map<jobId, { job, startedAt, timeout }> per job asincroni in attesa di hook
    this.pendingAsyncJobs = new Map();
    this._hookSubscribed = false;
    this.onJobLastRun = typeof onJobLastRun === "function" ? onJobLastRun : null;
  }

  _sanitizeHeaders(headers) {
    const safe = { ...(headers || {}) };
    if (safe["x-internal-token"]) safe["x-internal-token"] = "***";
    if (safe["X-Internal-Token"]) safe["X-Internal-Token"] = "***";
    if (safe.authorization) safe.authorization = "***";
    if (safe.Authorization) safe.Authorization = "***";
    return safe;
  }

  _serializeTask(job = {}) {
    return {
      id: job?.id ?? null,
      jobKey: job?.jobKey ?? null,
      method: job?.method ?? "GET",
      url: job?.url ?? null,
      timeoutMs: job?.timeoutMs ?? null,
      retry: job?.retry ?? null,
      openMarket: !!job?.openMarket,
      exchanges: Array.isArray(job?.exchanges) ? job.exchanges : [],
      timezone: job?.timezone ?? this.defaultTimezone,
      enabled: job?.enabled,
      rules: Array.isArray(job?.rules) ? job.rules : [],
      headers: this._sanitizeHeaders(job?.headers),
      body: job?.body ?? null,
      asyncTimeoutMs: job?.asyncTimeoutMs ?? null,
    };
  }

  async _publishTaskEvent({ eventId, severity = "info", correlationId, payload = {} }) {
    if (!this.bus || typeof this.bus.publish !== "function") return;
    const event = {
      eventKey: `${this.serviceName}.${eventId}`,
      eventId,
      service: this.serviceName,
      env: this.env,
      ts: new Date().toISOString(),
      severity,
      correlationId: correlationId || randomUUID(),
      payload,
    };
    try {
      await this.bus.publish(this.eventsChannel, event);
    } catch (err) {
      this.logger.warning(
        `[_publishTaskEvent] failed eventId=${eventId}: ${err?.message || err}`
      );
    }
  }

  /**
   * Sottoscrive il pattern <ENV>.*.status.HOOK per ricevere
   * notifiche di completamento dai task asincroni.
   */
  async subscribeToHooks() {
    if (!this.bus || this._hookSubscribed) return;
    const pattern = `${this.env}.*.status.HOOK`;
    try {
      await this.bus.psubscribe(pattern, (parsed) => {
        this._handleHookMessage(parsed);
      });
      this._hookSubscribed = true;
      this.logger.info(`[subscribeToHooks] Sottoscritto a pattern=${pattern}`);
    } catch (err) {
      this.logger.error(`[subscribeToHooks] Errore subscribe ${pattern}: ${err?.message || err}`);
    }
  }

  /**
   * Gestisce un messaggio hook ricevuto da un task asincrono.
   */
  _handleHookMessage(parsed) {
    if (!parsed || parsed.type !== "job.done") return;
    const { jobId, status } = parsed;
    if (!jobId) return;

    const pending = this.pendingAsyncJobs.get(String(jobId));
    if (!pending) return; // non lanciato dallo scheduler, ignora

    // Cancella il timeout di sicurezza
    if (pending.timeout) clearTimeout(pending.timeout);
    this.pendingAsyncJobs.delete(String(jobId));

    const norm = (status || "COMPLETED").toLowerCase();
    const finalStatus = norm === "failed" ? "error"
      : norm === "cancelled" ? "skipped"
      : "completed";

    this.logger.info(
      `[_handleHookMessage] job=${pending.job.jobKey} jobId=${jobId} status=${status} finalStatus=${finalStatus}`
    );

    if (finalStatus === "completed") {
      this._publishTaskEvent({
        eventId: "TASK.COMPLETED",
        severity: "info",
        correlationId: pending.correlationId,
        payload: {
          task: this._serializeTask(pending.job),
          async: {
            jobId: String(jobId),
            hookStatus: status || null,
            startedAt: pending.startedAt?.toISOString?.() || null,
            completedAt: new Date().toISOString(),
          },
          summary: parsed.summary || null,
        },
      });
    } else if (finalStatus === "error") {
      this._publishTaskEvent({
        eventId: "TASK.ERROR",
        severity: "error",
        correlationId: pending.correlationId,
        payload: {
          task: this._serializeTask(pending.job),
          async: {
            jobId: String(jobId),
            hookStatus: status || null,
            startedAt: pending.startedAt?.toISOString?.() || null,
            failedAt: new Date().toISOString(),
          },
          error: parsed.error || "Async hook reported failure",
          summary: parsed.summary || null,
        },
      });
    }

    this._updateLastRun(pending.job, finalStatus, {
      summary: parsed.summary,
      error: parsed.error,
    });
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
      const enabled =
        job?.enabled === true ||
        job?.enabled === 1 ||
        job?.enabled === "1" ||
        job?.enabled === "true" ||
        job?.enabled === "TRUE" ||
        job?.enabled === "True";
      if (!enabled) {
        this.logger.log?.(`[start] Skip job=${job?.jobKey || "unknown"} disabled (enabled=${job?.enabled})`);
        continue;
      }
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

    // opzionale: controllo apertura mercato per exchange specifici
    if (job.openMarket) {
      const exchanges = Array.isArray(job.exchanges) ? job.exchanges : [];
      if (exchanges.length) {
        const apiKey =
          (this.getSetting && this.getSetting("FMP_API_KEY")) ||
          getConfigString(["FMP_API_KEY", "FMP_KEY"], "") ||
          null;
        if (!apiKey) {
          this._logInfo("_runJob", `job=${job.jobKey} openMarket attivo ma manca FMP_API_KEY, procedo senza check`);
        } else {
          const base = getConfigString("FMP_BASE_URL", "https://financialmodelingprep.com");
          let anyOpen = false;
          for (const exc of exchanges) {
            const excId = String(exc || "").trim();
            if (!excId) continue;
            const mUrl = `${base}/stable/exchange-market-hours?exchange=${encodeURIComponent(excId)}&apikey=${apiKey}`;
            try {
              const resp = await axios.get(mUrl, { timeout: 6000 });
              const data = resp.data || {};
              const open =
                data.isTheStockMarketOpen ??
                data.isMarketOpen ??
                data.marketOpen ??
                data.stockMarketHours?.isTheStockMarketOpen ??
                data.stockMarketHours?.isMarketOpen ??
                false;
              if (open) {
                anyOpen = true;
                break;
              }
            } catch (err) {
              this._logError("_runJob", `check exchange ${excId} failed: ${err?.message || err}`);
            }
          }
          if (!anyOpen) {
            this._logInfo("_runJob", `job=${job.jobKey} skip perché tutti gli exchange (${exchanges.join(",")}) sono closed`);
            await this._updateLastRun(job, "skipped");
            return;
          }
        }
      }
    }

    // Risolvi placeholder [[today]], [[yesterday]], ecc. a runtime
    const resolvedUrl = resolveText(url || "");
    const resolvedHeaders = headers
      ? JSON.parse(resolveText(JSON.stringify(headers)))
      : {};
    // Inject jobKey header for downstream services if not already provided
    if (job?.jobKey && !("x-job-key" in resolvedHeaders) && !("X-Job-Key" in resolvedHeaders)) {
      resolvedHeaders["x-job-key"] = job.jobKey;
    }
    const resolvedBody = body
      ? JSON.parse(resolveText(JSON.stringify(body)))
      : undefined;
    const correlationId = randomUUID();

    await this._publishTaskEvent({
      eventId: "TASK.STARTED",
      severity: "info",
      correlationId,
      payload: {
        task: this._serializeTask(job),
        execution: {
          attempt,
          maxAttempts,
          startedAt: new Date().toISOString(),
          resolved: {
            url: resolvedUrl,
            headers: this._sanitizeHeaders(resolvedHeaders),
            body: resolvedBody ?? null,
          },
        },
      },
    });

    try {
      let isInternal = false;
      try {
        const parsed = new URL(resolvedUrl);
        isInternal = parsed.pathname.startsWith("/internal/");
      } catch {
        isInternal = String(resolvedUrl || "").includes("/internal/");
      }

      if (isInternal) {
        try {
          this.logger.info(
            `[_runJob] job=${job?.jobKey} internal endpoint detected, signing token`
          );
          let internalScope = "internal:generic";
          let internalAud = "internal";
          try {
            const parsed = new URL(resolvedUrl);
            const path = parsed.pathname || "";
            if (path.startsWith("/internal/fundamentals/user-daily-scores")) {
              internalScope = "fundamentals:update-user-daily-scores";
              internalAud = "tickerscanner";
            } else if (path.startsWith("/internal/universe/")) {
              internalScope = "universe:scan";
              internalAud = "tickerscanner";
            } else if (path.startsWith("/internal/spot-finder/")) {
              internalScope = "decision-engine:spot-finder";
              internalAud = "decision-engine";
            }
          } catch {}
          const token = await signInternalToken(
            { scp: internalScope, svc: "scheduler", jobKey: job?.jobKey },
            {
              issuer: "astraai-internal",
              audience: internalAud,
              ttlSeconds: 60,
              privateKey: getConfigString("INTERNAL_JWT_PRIVATE_KEY", ""),
            }
          );
          resolvedHeaders["x-internal-token"] = token;
        } catch (err) {
          this.logger.error(
            `[_runJob] job=${job?.jobKey} internal token error: ${err?.message || err}`
          );
        }
      }
      const safeHeaders = { ...(resolvedHeaders || {}) };
      if (safeHeaders["x-internal-token"]) safeHeaders["x-internal-token"] = "***";
      if (safeHeaders["X-Internal-Token"]) safeHeaders["X-Internal-Token"] = "***";
      this.logger.trace?.(
        `[_runJob] job=${job.jobKey} attempt=${attempt} → ${method} ${resolvedUrl} | ${JSON.stringify({
          headers: safeHeaders,
          body: resolvedBody ?? null,
        })}`
      );

      const resp = await axios({
        method: (method || "GET").toUpperCase(),
        url: resolvedUrl,
        timeout: timeoutMs || 15000,
        headers: resolvedHeaders,
        data: resolvedBody
      });

      const data = resp.data || {};

      // Task asincrono: registra in pendingAsyncJobs e attendi hook via Redis
      if (data.type === "async") {
        const asyncJobId = String(data.jobId || "");
        if (!asyncJobId) {
          this.logger.warning(
            `[_runJob] job=${job.jobKey} type=async ma manca jobId nella risposta`
          );
          await this._publishTaskEvent({
            eventId: "TASK.ERROR",
            severity: "error",
            correlationId,
            payload: {
              task: this._serializeTask(job),
              execution: { attempt, maxAttempts },
              error: "Async response missing jobId",
              response: data,
            },
          });
          await this._updateLastRun(job, "error");
          return;
        }

        const asyncTimeoutMs = job.asyncTimeoutMs || 10 * 60 * 1000; // 10 min default
        const timeout = setTimeout(() => {
          if (this.pendingAsyncJobs.has(asyncJobId)) {
            this.pendingAsyncJobs.delete(asyncJobId);
            this.logger.warning(
              `[_runJob] job=${job.jobKey} jobId=${asyncJobId} async timeout dopo ${asyncTimeoutMs}ms`
            );
            this._publishTaskEvent({
              eventId: "TASK.ERROR",
              severity: "error",
              correlationId,
              payload: {
                task: this._serializeTask(job),
                async: {
                  jobId: asyncJobId,
                  timeoutMs: asyncTimeoutMs,
                },
                error: `Async timeout after ${asyncTimeoutMs}ms`,
              },
            });
            this._updateLastRun(job, "error");
          }
        }, asyncTimeoutMs);

        this.pendingAsyncJobs.set(asyncJobId, { job, startedAt: new Date(), timeout, correlationId });
        this.logger.info(
          `[_runJob] job=${job.jobKey} jobId=${asyncJobId} type=async, in attesa di hook`
        );
        await this._updateLastRun(job, "started");
        return;
      }

      // Task sincrono: completamento immediato
      this.logger.info(
        `[_runJob] job=${job.jobKey} completato, status=${resp.status}`
      );
      await this._publishTaskEvent({
        eventId: "TASK.COMPLETED",
        severity: "info",
        correlationId,
        payload: {
          task: this._serializeTask(job),
          execution: { attempt, maxAttempts },
          response: {
            status: resp.status,
            data,
          },
        },
      });
      await this._updateLastRun(job, "completed");
    } catch (err) {
      const errData = err?.response?.data;
      const errStatus = err?.response?.status;
      const errInfo = {
        status: errStatus,
        data: errData ?? null,
      };
        this.logger.error(
        `[_runJob] job=${job.jobKey} errore attempt=${attempt}: ${err.message || err} | ${JSON.stringify(errInfo)}`
        );
      await this._updateLastRun(job, "error");

      if (attempt >= maxAttempts) {
        await this._publishTaskEvent({
          eventId: "TASK.ERROR",
          severity: "error",
          correlationId,
          payload: {
            task: this._serializeTask(job),
            execution: { attempt, maxAttempts },
            error: err?.message || String(err),
            response: errInfo,
          },
        });
      }

      if (attempt < maxAttempts) {
        setTimeout(() => this._runJob(job, attempt + 1), backoffMs);
      }
    }
  }

  async _updateLastRun(job, status, extra = {}) {
    const now = new Date();
    const date = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    const time = [
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join(":");
    const lastRunAt = `${date} ${time}`;

    if (this.onJobLastRun) {
      try {
        this.onJobLastRun({ job, status, lastRunAt, extra });
      } catch (err) {
        this.logger.warning(
          `[_updateLastRun] onJobLastRun callback failed: ${err?.message || err}`
        );
      }
    }

    // Salva in Redis KV (senza TTL) per lettura dal frontend
    if (this.bus && job?.jobKey) {
      const redisKey = this.bus.key("scheduler", "lastrun", job.jobKey);
      const data = {
        jobKey: job.jobKey,
        status,
        last_run_at: lastRunAt,
        ...(extra.summary ? { summary: extra.summary } : {}),
        ...(extra.error ? { error: extra.error } : {}),
      };
      try {
        await this.bus.set(redisKey, data);
      } catch (err) {
        this.logger.warning(
          `[_updateLastRun] Redis SET failed key=${redisKey}: ${err?.message || err}`
        );
      }
    }

    // Aggiorna su DB via datahub
    if (!this.dbmanagerUrl || !job?.id) return;
    try {
      const client = createSchedulerJobsClient(this.dbmanagerUrl, this.logger);
      await client.updateLastRun(job.id, {
        last_run: lastRunAt,
        last_status: status
      });
    } catch (err) {
      this.logger.warning(
        `[_updateLastRun] job=${job.jobKey} update failed: ${err.message || err}`
      );
    }
  }
}

module.exports = {
  SchedulerEngine
};
