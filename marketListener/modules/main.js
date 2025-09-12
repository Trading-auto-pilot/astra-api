// modules/main.js
const axios = require('axios');
const createLogger = require('../../shared/logger');
const { initializeSettings, getSetting } = require('../../shared/loadSettings');
const { RedisBus } = require("../../shared/redisBus");
const { asBool, asInt } = require('../../shared/helpers');

const AlpacaWS = require('./alpacaSocket');
const StateManager = require('./stateManager');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const MICROSERVICE = 'marketListener';
const MODULE_NAME = 'main';
const MODULE_VERSION = '3.0';

class marketListener {
  constructor() {
    // Url di connessione ad altri micro-servizi 
    this.dbManagerUrl       = process.env.DBMANAGER_URL      || 'http://localhost:3002';
    this.alertingManagerUrl = process.env.ALERTINGMANAGER_URL || 'http://localhost:3008';

    // Ambiente
    this.env = process.env.ENV || 'DEV';

    // Canali Redis (prefix di servizio)
    this.redisTelemetyChannel = `${this.env}.${MICROSERVICE}.telemetry`;
    this.redisStatusChannel     = `${this.env}.${MICROSERVICE}.status`;
    this.redisCandleChannel   = `${this.env}.${MICROSERVICE}.candle`;
    this.redisLogsChannel     = `${this.env}.${MICROSERVICE}.logs`;

    this._status = 'STARTING';
    this.statusDetails = null;

    this.state = new StateManager(this.env);

    // Inizializzazione BUS Redis
    this.bus = new RedisBus({
      channels: this.state._communicationChannels,
      name: "marketListener"
    });

    // Logger (passa il bus con la chiave corretta!)
    this.logger = createLogger(
      MICROSERVICE,
      MODULE_NAME,
      MODULE_VERSION,
      this.state._logLevel,
      {
        bus: null,                          // <--- FIX: non _bus
        busTopicPrefix: this.env || 'DEV',
        console: true,
        enqueueDb: true,
      }
    );
    this.bus.setLogger(this.logger);            // ok: i log interni del bus useranno skipBus:true
    this.state.logger = this.logger;

  }

  async init() {
    this.logger.info('[init] Inizializzazione componenti...');

    // 1) Connetti il BUS e SOLO dopo pubblica
    await this.bus.connect();     
    this.logger.attachBus(this.bus);                      // <--- ora il logger può pubblicare su Redis
    this.logger.info("[debug] bus.status()", JSON.stringify(this.bus.status()));

    this.statusDetails = 'Inizializzazione DB';
    await this.bus.publish(`${this.redisStatusChannel}`, { status: this._status, details: this.statusDetails });

    // 2) Leggi settings dal DB (scatola nera)
    const initDB = await initializeSettings(this.dbManagerUrl);
    if (!initDB) {
      this._status = 'ERROR';
      this.statusDetails = 'Errore connessione al DB';
      await this.bus.publish(`${this.redisStatusChannel}`, { status: this._status, details: this.statusDetails });
      this.logger.error('[init] Errore Inizializzazione. Connessione al DB fallita dopo retry');
      process.exit(1);
    }

    // 3) Configura Alpaca
    this.logger.info(`[init] communicationChannels | ${JSON.stringify(this.state._communicationChannels)}`);
    this._status = 'CONNECTING';
    this.statusDetails = 'Settings letti da DB. Inizio connessione ad Alpaca.';
    await this.bus.publish(`${this.redisStatusChannel}`, { status: this._status, details: this.statusDetails });

    const delayBetweenMessages = asInt(getSetting('PROCESS_DELAY_BETWEEN_MESSAGES'), 500); // <--- FIX: string, non array

    this.state._symbolStrategyMap = await this.loadActiveStrategies();
    const alpacaConfig = {
      alpacaMarketServer    : `${this.state._alpacaMarketServer}/${this.state._feed}`,
      alpacaRetryDelay      : this.state._alpacaRetryDelay,
      alpacaMaxRetry       : this.state.alpacaMaxRetry,
      symbolStrategyMap     : this.state._symbolStrategyMap,
      processBar            : async (bar) => { /* TODO: tua logica */ },  // <--- FIX: funzione, non []
      logger                : this.logger,
      state                 :this.state,
      redisTelemetyChannel  :this.redisTelemetyChannel,
      delayBetweenMessages
    };
    // 4) Istanzia Alpaca socket
    // ATTENZIONE: assicurati che alpacaSocket exporti la classe correttamente (default o named)
    this.alpacaWS = new AlpacaWS(alpacaConfig);

    // Se AlpacaWS estende EventEmitter:
    if (this.alpacaWS.on) {
      this.alpacaWS.on('status', async (FullStatus) => {
        this.logger.info(`[init] Connection status to Alpaca web socket | ${JSON.stringify(FullStatus)}`);
        this._status = FullStatus.status;
        await this.bus.publish(`${this.redisStatusChannel}`, FullStatus);
      });

      this.alpacaWS.on('candle', async (candle) => {
        await this.bus.publish(`${this.redisCandleChannel}`, candle);
      });

      this.alpacaWS.on('metrics', async (metrics) => {
        await this.bus.publish(`${this.redisTelemetyChannel}`, metrics);
      });
    }

    // Avvia il loop di connessione (se hai implementato start())
    if (this.alpacaWS.start) {
      this.alpacaWS.start();
    } else if (this.alpacaWS.connect) {
      // fallback: singolo tentativo
      try { await this.alpacaWS.connect(); } catch (e) {
        this.logger.error(`[init] Alpaca connect failed: ${e?.message||e}`);
      }
    }

    // Avvia ascolto sulla coda Redis
    await this.alpacaWS.initOrderActiveWatcher();

    // Da implementare nel micro-servizio tradeExecutor per inserire in coda ordini ativi
    // attiva
    // await redis.sAdd('prod.orders.active.set', 'AAPL');
    // disattiva
    // await redis.sRem('prod.orders.active.set', 'AAPL');
    // Pubblica Evento
    // await redis.publish('prod.orders.active.events.v1', JSON.stringify({ action: 'add', symbol: 'AAPL' }));
    // await redis.publish('prod.orders.active.events.v1', JSON.stringify({ action: 'remove', symbol: 'AAPL' }));
  }

