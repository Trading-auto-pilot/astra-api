// LiveMarketListener.js
const WebSocket = require('ws');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
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
    this.smaUrl = process.env.SMA_URL;
    this.capialManagerUrl = process.env.CAPITAL_MANAGER_URL || 'http://localhost:3009';
    this.alertingManagerUrl = process.env.ALERTINGMANAGER_URL || 'http://localhost:3008';
    
  }

  async init() {
    logger.info(`[init] Inizializzazione...`);

    // Log delle variabili definite nell'istanza
    for (const key of Object.keys(this)) {
        // Esclude i metodi (funzioni)
        if (typeof this[key] !== 'function') {
        logger.trace(`[init] Variabile ${key} =`, this[key]);
        }
    }

    for (const [key, value] of Object.entries(process.env)) {
      logger.trace(`Environment variable ${key}=${value}`);
    }
    

    await this.loadSettings();
    
    this.connect();
  }

  async loadSettings() {
    logger.info(`[loadSetting] Lettura setting da repository...`);
    const keys = [
      'APCA-API-KEY-ID',
      'APCA-API-SECRET-KEY',
      'ALPACA-LIVE-MARKET',
      'ALPACA-SANDBOX-MARKET',
      'ALPACA-LOCAL-MARKET',
      'ALPACA-WSS-SIP',
      'ALPACA-API-TIMEOUT',
      'ALPACA-PAPER-BASE',
      'ALPACA-LOCAL-BASE',
      'ALPACA-LIVE-BASE'


    ];

    for (const key of keys) {
      const res = await axios.get(`${this.dbManagerUrl}/getSetting/${key}`);
      this.settings[key] = res.data.value;
      logger.trace(`[loadSetting] Setting variavile ${key} : ${this.settings[key]}`);
    }
    this.alpacaAPIServer = this.settings[`ALPACA-`+process.env.ENV_ORDERS+`-BASE`]+'/v2/orders';
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
    const baseUrl = this.settings['ALPACA-'+process.env.ENV_MARKET+'-MARKET'];
    const wsUrl = `${baseUrl}/${process.env.FEED}`;
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
      //  for (const msg of messages) {
            if (messages.T === 'success' && messages.msg === 'authenticated') {
                const symbols = Object.keys(this.symbolStrategyMap);
                this.ws.send(JSON.stringify({
                    action: 'subscribe',
                    bars: symbols
                }));
                logger.info(`[connect] Sottoscritto ai simboli: ${symbols.join(', ')}`);
            }

            if (messages.T === 'b') {
                await this.processBar(messages);
            }
       // }
    });

    this.ws.on('close', () => {
      logger.warning(`[connect] Connessione WebSocket chiusa.`);
    });

    this.ws.on('error', (err) => {
      logger.error(`[connect] Errore WebSocket: ${err.message}`);
    });
  }

  async processBar(bar) {

    logger.log(`[processBar] Recupero strategie attive...`);
    await this.loadActiveStrategies();
    logger.log(`[processBar] Avviato con bar : ${JSON.stringify(bar)}`);
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
    logger.trace(`[handleTradeSignal] Ricevuto segnale ${signal.action} su strategia ${JSON.stringify(strategy)} con bar ${JSON.stringify(bar)}`);
    let evalResult, orderRes;
    try {
        logger.trace(`[handleTradeSignal] Richiedo capitale disponibile a url ${this.capialManagerUrl}/evaluate/${strategy.id}`);
        const evalRes = await axios.get(`${this.capialManagerUrl}/evaluate/${strategy.id}`);
        evalResult = evalRes.data;
        logger.trace(`[handleTradeSignal] Risposta ${JSON.stringify(evalResult)}`);
    }
    catch (error) {
      logger.error(`[handleTradeSignal] Errore durante richiesta capitale disponibile ${strategy.id}: ${err.message}`);
      throw new error(`[handleTradeSignal] Errore durante richiesta capitale disponibile ${strategy.id}: ${err.message}`);
    }

    if (!evalResult.approved) {
      logger.info(`[handleTradeSignal] Allocazione rifiutata per ${strategy.symbol} (${strategy.id})`);
      return;
    }

    if(evalResult.grantedAmount < bar.c){
      logger.info(`[handleTradeSignal] Non ci sono fondi sufficienti per ${strategy.symbol} (${strategy.id}). Capitale rimasto ${evalResult.grantedAmount} costo azione ${bar.c}`);
      return;
    }

    try {
        logger.trace(`[handleTradeSignal] Apro ordine`);
        orderRes = await placeOrder(            this.alpacaAPIServer,
                                                this.settings['APCA-API-KEY-ID'],
                                                this.settings['APCA-API-SECRET-KEY'],
                                                strategy.symbol, 
                                                Math.floor(evalResult.grantedAmount / bar.c), 
                                                signal.action.toLowerCase(), 
                                                strategy.params.buy.type,         
                                                strategy.params.buy.time_in_force,            
                                                strategy.params.buy.limit_price,             
                                                strategy.params.buy.stop_price,
                                                strategy.params.buy.trail_price,
                                                strategy.params.buy.extended_hours,
                                                /// order id
                                                strategy.id+'-'+uuidv4()
                                              );            
        }
        catch (error) {
          logger.error(`[handleTradeSignal] Errore durante richiesta apertura ordine ad Alpaca ${error.message} ${this.alpacaAPIServer}`);
          throw new error(`[handleTradeSignal] Errore durante Inserimento ordine ${error.message} ${this.alpacaAPIServer}`);
        }

      try {
          // Inserisco l'ordine nella tabella ordini fatti 
          logger.trace(`[handleTradeSignal] Ricevuta risposta ${JSON.stringify(orderRes.data)} inserisco nel DB richiamando ${this.dbManagerUrl}/insertOrder`);
          await axios.post(`${this.dbManagerUrl}/insertOrder`, orderRes.data);
        }
        catch (error) {
          logger.error(`[handleTradeSignal] Errore durante Inserimento ordine  ${error.message} ${JSON.stringify(orderRes.data)}`);
          throw new error(`[handleTradeSignal] Errore durante Inserimento ordine  ${error.message} ${JSON.stringify(orderRes.data)}`);
        }

      try {
        //Aggiorno con il capitale impegnato per questo ordine
        logger.trace(`[handleTradeSignal] Aggiorno la tabella Strategies con i capitali utilizzati ${this.dbManagerUrl}/updateStrategyCapitalAndOrders`);
        await axios.post(`${this.dbManagerUrl}/updateStrategyCapitalAndOrders`, {id :strategy.id, openOrders: Math.floor(evalResult.grantedAmount / bar.c) * bar.c});
      }
      catch (error) {
          logger.error(`[handleTradeSignal] Errore durante update capitale nella tabella strategies ${error.message}`);
          throw new error(`[handleTradeSignal] Errore durante update capitale nella tabella strategies ${error.message}`);
      }

      try{
        //Aggiungo la transazione nella tabella transazioni
        logger.trace(`[handleTradeSignal] Aggiungo record a tabella transazioni ${this.dbManagerUrl}/insertBuyTransaction ${strategy.id} ${JSON.stringify(bar)} ${Math.floor(evalResult.grantedAmount / bar.c) * bar.c} ${bar.c} 'BUY ORDER'}`);
        await axios.post(`${this.dbManagerUrl}/insertBuyTransaction`,{scenarioId:strategy.id, element:bar, capitaleInvestito:Math.floor(evalResult.grantedAmount / bar.c) * bar.c, prezzo:bar.c, operation:'BUY ORDER', MA:strategy.params.MA, orderId:orderRes.data.order.id, NumAzioni:Math.floor(evalResult.grantedAmount / bar.c) });
      }
      catch(error) {
        logger.error(`[handleTradeSignal] Errore durante inserimento nella tabella transazioni ${error.message}`);
        throw new error(`[handleTradeSignal] Errore durante inserimento nella tabella transazioni ${error.message}`);
      }

      try{
        // Invio cominicazione via email
        logger.trace(`[handleTradeSignal] Invio email richiamando ${this.alertingManagerUrl}/email/send Eseguito ${signal.action} su ${strategy.symbol} a ${bar.c} dettaglio ${JSON.stringify(orderRes.data)}`);
        await axios.post(`${this.alertingManagerUrl}/email/send`, {
            to: 'expovin@gmail.com',
            subject: `Ordine ${signal.action} ${strategy.symbol}`,
            body: `Eseguito ${signal.action} su ${strategy.symbol} a ${bar.c} executionId ${orderRes.data.execution_id} orderId ${orderRes.data.order.id} capitale ${Math.floor(evalResult.grantedAmount / bar.c)}`
        });
      } catch (err) {
        logger.error(`[handleTradeSignal] Errore durante invio email `, err.message);
        throw new error(`[handleTradeSignal] Errore durante invio email ${err.message}`);
      }
  }

  pause() {
    this.active = false;
    logger.warning(`[handleTradeSignal] Ricevuto comando PAUSE`);
  }

  resume() {
    this.active = true;
    logger.warning(`[handleTradeSignal] Ricevuto comando RESUME`);
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
