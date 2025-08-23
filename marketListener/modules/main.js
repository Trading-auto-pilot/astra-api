// modules/main.js
const createLogger = require('../../shared/logger');
const { initializeSettings, getSetting } = require('../../shared/loadSettings');
const { RedisBus } = require("../../shared/redisBus");
const { asBool, asInt } = require('../../shared/helpers');

const AlpacaWS = require('./alpacaSocket');
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

    // Alpaca WS endpoint + feed
    this.alpacaMarketServer = process.env.ALPACA_MARKET_URL || 'ws://localhost:3003/v2'; // es. 'wss://stream.data.alpaca.markets/v2'
    this.feed               = process.env.FEED || 'iex';

    // Parametri retry WS Alpaca
    this.alpacaRetryDelay = asInt(process.env.ALPACA_WSS_RETRAY_DELAY, 5000);
    this.alpacaMaxRetray  = asInt(process.env.ALPACA_WSS_MAX_RETRY, 10);

    // Flags / intervalli BUS (usa asBool/asInt)
    this.msgTelemetryOn        = asBool(process.env.MSG_TELEMETRY, true);
    this.msgTelemetryIntervals = asInt(process.env.MSG_TELEMETRY_INTERVALS, 500);

    this.msgTickOn             = asBool(process.env.MSG_TICK, true);
    this.msgTickIntervals      = asInt(process.env.MSG_TICK_INTERVALS, 500);

    this.msgCandleOn           = asBool(process.env.MSG_CANDLE, true);
    this.msgCandleIntervals    = asInt(process.env.MSG_CANDLE_INTERVALS, 500);

    this.msgLogsOn             = asBool(process.env.MSG_LOGS, true);
    this.msgLogsIntervals      = asInt(process.env.MSG_LOGS_INTERVALS, 500);

    // Canali Redis (prefix di servizio)
    this.redisTelemetyChannel = `${this.env}.${MICROSERVICE}.telemetry`;
    this.redisTickChannel     = `${this.env}.${MICROSERVICE}.tick`;
    this.redisCandleChannel   = `${this.env}.${MICROSERVICE}.candle`;
    this.redisLogsChannel     = `${this.env}.${MICROSERVICE}.logs`;

    // Stato modulo
    this.symbolStrategyMap = [];
    this.moduleActive = true;

    this.status = 'STARTING';
    this.statusDetails = null;

    // Abilitazione canali BUS
    this.communicationChannels = {
      telemetry : { on: this.msgTelemetryOn, params : { intervalsMs : this.msgTelemetryIntervals }},
      tick      : { on: this.msgTickOn,      params : { intervalsMs : this.msgTickIntervals }},
      candle    : { on: this.msgCandleOn,    params : { intervalsMs : this.msgCandleIntervals }},
      logs      : { on: this.msgLogsOn,      params : { intervalsMs : this.msgLogsIntervals }}
    };

    // Inizializzazione BUS Redis
    this.bus = new RedisBus({
      channels: this.communicationChannels,
      name: "marketListener"
    });

    // Logger (passa il bus con la chiave corretta!)
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.logger = createLogger(
      MICROSERVICE,
      MODULE_NAME,
      MODULE_VERSION,
      this.logLevel,
      {
        bus: this.bus,                          // <--- FIX: non _bus
        busTopicPrefix: this.env || 'DEV',
        console: true,
        enqueueDb: true,
      }
    );

    // Collega il logger al bus (per log interni del bus)
    this.bus.setLogger(this.logger);
  }

  async init() {
    this.logger.info('[init] Inizializzazione componenti...');

    // 1) Connetti il BUS e SOLO dopo pubblica
    await this.bus.connect();                                 // <--- FIX: await
    await this.bus.publish('health.ping', { ok: true });

    this.statusDetails = 'Inizializzazione DB';
    await this.bus.publish(`${this.redisTelemetyChannel}.STATUS`, { status: this.status, details: this.statusDetails });

    // 2) Leggi settings dal DB (scatola nera)
    const initDB = await initializeSettings(this.dbManagerUrl);
    if (!initDB) {
      this.status = 'ERROR';
      this.statusDetails = 'Errore connessione al DB';
      await this.bus.publish(`${this.redisTelemetyChannel}.STATUS`, { status: this.status, details: this.statusDetails });
      this.logger.error('[init] Errore Inizializzazione. Connessione al DB fallita dopo retry');
      process.exit(1);
    }

    // 3) Configura Alpaca
    this.logger.info(`[init] communicationChannels | ${JSON.stringify(this.communicationChannels)}`);
    this.status = 'CONNECTING';
    this.statusDetails = 'Settings letti da DB. Inizio connessione ad Alpaca.';
    await this.bus.publish(`${this.redisTelemetyChannel}.STATUS`, { status: this.status, details: this.statusDetails });

    const delayBetweenMessages = asInt(getSetting('PROCESS_DELAY_BETWEEN_MESSAGES'), 500); // <--- FIX: string, non array

    const alpacaConfig = {
      alpacaMarketServer    : `${this.alpacaMarketServer}/${this.feed}`,
      alpacaRetryDelay      : this.alpacaRetryDelay,
      alpacaMaxRetray       : this.alpacaMaxRetray,
      symbolStrategyMap     : this.symbolStrategyMap,
      processBar            : async (bar) => { /* TODO: tua logica */ },  // <--- FIX: funzione, non []
      logger                : this.logger,
      delayBetweenMessages
    };

    // 4) Istanzia Alpaca socket
    // ATTENZIONE: assicurati che alpacaSocket exporti la classe correttamente (default o named)
    this.alpacaWS = new AlpacaWS(alpacaConfig);

    // Se AlpacaWS estende EventEmitter:
    if (this.alpacaWS.on) {
      this.alpacaWS.on('status', async (status) => {
        this.logger.info(`[init] Connection status to Alpaca web socket ${status}`);
        this.status = status;
        await this.bus.publish(`${this.redisTelemetyChannel}.STATUS`, { status: this.status, details: this.statusDetails });
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
  }
}

module.exports = marketListener;