  getMetricsSnapshot(n){ return this.alpacaWS._getMetricsSnapshot(n); }

  async loadActiveStrategies() {
    try {
      const res = await axios.get(`${this.dbManagerUrl}/strategies`);
      this.strategies = res.data || [];
      this.logger.info(`[loadActiveStrategies] Caricati ${this.strategies.length} strategie attive`);

      const symbolStrategyMap = {};
      for (const strategy of this.strategies) {
        const symbol = strategy.idSymbol;
        this.logger.trace(`[loadActiveStrategies] Recuperato symbol : ${symbol}`)
        if (!symbolStrategyMap[symbol]) {
            symbolStrategyMap[symbol] = [];
        }
        symbolStrategyMap[symbol].push(strategy);
      }
      return(symbolStrategyMap);
      } catch (err) {
          this.logger.error('[loadActiveStrategies] Errore nel caricamento strategie attive:', err.message);
      }
  }

  get status() {return this._status;}
  set status(s) {this._status = s;}

  getInfo() {
    return(
      {
        MICROSERVICE : MICROSERVICE,
        MODULE_VERSION: MODULE_VERSION,
        status : this._status,
        STATUS_DETAILS: this.statusDetails,
        ENV: this.env,
        BusChannels : {
          redisTelemetyChannel : this.redisTelemetyChannel,
          redisStatusChannel : this.redisStatusChannel,
          redisCandleChannel : this.redisCandleChannel,
          redisLogsChannel : this.redisLogsChannel
        }
      }
    )
  }

  async disconnect() {
    await this.alpacaWS.disconnect();
    return (this._status);
  }

  async connect() {
    await this.alpacaWS.start();
    return (this._status);
  }

// main.js (MarketListener)
async updateCommunicationChannel(newConf) {
  const cfg = this.normalizeChannels(newConf, this.state.communicationChannels);

  // 1) aggiorna lo stato applicativo (single source of truth)
  this.state.communicationChannels = cfg;

  // 2) applica subito al BUS (ferma timer/flush dei canali OFF)
  await this.bus.applyChannels?.(cfg);

  // 3.a) aggiorna anche l’Alpaca WS (telemetry, ecc.)
  await this.alpacaWS.updateCommunicationChannels?.(cfg);

  // 3.b) BUS: applica per-canale (usa proprio setChannelConfig)
  this.bus.setChannelConfig('telemetry', cfg.telemetry);
  this.bus.setChannelConfig('metrics',   cfg.metrics);
  this.bus.setChannelConfig('candle',    cfg.candle);
  this.bus.setChannelConfig('logs',      cfg.logs);

  // 4) (opzionale) notifica gli altri componenti (es. redisWsBridge)
  this.redis?.publish?.('channelsCfg.updated', JSON.stringify({ v: Date.now(), by: 'marketListener' }));

  this.logger.info(`[channels] telemetry=${cfg.telemetry.on} metrics=${cfg.metrics.on} candle=${cfg.candle.on} logs=${cfg.logs.on}`);
  return { ok: true, channels: cfg };
}

// helper semplice
normalizeChannels(inCfg = {}, prev = {}) {
  const ms = (v, d=500) => (Number(v ?? d) || d);
  const norm = (k) => ({
    on: !!inCfg?.[k]?.on,
    params: { intervalsMs: ms(inCfg?.[k]?.params?.intervalsMs ?? prev?.[k]?.params?.intervalsMs) }
  });
  return {
    telemetry: norm('telemetry'),
    metrics:   norm('metrics'),
    candle:    norm('candle'),
    logs:      norm('logs'),
  };
}

getDbLogStatus() { return this.logger.getDbLogStatus()}
setDbLogStatus(status) { return (this._statuslogger.setDbLogStatus(status))}

}

module.exports = marketListener;
