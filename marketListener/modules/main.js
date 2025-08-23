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
    this.redisTickChannel     = `${this.env}.${MICROSERVICE}.tick`;
    this.redisCandleChannel   = `${this.env}.${MICROSERVICE}.candle`;
    this.redisLogsChannel     = `${this.env}.${MICROSERVICE}.logs`;

    this.status = 'STARTING';
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

    // Collega il logger al bus (per log interni del bus)
    //this.bus.setLogger(this.logger);
  }

  async init() {
    this.logger.info('[init] Inizializzazione componenti...');

    // 1) Connetti il BUS e SOLO dopo pubblica
    await this.bus.connect();     
    this.logger.attachBus(this.bus);                      // <--- ora il logger può pubblicare su Redis

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
    this.logger.info(`[init] communicationChannels | ${JSON.stringify(this.state._communicationChannels)}`);
    this.status = 'CONNECTING';
    this.statusDetails = 'Settings letti da DB. Inizio connessione ad Alpaca.';
    await this.bus.publish(`${this.redisTelemetyChannel}.STATUS`, { status: this.status, details: this.statusDetails });

    const delayBetweenMessages = asInt(getSetting('PROCESS_DELAY_BETWEEN_MESSAGES'), 500); // <--- FIX: string, non array

    this.state._symbolStrategyMap = await this.loadActiveStrategies();
    const alpacaConfig = {
      alpacaMarketServer    : `${this.state._alpacaMarketServer}/${this.state._feed}`,
      alpacaRetryDelay      : this.state._alpacaRetryDelay,
      alpacaMaxRetray       : this.state._alpacaMaxRetray,
      symbolStrategyMap     : this.state._symbolStrategyMap,
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
        this.logger.info(`[init] Connection status to Alpaca web socket ${JSON.stringify(status)}`);
        this.status = status;
        await this.bus.publish(`${this.redisTelemetyChannel}.STATUS`, this.status);
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

}

module.exports = marketListener;
