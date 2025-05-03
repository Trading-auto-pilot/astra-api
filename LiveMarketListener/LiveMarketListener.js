// LiveMarketListener.js
const WebSocket = require('ws');
const axios = require('axios');
const { placeOrder } = require('./placeOrders');
const createLogger = require('../shared/logger');
const MODULE_NAME = 'LiveMarketListener';
const MODULE_VERSION = '1.0';

const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL || 'info');

class LiveMarketListener {
  constructor() {
    this.ws = null;
    this.active = true;
    this.symbolStrategyMap = {}; // { symbol: [strategyObj, ...] }
    this.settings = {};
    this.dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
    const env = process.env.ENVIRONMENT;
    this.isPaper = env === 'PAPER' ? true : env === 'LIVE' ? false : null;
    const market = process.env.MARKET;
    this.isSandbox = market === 'SANDBOX' ? true : market === 'LIVE' ? false : null;
    this.smaUrl = process.env.SMA_URL;
    this.capialManagerUrl = process.env.CAPITAL_MANAGER_URL || 'http://localhost:3009';
    this.alertingManagerUrl = process.env.ALERTINGMANAGER_URL || 'http://localhost:3008';
    
  }

  async init() {
    logger.info(`[init] Inizializzazione...`);

    if (this.isPaper === null) {
        logger.warning(`[config] ENVIRONMENT non valido o mancante: "${env}". Valori accettati: PAPER, LIVE`);
    }

    // Log delle variabili definite nell'istanza
    for (const key of Object.keys(this)) {
        // Esclude i metodi (funzioni)
        if (typeof this[key] !== 'function') {
        logger.trace(`[init] Variabile ${key} =`, this[key]);
        }
    }

    await this.loadSettings();
    await this.loadActiveStrategies();
    this.connect();
  }

  async loadSettings() {
    logger.info(`[loadSetting] Lettura setting da repository...`);
    const keys = [
      'APCA-API-KEY-ID',
      'APCA-API-SECRET-KEY',
      'ALPACA-WSS-MARKET-STREAM-BASE',
      'ALPACA-WSS-MARKET-SANDBOX-BASE',
      'ALPACA-WSS-SIP',
      'ALPACA-API-TIMEOUT',
      'ALPACA-API-PAPER-BASE',
      'ALPACA-API-LIVE-BASE'
    ];

    for (const key of keys) {
      const res = await axios.get(`${this.dbManagerUrl}/getSetting/${key}`);
      this.settings[key] = res.data.value;
      logger.trace(`[loadSetting] Setting variavile ${key} : ${this.settings[key]}`);
    }
    this.alpacaAPIServer = this.isPaper ? this.settings[`ALPACA-API-PAPER-BASE`] : [this.settings[`ALPACA-API-LIVE-BASE`]] || 'https://paper-api.alpaca.markets';
    logger.trace(`[loadSetting] variabile alpacaAPIServer ${this.alpacaAPIServer}`);
  }

  async loadActiveStrategies() {
    logger.info(`[loadActiveStrategies] Lettura strategie attive da repository...`);
    logger.log(`[loadActiveStrategies] mi connetto al server ${this.dbManagerUrl}/strategies`);
    const res = await axios.get(`${this.dbManagerUrl}/strategies`);
    const strategies = res.data;

    this.symbolStrategyMap = {};
    for (const strategy of strategies) {
        const symbol = strategy.symbol;
        logger.trace(`[loadActiveStrategies] Recuperato symbol : ${symbol}`)
        if (!this.symbolStrategyMap[symbol]) {
            this.symbolStrategyMap[symbol] = [];
        }
        this.symbolStrategyMap[symbol].push(strategy);
    }
  }

