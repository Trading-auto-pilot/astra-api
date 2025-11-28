// modules/main.js — TEMPLATE DEFINITIVO
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const createLogger = require("../../shared/logger");
const { initializeSettings, getSetting } = require("../../shared/loadSettings");
const { RedisBus } = require("../../shared/redisBus");
const { asBool, asInt } = require("../../shared/helpers");

const {
  createScanJob,
  updateScanJob,
  getScanJob,
  getActiveJobs,
  buildFundamentalsRecord
} = require("./scanJob");

const ScreenerService = require("./screenerService");
const FmpFundamentalsService = require("./fmpFundamentalsService");
const ScoringService = require("./scoringService");
const MomentumCalculator = require("./momentumCalculator");



// =========================================================
// PLACEHOLDER da sostituire via script di scaffolding
// =========================================================
const MICROSERVICE    = "tickerScanner";
const MODULE_NAME     = "main";
const MODULE_VERSION  = "0.1.0";    // e.g. "0.1.0"



function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// Converte una riga della tabella fundamentals in un record come quelli di scoringService
function mapDbRowToScoredRecord(row) {

  let momentum = {};

  if (row.momentum_json) {
    if (typeof row.momentum_json === "string") {
      // è una stringa JSON, la parsiamo
      try {
        momentum = JSON.parse(row.momentum_json);
      } catch (e) {
        momentum = {};
      }
    } else {
      // è già un oggetto (tipo JSON MySQL)
      momentum = row.momentum_json;
    }
  }

  return {
    symbol: row.symbol,
    sector: row.sector,
    industry: row.industry,
    scores: {
      valuation: {
        score: row.valuation_score,
        components: {
          pe: row.pe,
          pb: row.pb,
          dcfUpside: row.dcf_upside,
          peScore: row.pe_score,
          pbScore: row.pb_score,
          dcfScore: row.dcf_score,
          ratingScore: row.rating_score,
        },
      },
      quality: {
        score: row.quality_score,
        components: {
          roe: row.roe,
          roa: row.roa,
          opMargin: row.op_margin,
          piotroski: row.piotroski,
          roeScore: row.roe_score,
          roaScore: row.roa_score,
          opMarginScore: row.op_margin_score,
          piotScore: row.piot_score,
        },
      },
      risk: {
        score: row.risk_score,
        components: {
          beta: row.beta,
          debtEq: row.debt_equity,
          altmanZ: row.altman_z,
          betaScore: row.beta_score,
          debtEqScore: row.debt_equity_score,
          altmanScore: row.altman_z_score,
        },
      },
      momentum,
      totalScore: row.total_score,
    },
  };
}


