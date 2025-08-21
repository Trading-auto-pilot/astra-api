// modules/main.js
const createLogger = require('../../shared/logger');
const { initializeSettings, getSetting } = require('../../shared/loadSettings');
const AlpacaWS = require('./alpacaSocket');
const RedisSubscriber = require('./redisPubSubManager');
const CandleProcessor = require('./processCandles');
const tradeExecutor = require('./tradeExecutor');
const Alpaca = require('../../shared/Alpaca');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const MICROSERVICE = 'LiveMarketListener';
const MODULE_NAME = 'main';
const MODULE_VERSION = '2.0';
const REDIS_POSITIONS_KEY = 'alpaca:positions'; 
const REDIS_ORDERS_KEY = 'alpaca:orders';




class LiveMarketListener {
  constructor(config) {
    // Url servizi 
    this.dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
    this.capialManagerUrl = process.env.CAPITAL_MANAGER_URL || 'http://localhost:3009';
    this.alertingManagerUrl = process.env.ALERTINGMANAGER_URL || 'http://localhost:3008';
    this.alpacaAPIServer = null;
    this.redisSubscriber = new RedisSubscriber();
    this.AlpacaApi = new Alpaca();

    this.config = config;
    this.symbolStrategyMap=[];
    this.candleProcessor = null;
    this.active = true;
    this.logLevel = process.env.LOG_LEVEL || 'info' ;
    this.logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, this.logLevel);
  }

  getConnectionStatus() {
    const redisConnStatus = this.redisSubscriber.getConnectionStatus();
    const alpacaConnStatus = this.alpacaWS.getConnectionStatus();
    return ({Alpaca : alpacaConnStatus, Redis :redisConnStatus});
  }

  getLogLevel(module){
    if(!module) return this.logLevel;

    if(module === "processCandles") return this.candleProcessor.getLogLevel();
    if(module === "redisPubSubManager") return this.redisSubscriber.getLogLevel();
    if(module === "alpacaSocket") return this.alpacaWS.getLogLevel();
    if(module === "tradeExecutor") return tradeExecutor.getLogLevel();
  }

  setLogLevel(level, module='liveMarketListner') {
    if(!module || module === 'liveMarketListner') {
      this.logLevel=level;
      this.logger.setLevel(level);
      return;
    }

    if(module === "processCandles") this.candleProcessor.setLogLevel(level);
    if(module === "redisPubSubManager") this.redisSubscriber.setLogLevel(level);
    if(module === "alpacaSocket") this.alpacaWS.setLogLevel(level);
    if(module === "tradeExecutor") tradeExecutor.setLogLevel(level);
    return;
  }

  getModuleParams(){
    return({
      alpacaSocket : this.alpacaWS.getParams(),
      redisSocket : this.redisSubscriber.getParams()
    })
  }

  pause() {
    this.active = false;
    this.logger.warning(`[pause] Ricevuto comando PAUSE`);
  }

  resume() {
    this.active = true;
    this.logger.warning(`[resume] Ricevuto comando RESUME`);
  } 

  getInfo() {
    return {
      microservice : MICROSERVICE,
      module: MODULE_NAME,
      version: MODULE_VERSION,
      paused: !this.active,
      subscribedSymbols: Object.keys(this.symbolStrategyMap),
      activeOrders : this.orderActive,
      processCandle : this.candleProcessor.getOperationalEnvironment()
    };
  }  
   
  updateOrderActive(symbolsToRemove) {
    if (!Array.isArray(this.orderActive)) {
      this.orderActive = [];
    }
 
    this.orderActive = this.orderActive.filter(
      symbol => !symbolsToRemove.includes(symbol)
    ); 

    this.logger.trace(`[updateOrderActive] Rimosso: ${symbolsToRemove.join(', ')}`);
  }
 
  async connect() {
    this.alpacaWS.connect();
  }

  async disconnect(){
    this.alpacaWS.disconnect();
  }
  
  async init() {
    this.logger.info('[init] Inizializzazione componenti...');
    // Inizzializzo la connessione con getSetting
    await initializeSettings(this.dbManagerUrl);
    this.alpacaAPIServer = getSetting([`ALPACA-${process.env.ENV_ORDERS}-BASE`]);

    this.logger.info(`[init] dbManagerUrl : ${this.dbManagerUrl} alpacaAPIServer:${this.alpacaAPIServer} capialManagerUrl:${this.capialManagerUrl}`)

    await this.AlpacaApi.init();

    // Inizzializzaxione tradeExecutor
    tradeExecutor.init({ 
        dbManagerUrl:this.dbManagerUrl, 
        alpacaAPIServer : this.alpacaAPIServer,
        capitalManagerUrl : this.capialManagerUrl,
        AlpacaApi : this.AlpacaApi
      });

    this.candleProcessor = new CandleProcessor(this.alpacaAPIServer, this.dbManagerUrl, tradeExecutor, this.AlpacaApi, this.active);

    // Carica stato iniziale
    await this.candleProcessor.loadPositions();
    await this.candleProcessor.loadOrderActive();
    await this.candleProcessor.loadActiveBots();
    this.symbolStrategyMap = await this.candleProcessor.loadActiveStrategies();
 
    // Inizzializzo il websocket Alpaca
    this.alpacaWS = new AlpacaWS( getSetting, 
                                  this.symbolStrategyMap, 
                                  this.candleProcessor.processBar.bind(this.candleProcessor) );


    // Avvia il subscriber Redis per aggiornare Posizioni attive
    this.redisSubscriber.on(REDIS_POSITIONS_KEY, async (data) => {
      await this.candleProcessor.loadPositions();
      this.logger.info('[Redis] Aggiornamento posizioni richiesto. caricate '+this.candleProcessor.getActivePositions().length+' posizioni. Ricevuto messaggio '+JSON.stringify(data));
    });
    // Avvia il subscriber Redis per aggiornare Ordini attivi
    this.redisSubscriber.on(REDIS_ORDERS_KEY, async (data) => {
      await this.candleProcessor.loadOrderActive();
      this.logger.info('[Redis] Aggiornamento ordini  richiesto. caticati '+this.candleProcessor.getActiveOrders().length+' ordini. Ricevuto messaggio '+JSON.stringify(data));
    });
    // Avvia il subscriber Redis per aggiornare Strategie attive
    this.redisSubscriber.on('strategies:update', async (data) => {
      await this.candleProcessor.loadActiveStrategies();
      this.logger.info('[Redis] Aggiornamento strategie  richiesto '+this.candleProcessor.getActiveStrategies().length+' strategies, ricevuto messaggio '+JSON.stringify(data));
    });
    // Avvia il subscriber Redis per aggiornare Bots attivi
    this.redisSubscriber.on('bots:update', async () => {
      await this.candleProcessor.loadActiveBots();
      this.logger.info('[Redis] Aggiornamento bots  richiesto '+this.candleProcessor.getActiveBots().length+' bots');
    });

    await this.redisSubscriber.init();

    await this.redisSubscriber.subscribe(REDIS_POSITIONS_KEY, data => {
      this.redisSubscriber.emit(REDIS_POSITIONS_KEY, data);
    });
    await this.redisSubscriber.subscribe(REDIS_ORDERS_KEY, data => {
      this.redisSubscriber.emit(REDIS_ORDERS_KEY, data);
    });
    await this.redisSubscriber.subscribe('strategies:update', data => {
      this.redisSubscriber.emit('strategies:update', data);
    });
    await this.redisSubscriber.subscribe('bots:update', data => {
      this.redisSubscriber.emit('bots:update', data);
    });


    // Connetti al WebSocket di Alpaca
    this.alpacaWS.connect();

  }
}

module.exports = LiveMarketListener;