  connect() {
    logger.info(`[connect] Connessione in corso...`);
    const baseUrl = this.isSandbox ? this.settings['ALPACA-WSS-MARKET-SANDBOX-BASE'] : this.settings['ALPACA-WSS-MARKET-STREAM-BASE'];
    const wsUrl = `${baseUrl}${this.isPaper ? 'iex' : 'sip'}`;
    logger.log(`[connect] Mi connetto a url : ${wsUrl}`);

    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      logger.info(`[connect] WebSocket connesso. Autenticazione in corso...`);
      this.ws.send(JSON.stringify({
        action: 'auth',
        key: this.settings['APCA-API-KEY-ID'],
        secret: this.settings['APCA-API-SECRET-KEY']
      }));
    });

    this.ws.on('message', async (data) => {
        logger.trace(`[connect] messaggio ricevuto ${data}`);
        const messages = JSON.parse(data);
        for (const msg of messages) {
            if (msg.T === 'success' && msg.msg === 'authenticated') {
                const symbols = Object.keys(this.symbolStrategyMap);
                this.ws.send(JSON.stringify({
                    action: 'subscribe',
                    bars: symbols
                }));
                logger.info(`[connect] Sottoscritto ai simboli: ${symbols.join(', ')}`);
            }

            if (msg.T === 'b') {
                await this.processBar(msg);
            }
        }
    });

    this.ws.on('close', () => {
      logger.warning(`[connect] Connessione WebSocket chiusa.`);
    });

    this.ws.on('error', (err) => {
      logger.error(`[connect] Errore WebSocket: ${err.message}`);
    });
  }

  async processBar(bar) {
    logger.trace(`[processBar] Avviato con bar : ${JSON.stringify(bar)}`);
    const symbol = bar.S;
    const strategies = this.symbolStrategyMap[symbol] || [];

    for (const strategy of strategies) {
        logger.trace(`[processBar] Verifico strategia ${JSON.stringify(strategy)}`);
        const body = {
            candle: {
            t: bar.t,
            o: bar.o,
            h: bar.h,
            l: bar.l,
            c: bar.c,
            v: bar.v
            },
            strategyParams: strategy
        };

        try {
            const url = `${this.smaUrl}/processCandle`;
            body['scenarioId']=body.strategyParams.id;
            logger.trace(`[processBar] Invio candela per processamento a url ${url} con body ${JSON.stringify(body)}`);
            const response = await axios.post(url, body);
            const result = response.data;

            if (!this.active) {
                logger.warning(`[processBar] Sistema in pausa. Ignorato segnale per ${symbol}`);
            return;
            }

            if (result.action === 'BUY' || result.action === 'SELL') {
                logger.trace(`[processBar] Ricevuto segnale di ${result.action}`);
                await this.handleTradeSignal(result, strategy, bar);
            }
        } catch (err) {
            logger.error(`[processBar] Errore chiamata processCandle per ${symbol}:`, err.message);
        }
    }
  }

  async handleTradeSignal(signal, strategy, bar) {
    logger.trace(`[handleTradeSignal] Ricevuto segnale ${signal} su strategia ${strategy} cob bar ${bar}`);
    try {
        logger.trace(`[handleTradeSignal] Richiedo capitale disponibile a url this.capialManagerUrl}/evaluateAllocation/${strategy.id}`);
        const evalRes = await axios.get(`${this.capialManagerUrl}/evaluateAllocation/${strategy.id}`);
        const evalResult = evalRes.data;
        logger.trace(`[handleTradeSignal] Risposta ${JSON.stringify(evalResult)}`);

        if (!evalResult.approved) {
            logger.log(`[${MODULE_NAME}] Allocazione rifiutata per ${strategy.symbol} (${strategy.id})`);
            return;
        }

        logger.trace(`[handleTradeSignal] Apro ordine`);
        const orderRes = await placeOrder(    alpacaAPIServer,
                                                this.settings['APCA-API-KEY-ID'],
                                                this.settings['APCA-API-SECRET-KEY'],
                                                strategy.symbol, 
                                                Math.floor(evalResult.grantedAmount / bar.c), 
                                                signal.action.toLowerCase(), 
                                                type = 'limit', 
                                                time_in_force = 'gtc', 
                                                limit_price = null, 
                                                stop_price = null);
        logger.trace(`[handleTradeSignal] Ricevuta risposta ${JSON.stringify(orderRes.data)} inserisco nel DB richiamando ${dbManagerUrl}/insertOrder`);
        await axios.post(`${dbManagerUrl}/insertOrder`, orderRes.data);

        logger.trace(`[handleTradeSignal] Invio email richiamando ${alertingManagerUrl}/sendEmail`);
        await axios.post(`${alertingManagerUrl}/sendEmail`, {
            to: strategy.ownerEmail || 'expovin@gmail.com',
            subject: `Ordine ${signal.action} ${strategy.symbol}`,
            text: `Eseguito ${signal.action} su ${strategy.symbol} a ${bar.c} con qty ${order.qty}`
        });
    } catch (err) {
      console.error(`[${MODULE_NAME}] Errore gestione trade ${signal.action}:`, err.message);
    }
  }

  pause() {
    this.active = false;
    logger.warning(`[${MODULE_NAME}] Ricevuto comando PAUSE`);
  }

  resume() {
    this.active = true;
    logger.warning(`[${MODULE_NAME}] Ricevuto comando RESUME`);
  }

  getInfo() {
    return {
      module: MODULE_NAME,
      version: MODULE_VERSION,
      paused: !this.active,
      subscribedSymbols: Object.keys(this.symbolStrategyMap)
    };
  }
}

module.exports = LiveMarketListener;