class TickerScanner {
  constructor() {

    // =====================================================
    // URL DI TUTTI I MICROSERVIZI STANDARD DEL SISTEMA
    // =====================================================

    //     // Auto-generated service URLs from doc/ports.json
    this.dbmanagerUrl = process.env.DBMANAGER_URL || "http://dbmanager:3002";
    this.marketsimulatorUrl = process.env.MARKETSIMULATOR_URL || "http://marketsimulator:3003";
    this.ordersimulatorUrl = process.env.ORDERSIMULATOR_URL || "http://ordersimulator:3004";
    this.orderlistnerUrl = process.env.ORDERLISTNER_URL || "http://orderlistner:3005";
    this.cachemanagerUrl = process.env.CACHEMANAGER_URL || "http://cachemanager:3006";
    this.strategyUtilsUrl = process.env.STRATEGYUTILS_URL || "http://strategyUtils:3007";
    this.alertingserviceUrl = process.env.ALERTINGSERVICE_URL || "http://alertingservice:3008";
    this.capitalmanagerUrl = process.env.CAPITALMANAGER_URL || "http://capitalmanager:3009";
    this.smaUrl = process.env.SMA_URL || "http://sma:3010";
    this.sltpUrl = process.env.SLTP_URL || "http://sltp:3011";
    this.livemarketlistnerUrl = process.env.LIVEMARKETLISTNER_URL || "http://livemarketlistner:3012";
    this.tickerscannerUrl = process.env.TICKERSCANNER_URL || "http://tickerscanner:3013";


    // =====================================================
    // Ambiente
    // =====================================================
    this.env = process.env.ENV || "DEV";

    // =====================================================
    // Canali Redis standard
    // =====================================================
    this.redisTelemetyChannel = `${this.env}.${MICROSERVICE}.telemetry`;
    this.redisStatusChannel   = `${this.env}.${MICROSERVICE}.status`;
    this.redisDataChannel     = `${this.env}.${MICROSERVICE}.data`;
    this.redisLogsChannel     = `${this.env}.${MICROSERVICE}.logs`;

    // Stato del modulo
    this._status       = "STARTING";
    this.statusDetails = null;

    // =====================================================
    // Configurazione standard dei canali del Redis Bus
    // =====================================================
    this.communicationChannels = {
      telemetry: { on: true, params: { intervalsMs: 1000 } },
      metrics:   { on: true, params: { intervalsMs: 1000 } },
      data:      { on: true, params: { intervalsMs: 0    } },
      logs:      { on: true, params: { intervalsMs: 0    } },
    };

    // =====================================================
    // Redis BUS
    // =====================================================
    this.bus = new RedisBus({
      channels: this.communicationChannels,
      name: MICROSERVICE
    });

    // =====================================================
    // LOGGER
    // =====================================================
    this.logger = createLogger(
      MICROSERVICE,
      MODULE_NAME,
      MODULE_VERSION,
      process.env.LOG_LEVEL || "info",
      {
        bus: null,
        busTopicPrefix: this.env,
        console: true,
        enqueueDb: true,
      }
    );

    this.bus.setLogger(this.logger);

    // Mini storage per metriche locali
    this.metrics = [];


    this.fmpFundamentals = new FmpFundamentalsService({
      logger: this.logger,
      getSetting,
    });

    this.screener = new ScreenerService({
      logger: this.logger,
      getSetting,
    });


    this.scoringService = new ScoringService({
      logger: this.logger,
    });

    this.momentumCalculator = new MomentumCalculator({
      logger: this.logger,                // o this.logger.forModule('momentum')
      cachemanagerUrl: this.cachemanagerUrl,
      tf: process.env.MOMENTUM_TF || "1Day",
      lookbackDays: Number(
        process.env.MOMENTUM_LOOKBACK_DAYS || 365
      ),
    });


  }

  // =========================================================
  // init(): logger + redis + settings dal DB
  // =========================================================
  async init() {
    this.logger.info("[init] Initializing...");

    // 1) CONNECT REDIS BUS
    await this.bus.connect();
    this.logger.attachBus(this.bus);

    // STATUS: STARTING
    await this.bus.publish(this.redisStatusChannel, {
      status: "STARTING",
      details: "Loading DB settings"
    });

    // 2) LOAD SETTINGS DAL DB
    const ok = await initializeSettings(this.dbmanagerUrl);
    if (!ok) {
      this._status = "ERROR";
      this.statusDetails = "DB unreachable";
      await this.bus.publish(this.redisStatusChannel, {
        status: this._status,
        details: this.statusDetails
      });

      this.logger.error("[init] Failed DB initialization");
      process.exit(1);
    }

    // 3) APPLY COMMON SETTINGS
    this.delayBetweenMessages = asInt(
      getSetting("PROCESS_DELAY_BETWEEN_MESSAGES"),
      500
    );

    this.logger.info(
      `[init] Settings loaded: delayBetweenMessages=${this.delayBetweenMessages}`
    );

    // 4) HOOK EVENTUALE
    await this.afterInit();

    // 5) READY
    this._status = "READY";
    this.statusDetails = "Initialization complete";

    await this.bus.publish(this.redisStatusChannel, {
      status: this._status,
      details: this.statusDetails
    });
  }

  // =========================================================
  // Hook custom per ogni microservizio (override)
  // =========================================================
  async afterInit() {
    this.logger.info("[afterInit] No custom logic implemented (template).");
  }

  /**
   * Avvia uno scan asincrono:
   * - chiama solo lo screener per sapere quanti ticker grezzi ci sono
   * - crea un job in stato queued
   * - lancia in background l’elaborazione completa (scanAndScoreUniverse)
   * - ritorna subito jobId + totalRawTickers
   */
  async startScanJob() {
    const screener = await this.runScreener();
    const data = screener?.data || [];
    const totalRaw = data.length;

    const job = createScanJob(totalRaw);
    this.logger.info(
      `[tickScanner] Scan job ${job.id} created with ${totalRaw} raw tickers`
    );

    // esecuzione in background (fire & forget)
    setImmediate(() => {
      this._runScanJob(job.id).catch((err) => {
        this.logger.error(
          `[tickScanner] Scan job ${job.id} failed: ${err.message}`
        );
        updateScanJob(job.id, { status: "error", error: err.message });
      });
    });

    return {
      jobId: job.id,
      totalRawTickers: totalRaw,
      status: job.status,
    };
  }

  async _runScanJob(jobId) {
    updateScanJob(jobId, { status: "running" });

    const result = await this.scanAndScoreUniverse(); // la funzione che abbiamo già

    updateScanJob(jobId, {
      status: "completed",
      totalProcessed: result.count,
      dbHits: result.dbHits,
      newCalculated: result.newCalculated,
    });

    this.logger.info(
      `[tickScanner] Scan job ${jobId} completed: total=${result.count}, dbHits=${result.dbHits}, new=${result.newCalculated}`
    );
  }

  getScanStatus(jobId) {
    const job = getScanJob(jobId);
    if (!job) {
      const err = new Error("Job not found");
      err.code = "NOT_FOUND";
      throw err;
    }
    return job;
  }

  getRunningScanJobs() {
    // queued + running
    return getActiveJobs();
  }

  /**
  * Esegue lo screener usando i parametri letti da DB (getSetting)
  * e restituisce il risultato dell'API FMP.
  * */
  async runScreener() {
    return this.screener.runScreener();
  }

  /**
   * /scan:
   * 1) screener FMP -> lista simboli
   * 2) GET DBManager /fundamentals -> cosa ho già
   * 3) per i ticker mancanti:
   *    - chiamo FMP
   *    - calcolo score
   *    - salvo su DB via /fundamentals/bulk (batch da 50)
   * 4) ritorno tutti i risultati (DB + nuovi)
   */
  async scanAndScoreUniverse() {
    // 1) screener
    const screener = await this.runScreener();
    const data = screener?.data || [];
    const symbols = data.map(d => d.symbol).filter(Boolean);

    if (!symbols.length) {
      this.logger.warning("[scanAndScoreUniverse] Nessun simbolo dallo screener");
      return {
        count: 0,
        dbHits: 0,
        newCalculated: 0,
        results: [],
      };
    }

    this.logger.info(
      `[scanAndScoreUniverse] Screener ha restituito ${symbols.length} simboli`
    );

    // 2) leggo dal DB tutto ciò che esiste in fundamentals
    let existingRows = [];
    try {
      const url = `${this.dbmanagerUrl}/fundamentals`;
      this.logger.info(`[scanAndScoreUniverse] GET ${url}`);
      const res = await fetch(url);
      if (res.ok) {
        existingRows = await res.json();
      } else {
        const text = await res.text().catch(() => "");
        this.logger.error(
          `[scanAndScoreUniverse] DBManager /fundamentals errore: ${res.status} - ${text}`
        );
      }
    } catch (e) {
      this.logger.error(
        `[scanAndScoreUniverse] Errore chiamando DBManager /fundamentals: ${e.message}`
      );
    }

    const existingMap = new Map();
    for (const row of existingRows) {
      if (row.symbol) existingMap.set(row.symbol, row);
    }

    const existingRecords = [];
    const missingSymbols = [];

    for (const sym of symbols) {
      const row = existingMap.get(sym);
      if (row) {
        existingRecords.push(mapDbRowToScoredRecord(row));
      } else {
        missingSymbols.push(sym);
      }
    }

    this.logger.info(
      `[scanAndScoreUniverse] Trovati ${existingRecords.length} simboli in DB, mancanti: ${missingSymbols.length}`
    );

    // 3) per i mancanti: FMP + scoring + salvataggio bulk
    const newScoredRecords = [];

    const batches = chunkArray(missingSymbols, 50);
    for (const batch of batches) {
      this.logger.info(
        `[scanAndScoreUniverse] Processing batch di ${batch.length} simboli mancanti`
      );

      // fundamentals da FMP
      const fundamentalsBatch =
        await this.fmpFundamentals.getFundamentalsForSymbols(batch);

      const scoredBatch = [];
      const fundamentalsRecords = [];   // 👈 record piatti per la tabella fundamentals

      for (const fmpData of fundamentalsBatch) {
        const symbol = fmpData.symbol;

        // momentum completo (score + components)
        const momentum = await this.momentumCalculator.calculateForSymbol(symbol);

        // lo scoring usa SOLO il valore numerico
        const scored = this.scoringService.scoreSymbol(fmpData, {
          momentumScore: momentum?.score ?? null,
        });

        this.logger.info(
          "[DEBUG scored]",
          {
            symbol,
            valuation: scored.scores?.valuation,
            quality: scored.scores?.quality,
            risk: scored.scores?.risk,
            momentum: scored.scores?.momentum,
            totalScore: scored.scores?.totalScore
          }
        );
        // usato per la risposta combinata (DB + nuovi)
        scoredBatch.push(scored);

        // usato per il salvataggio in tabella fundamentals
        fundamentalsRecords.push(
          buildFundamentalsRecord(scored, momentum)   // 👈 qui usi la funzione che hai in scanJob
        );
      }

      newScoredRecords.push(...scoredBatch);


      // salvataggio su DB via bulk
      try {
        const url = `${this.dbmanagerUrl}/fundamentals/bulk`;
        const payload = {
          ok: true,
          count: fundamentalsRecords.length,
          results: fundamentalsRecords,   
        };

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          this.logger.error(
            `[scanAndScoreUniverse] Errore POST /fundamentals/bulk: ${res.status} - ${text}`
          );
        } else {
          this.logger.info(
            `[scanAndScoreUniverse] Salvati ${scoredBatch.length} fundamentals su DB`
          );
        }
      } catch (e) {
        this.logger.error(
          `[scanAndScoreUniverse] Errore chiamando POST /fundamentals/bulk: ${e.message}`
        );
      }
    }

    // 4) combinazione risultati (DB + nuovi)
    const results = [...existingRecords, ...newScoredRecords];

    return {
      count: results.length,
      dbHits: existingRecords.length,
      newCalculated: newScoredRecords.length,
      results,
    };
  }

async refreshMomentumAll() {
  // 1) leggo i simboli dal DBManager
  const urlSymbols = `${this.dbmanagerUrl}/fundamentals`;
  this.logger.info(`[momentumRefresh] GET ${urlSymbols}`);

  const res = await fetch(urlSymbols);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Errore lettura symbols: ${res.status} - ${text}`
    );
  }

  const payload = await res.json();
  let symbols = payload || [];
  this.logger.info(
    `[momentumRefresh] Trovati ${symbols.length} simboli in fundamentals`
  );

  // payload è un array di righe [{ symbol, sector, ... }, ...]
  const rows = Array.isArray(payload) ? payload : [];
  symbols = [...new Set(rows.map(r => r.symbol).filter(Boolean))];

  const batchSize = 50;
  let totalUpdated = 0;

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    this.logger.info(
      `[momentumRefresh] Batch ${i / batchSize + 1} (${batch.length} simboli)`
    );

    const results = [];

    for (const sym of batch) {
      const momentum = await this.momentumCalculator.calculateForSymbol(sym);
      results.push({ symbol:sym, momentum });
    }

    // 3) aggiorno momentum su DB in bulk
    const urlBulk = `${this.dbmanagerUrl}/fundamentals/bulk`;
    const body = { ok: true, count: results.length, results };

    const r2 = await fetch(urlBulk, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!r2.ok) {
      const t = await r2.text().catch(() => "");
      this.logger.error(
        `[momentumRefresh] Errore POST momentum/bulk: ${r2.status} - ${t}`
      );
    } else {
      const rj = await r2.json().catch(() => ({}));
      this.logger.info(
        `[momentumRefresh] Aggiornato momentum per batch: ${rj.updated ?? "?"} simboli`
      );
      totalUpdated += rj.updated ?? 0;
    }
  }

  return { totalSymbols: symbols.length, totalUpdated };
}


  // =========================================================
  // METRICHE GENERICHE
  // =========================================================
  getMetricsSnapshot(max = 100) {
    return this.metrics.slice(-max);
  }

  pushMetric(metric) {
    metric.ts = Date.now();
    this.metrics.push(metric);
    if (this.metrics.length > 2000) this.metrics.shift();
  }

  // =========================================================
  // Aggiornamento dinamico dei channel config
  // =========================================================
  normalizeChannels(inCfg = {}, prev = {}) {
    const ms = (v, d = 500) => Number(v ?? d) || d;

    const norm = (k) => ({
      on: !!inCfg?.[k]?.on ?? prev?.[k]?.on ?? true,
      params: {
        intervalsMs: ms(
          inCfg?.[k]?.params?.intervalsMs ??
          prev?.[k]?.params?.intervalsMs ??
          500
        ),
      },
    });

    return {
      telemetry: norm("telemetry"),
      metrics:   norm("metrics"),
      data:      norm("data"),
      logs:      norm("logs"),
    };
  }

  async updateCommunicationChannel(newConf) {
    const cfg = this.normalizeChannels(newConf, this.communicationChannels);

    this.communicationChannels = cfg;

    // applica config al BUS
    await this.bus.applyChannels?.(cfg);

    this.bus.setChannelConfig("telemetry", cfg.telemetry);
    this.bus.setChannelConfig("metrics",   cfg.metrics);
    this.bus.setChannelConfig("data",      cfg.data);
    this.bus.setChannelConfig("logs",      cfg.logs);

    this.logger.info(
      `[channels] telemetry=${cfg.telemetry.on} metrics=${cfg.metrics.on} data=${cfg.data.on} logs=${cfg.logs.on}`
    );

    return { ok: true, channels: cfg };
  }

  // =========================================================
  // GET INFO STANDARDIZZATO
  // =========================================================
  getInfo() {
    return {
      MICROSERVICE,
      MODULE_NAME,
      MODULE_VERSION,
      STATUS: this._status,
      STATUS_DETAILS: this.statusDetails,
      ENV: this.env,
      communicationChannels: this.communicationChannels,
      BusChannels: {
        telemetry: this.redisTelemetyChannel,
        status:    this.redisStatusChannel,
        data:      this.redisDataChannel,
        logs:      this.redisLogsChannel,
      },
    };
  }

  // =========================================================
  // SHUTDOWN
  // =========================================================
  async disconnect() {
    this.logger.info("[disconnect] Shutting down...");

    try {
      await this.bus.close();
    } catch (e) {
      this.logger.error("[disconnect] Error closing RedisBus", e);
    }

    this._status = "STOPPED";
    return this._status;
  }

  // =========================================================
  // DB Logger API (usata da /dbLogger nel server.js)
  // =========================================================
  getDbLogStatus() {
    // Se il logger supporta questa API, la usiamo
    if (typeof this.logger.getDbLogStatus === "function") {
      return this.logger.getDbLogStatus();
    }
    // Fallback neutro
    return { dbLogEnabled: false };
  }

  setDbLogStatus(status) {
    if (typeof this.logger.setDbLogStatus === "function") {
      return this.logger.setDbLogStatus(status);
    }
    this.logger.warning("[setDbLogStatus] Not supported by this logger", { status });
    return { dbLogEnabled: false };
  }


  // Accesso diretto
  getBus()    { return this.bus; }
  getLogger() { return this.logger; }
  get status() { return this._status; }
}

module.exports = TickerScanner;
