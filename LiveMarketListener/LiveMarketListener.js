// LiveMarketListener.js
const WebSocket = require('ws');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { placeOrder } = require('./placeOrders');
const createLogger = require('../shared/logger');

const MODULE_NAME = 'LiveMarketListener';
const MODULE_VERSION = '1.2';

const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL || 'info');
const isLocal = process.env.ENV_NAME === 'DEV';

class LiveMarketListener {
  constructor() {
    this.ws = null;
    this.active = true;
    this.symbolStrategyMap = {}; // { symbol: [strategyObj, ...] }
    this.settings = {};
    this.bots = [];
    this.dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
    this.capialManagerUrl = process.env.CAPITAL_MANAGER_URL || 'http://localhost:3009';
    this.alertingManagerUrl = process.env.ALERTINGMANAGER_URL || 'http://localhost:3008';
    this.orderActive=[];
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
    await this.loadActiveStrategies();
    await this.getActiveBots();
    await this.getActiveOrders();

    this.connect();
   
  }

  async getActiveOrders(){
    let res;
    logger.info(`[getActiveOrders] Recupero gli ordini da  ${this.alpacaAPIServer}/v2/orders`);
    try {
      res = await axios.get(`${this.alpacaAPIServer}/v2/orders`);
      const orders = Array.isArray(res.data) ? res.data : [];

      this.orderActive = [
        ...new Set(
          orders
            .filter(order => order.status === 'accepted' || order.status === 'new')
            .map(order => order.symbol)
        )
      ];
    } catch (err) {
      logger.error(`[orderActive] Errore durante il recupero ordini: ${err.message}`);
      this.orderActive = [];
    }

  logger.info(`[getActiveOrders] Recuperato ordini attivi ${JSON.stringify(this.orderActive)}`);

  } 

  async loadSettings() {
    logger.info(`[loadSetting] Lettura setting da repository...`);
    const keys = [
      'ALPACA-LIVE-MARKET',
      'ALPACA-SANDBOX-MARKET',
      'ALPACA-LOCAL-MARKET',
      'ALPACA-WSS-SIP',
      'ALPACA-API-TIMEOUT',
      'ALPACA-PAPER-BASE',
      'ALPACA-LOCAL-BASE',
      'ALPACA-LIVE-BASE',
      'ALPACA-DEV-MARKET',
      'ALPACA-DEV-BASE'
    ];

    for (const key of keys) {
      const res = await axios.get(`${this.dbManagerUrl}/settings/${key}`);
      this.settings[key] = res.data;
      logger.trace(`[loadSetting] Setting variavile ${key} : ${this.settings[key]}`);
    }
    this.alpacaAPIServer = this.settings[`ALPACA-`+process.env.ENV_ORDERS+`-BASE`];
    logger.trace(`[loadSetting] variabile alpacaAPIServer ${this.alpacaAPIServer}/v2/orders`);
  }

  updateOrderActive(symbolsToRemove) {
    if (!Array.isArray(this.orderActive)) {
      this.orderActive = [];
    }

    this.orderActive = this.orderActive.filter(
      symbol => !symbolsToRemove.includes(symbol)
    );

    logger.trace(`[updateOrderActive] Rimosso: ${symbolsToRemove.join(', ')}`);
  }


  async loadActiveStrategies() {
    logger.info(`[loadActiveStrategies] Lettura strategie attive da repository...`);
    logger.log(`[loadActiveStrategies] mi connetto al server ${this.dbManagerUrl}/strategies`);
    const res = await axios.get(`${this.dbManagerUrl}/strategies`);
    const strategies = res.data;

    this.symbolStrategyMap = {};
    for (const strategy of strategies) {
        const symbol = strategy.idSymbol;
        logger.trace(`[loadActiveStrategies] Recuperato symbol : ${symbol}`)
        if (!this.symbolStrategyMap[symbol]) {
            this.symbolStrategyMap[symbol] = [];
        }
        this.symbolStrategyMap[symbol].push(strategy);
    }
  }

  async getActiveBots(){
    logger.info(`[getActiveBots] Recupero i Bot attivi da repository...`);
    logger.log(`[getActiveBots] mi connetto al server ${this.dbManagerUrl}/bots`);
    const res = await axios.get(`${this.dbManagerUrl}/bots`);
    this.bots = res.data;
    for (const bot of this.bots) {
        logger.trace(`[getActiveBots] Recuperato bot : ${bot.name}`)
    }
  }

connect(retry = true) {
  const RECONNECT_DELAY_MS = 5000;

  if (this.ws && this.ws.readyState === WebSocket.OPEN) {
    logger.info('[connect] WebSocket già connesso, nessuna azione.');
    return;
  }

  logger.info(`[connect] Connessione in corso...`);
  const baseUrl = this.settings['ALPACA-' + process.env.ENV_MARKET + '-MARKET'];
  const wsUrl = `${baseUrl}/${process.env.FEED}`;
  logger.log(`[connect] Mi connetto a url : ${wsUrl}`);

  this.ws = new WebSocket(wsUrl);

  this.ws.on('open', () => {
    logger.info(`[connect] WebSocket connesso. Autenticazione in corso...`);
    this.ws.send(JSON.stringify({
      action: 'auth',
      key: process.env.APCA_API_KEY_ID,
      secret: process.env.APCA_API_SECRET_KEY
    }));
  });

  this.ws.on('message', async (data) => {
    logger.trace(`[connect] messaggio ricevuto ${data}`);

    let messages;
    try {
      messages = JSON.parse(data);
    } catch (err) {
      logger.error('[connect] Errore parsing JSON:', err.message);
      return;
    }

    for (const msg of messages) {
      if (msg.T === 'success' && msg.msg === 'authenticated') {
        logger.info('Autenticato. Passo alla sottoscrizione dei simboli');
        const symbols = Object.keys(this.symbolStrategyMap);
        this.ws.send(JSON.stringify({ action: 'subscribe', bars: symbols }));
        logger.info(`[connect] Sottoscritto ai simboli: ${symbols.join(', ')}`);
      }

      if (msg.T === 'b' && !this.orderActive.includes(msg.S)) {
        await this.processBar(msg);
      } else {
        logger.trace(`[connect] Candela non processata per ordine già attivo`);
      }
    }
  });

  this.ws.on('close', () => {
    logger.warning('[connect] Connessione WebSocket chiusa.');
    if (retry) {
      logger.info(`[connect] Nuovo tentativo di connessione in ${RECONNECT_DELAY_MS / 1000}s...`);
      setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
    }
  });

  this.ws.on('error', (err) => {
    logger.error(`[connect] Errore WebSocket ${wsUrl}: ${err.message}`);
    // Optional: forza chiusura se errore grave
    if (this.ws.readyState !== WebSocket.CLOSED && this.ws.readyState !== WebSocket.CLOSING) {
      this.ws.terminate?.();
    }
  });
}


  async processBar(bar) {
    // Read the params for active strategies
    await this.loadActiveStrategies();

    logger.log(`[processBar] Recupero strategie attive...`);
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
            v: bar.v,
            s: bar.S
            },
            strategyParams: strategy
        };

        // Se non ho comprato azioni valuto acquisto
        let url;
        if(strategy.numAzioniBuy === 0){
          logger.log(`[processBar] Non ho azioni per questa strategia, valuto solo acquisto.`);
          // Trova il bot con quel nome
          const bot = this.bots.find(b => b.name === strategy.idBotIn);

          let botUrl = bot?.url;
          if (isLocal && botUrl) {
            const urlObj = new URL(botUrl);
            urlObj.hostname = 'localhost';
            botUrl = urlObj.toString();
          }


          if (botUrl) {
            logger.log(`[processBar] Utilizzo url per bot ${strategy.idBotIn} url ${botUrl}`)
          } else {
            logger.error(`Bot ${strategy.idBotIn} non trovato. strategy ${strategy.idBotIn} bots ${JSON.stringify(this.bots)} `);
            return null;
          }
          
          url = new URL('/processCandle', botUrl).toString();
        } 
        // Altrimenti valuto vendita
        else {
          logger.log(`[processBar] Esistono ${strategy.numAzioniBuy} azioni per questa strategia, valuto solo vendita. isLocal : ${isLocal} ENV_NAME : ${process.env.ENV_NAME}`);
          // Trova il bot con quel nome
          const bot = this.bots.find(b => b.name === strategy.idBotOut);

          let botUrl = bot?.url;
          if (isLocal && botUrl) {
            const urlObj = new URL(botUrl);
            urlObj.hostname = 'localhost';
            botUrl = urlObj.toString();
          }

          if (bot) {
            logger.log(`[processBar] Utilizzo url per bot ${strategy.idBotOut} url ${bot.url}`)
          } else {
            logger.error(`Bot ${strategy.idBotOut} non trovato. strategy ${strategy.idBotOut} bots  ${JSON.stringify(this.bots)}`);
          }
          
          url = new URL('/processCandle', botUrl).toString();
        }

        try {
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

  async richiestaCapitale(bar,strategy){
      let evalResult;

      try {
        logger.trace(`[richiestaCapitale] Richiedo capitale disponibile a url ${this.capialManagerUrl}/evaluate/${strategy.id}`);
        const evalRes = await axios.get(`${this.capialManagerUrl}/evaluate/${strategy.id}`);
        evalResult = evalRes.data;
        logger.trace(`[richiestaCapitale] Risposta ${JSON.stringify(evalResult)}`);
        
      }
      catch (error) {
        logger.error(`[richiestaCapitale] Errore durante richiesta capitale disponibile ${strategy.id}: ${error.message}`);
        return;
      }

      if (!evalResult.approved) {
        logger.info(`[richiestaCapitale] Allocazione rifiutata per ${strategy.idSymbol} (${strategy.id})`);
        return;
      }
  
      if(evalResult.grantedAmount < bar.c){
        logger.info(`[richiestaCapitale] Non ci sono fondi sufficienti per ${strategy.idSymbol} (${strategy.id}). Capitale rimasto ${evalResult.grantedAmount} costo azione ${bar.c}`);
        return;
      }

      return evalResult;

  }

  async addOrdertoOrderTable(orderRes){

    try {
      // Inserisco l'ordine nella tabella ordini fatti 
      logger.trace(`[addOrdertoOrderTable] Ricevuta risposta ${JSON.stringify(orderRes)} inserisco nel DB richiamando ${this.dbManagerUrl}/insertOrder`);
      await axios.post(`${this.dbManagerUrl}/insertOrder`, orderRes);

    // Se ci sono sotto-ordini, gestiscile ricorsivamente
    if (orderRes.legs && Array.isArray(orderRes.legs)) {
      for (const leg of orderRes.legs) {
        logger.trace(`[addOrdertoOrderTable] Gestisco leg correlata: ${JSON.stringify(leg)}`);
        const result = await this.addOrdertoOrderTable(leg);
        if (result !== 'OK') {
          logger.error(`[addOrdertoOrderTable] Errore durante Inserimento leg: ${JSON.stringify(leg)}`);
          return null; // Ferma tutto se una leg fallisce
        }
      }
    }

    }
    catch (error) {
      logger.error(`[addOrdertoOrderTable] Errore durante Inserimento ordine  ${error.message} ${JSON.stringify(orderRes)}`);
      return null;
    }
    return ('OK');
  }

  async aggiungiTransazioneClose(strategy, evalResult,bar,orderRes){

    logger.trace(`[aggiungiTransazioneClose] strategy : ${JSON.stringify(strategy)}`);
    logger.trace(`[aggiungiTransazioneClose] evalResult : ${JSON.stringify(evalResult)}`);
    logger.trace(`[aggiungiTransazioneClose] bar : ${JSON.stringify(bar)}`);
    logger.trace(`[aggiungiTransazioneClose] orderRes : ${JSON.stringify(orderRes)}`);

    try {
      logger.trace(`[aggiungiTransazioneClose] Aggiungo record a tabella SELL alla transazioni ${this.dbManagerUrl}/insertSellTransaction ${strategy.id} ${JSON.stringify(bar)} ${orderRes.market_value} ${bar.c} "SELL" ${strategy.params.MA} null ${orderRes.qty}`);
      await axios.post(`${this.dbManagerUrl}/insertSellTransaction`,{scenarioId:strategy.id, element:bar, orderRes });
    } catch(error) {
      logger.error(`[aggiungiTransazioneClose] Errore durante inserimento nella tabella transazioni ${error.message}`);
      return null;
    }
  }


  async aggiungiTransazioneOrder(strategy, evalResult,bar,orderRes){
    let numShare, speso, operation;

    logger.trace(`[aggiungiTransazioneOrder] strategy : ${JSON.stringify(strategy)}`);
    logger.trace(`[aggiungiTransazioneOrder] evalResult : ${JSON.stringify(evalResult)}`);
    logger.trace(`[aggiungiTransazioneOrder] bar : ${JSON.stringify(bar)}`);
    logger.trace(`[aggiungiTransazioneOrder] orderRes : ${JSON.stringify(orderRes)}`);

    try{
      //Aggiungo la transazione BUY nella tabella transazioni
      if(orderRes.side === 'buy'){
        numShare = Math.floor(evalResult.grantedAmount / bar.c);
        speso= numShare * ((parseFloat(strategy.params.buy.limit_price) +1) * bar.c);
        operation="BUY ORDER"
        logger.trace(`[aggiungiTransazioneOrder] Aggiungo record BUY a tabella transazioni ${this.dbManagerUrl}/transactions/buy ${strategy.id} ${JSON.stringify(bar)} ${speso} ${bar.c} ${operation}} ${strategy.params.MA} ${orderRes.id} ${numShare}`);
        await axios.post(`${this.dbManagerUrl}/transactions/buy`,{orderId:orderRes.id, scenarioId:strategy.id, element:bar, capitaleInvestito:speso, prezzo:bar.c, operation:operation, MA:strategy.params.MA, NumAzioni:numShare });
        //Aggiungo la transazione SELL nella tabella transazioni
      } else {
        numShare = orderRes.qty;
        speso=null;
        operation="SELL ORDER"
      logger.trace(`[aggiungiTransazioneOrder] Aggiungo record a tabella SELL alla transazioni ${this.dbManagerUrl}/transactions/sell ${strategy.id} ${JSON.stringify(bar)} ${speso} ${bar.c} ${operation}} ${strategy.params.MA} ${orderRes.id} ${numShare}`);
      await axios.post(`${this.dbManagerUrl}/transactions/sell`,{orderId:orderRes.id, scenarioId:strategy.id, element:bar, operation:operation, MA:strategy.params.MA, NumAzioni:numShare });
      }
   }
    catch(error) {
      logger.error(`[aggiungiTransazioneOrder] Errore durante inserimento nella tabella transazioni ${error.message}`);
      return null;
    }
    return ('OK');
  }

  async aggiornaCapitaliImpegnati(evalResult,bar, strategy){
    try {
      //Aggiorno con il capitale impegnato per questo ordine
      logger.trace(`[aggiornaCapitaliImpegnati] Aggiorno la tabella Strategies con i capitali utilizzati PUT ${this.dbManagerUrl}/strategies/capitalAndOrder`);
      const capitale = Math.floor(evalResult.grantedAmount / bar.c) * bar.c;
      await axios.put(`${this.dbManagerUrl}/strategies/capitalAndOrder`, {id :strategy.id ,openOrders: capitale});
    }
    catch (error) {
        logger.error(`[aggiornaCapitaliImpegnati] Errore durante update capitale nella tabella strategies ${error.message}`);
        return null;
    }
    return ('OK');
  }

  async invioComunicazione(signal, strategy, orderRes, bar, evalResult){
    try{
      // Invio cominicazione via email
      logger.trace(`[invioComunicazione] Invio email richiamando ${this.alertingManagerUrl}/email/send Eseguito ${signal.action} su ${strategy.symbol} a ${bar.c} dettaglio ${JSON.stringify(orderRes)}`);
      await axios.post(`${this.alertingManagerUrl}/email/send`, {
          to: 'expovin@gmail.com',
          subject: `Ordine ${signal.action} ${strategy.symbol}`,
          body: `Eseguito ${signal.action} su ${strategy.symbol} a ${bar.c} orderId ${orderRes.id} capitale ${Math.floor(evalResult.grantedAmount / bar.c)}`
      });
    } catch (err) {
      logger.error(`[invioComunicazione] Errore durante invio email `, err.message);
      return null;
    }
    return ('OK');
  }

  async CLOSE_POSITIONS(strategy){
    // Chiusura di tutte le posizioni di symbol
    let orderRes;
    try {
      logger.trace(`[CLOSE_POSITIONS] Chiusura posizioni : DELETE ${this.alpacaAPIServer}/v2/positions/${strategy.idSymbol}`);
      orderRes = await axios.delete(`${this.alpacaAPIServer}/v2/positions/${strategy.idSymbol}`);
      return orderRes.data;
    } catch (error) {
        logger.error(`[CLOSE_POSITIONS] Errore durante la chiusura della posizione ${error.message} ${this.alpacaAPIServer}/v2/positions`);
        return null;
    }
  }

  async SELL(strategy, bar){
    let orderRes;
    try {
        logger.trace(`[SELL] Apro ordine con id ${strategy.id+'-'+uuidv4()}`);
        orderRes = await placeOrder(            this.alpacaAPIServer,
                                                process.env.APCA_API_KEY_ID,
                                                process.env.APCA_API_SECRET_KEY,
                                                strategy.idSymbol, 
                                                strategy.numAzioniBuy, 
                                                'sell', 
                                                strategy.params.sell.type,         
                                                strategy.params.sell.time_in_force,            
                                                Math.ceil((parseFloat(strategy.params.sell.limit_price) +1)  * bar.c),             
                                                Math.ceil((parseFloat(strategy.params.sell.stop_price) + 1) * bar.c),
                                                strategy.params.sell.trail_price,
                                                strategy.params.sell.extended_hours,
                                                bar.env === "TEST"?  
                                                    strategy.id+'-TEST-'+uuidv4().replace(/-/g, '').slice(0, 12) : 
                                                    strategy.id+'-'+uuidv4()
                                                // v.1.2 Rimuovo l'ordine braket e gestisco manualmente dal
                                                // momento che sembra non affidabile.
                                                //"bracket",
                                                //talke_profit,
                                                //stop_loss
                                              );            
    }
    catch (error) {
        logger.error(`[SELL] Errore durante richiesta apertura ordine ad Alpaca ${error.message} ${this.alpacaAPIServer}/v2/positions`);
        return null;
    }
    return orderRes;
  }

  async BUY(strategy, evalResult, bar){
    let orderRes;
    try {
        const numShare = Math.floor(evalResult.grantedAmount / bar.c);
        const talke_profit = { "limit_price": Math.ceil((parseFloat(strategy.params.TP) + 1) * bar.c) };
        const stop_loss= {
          "stop_price": Math.floor((1 - parseFloat(strategy.params.SL)) * bar.c)
        };
        logger.trace(`[BUY] Apro ordine con id ${strategy.id+'-'+uuidv4()} limit price ${strategy.params.buy.limit_price +1} * ${bar.c} = ${Math.ceil((parseFloat(strategy.params.buy.limit_price) +1) * bar.c)}`);
        orderRes = await placeOrder(            this.alpacaAPIServer+'/v2/orders',
                                                process.env.APCA_API_KEY_ID,
                                                process.env.APCA_API_SECRET_KEY,
                                                strategy.idSymbol, 
                                                numShare, 
                                                'buy', 
                                                strategy.params.buy.type,         
                                                strategy.params.buy.time_in_force,            
                                                Math.ceil((parseFloat(strategy.params.buy.limit_price) +1) * bar.c),             
                                                strategy.params.buy.stop_price,
                                                strategy.params.buy.trail_price,
                                                strategy.params.buy.extended_hours,
                                                bar.env === "TEST"?  
                                                    strategy.id+'-TEST-'+uuidv4().replace(/-/g, '').slice(0, 12) : 
                                                    strategy.id+'-'+uuidv4()
                                                // v.1.2 Rimuovo l'ordine braket e gestisco manualmente dal
                                                // momento che sembra non affidabile.
                                                //"bracket",
                                                //talke_profit,
                                                //stop_loss
                                              );            
    }
    catch (error) {
        logger.error(`[BUY] Errore durante richiesta apertura ordine ad Alpaca ${error.message} ${this.alpacaAPIServer}/v2/orders`);
        return null;
    }

    return orderRes;
  }

  async handleTradeSignal(signal, strategy, bar) {
    logger.trace(`[handleTradeSignal] Ricevuto segnale ${signal.action} su strategia ${JSON.stringify(strategy)} con bar ${JSON.stringify(bar)}`);
    let orderRes, rc, evalResult;

    // Nel caso si segnale BUY
      if(signal.action === 'BUY') {
        evalResult = await this.richiestaCapitale(bar, strategy);
        if(!evalResult)
          return;
        orderRes = await this.BUY(strategy, evalResult, bar);
        this.orderActive.push(bar.S);

        if (!orderRes) {
          logger.error(`[handleTradeSignal] BUY operation failed`);
          throw new Error('BUY operation failed');
        }
      } 
      // Nel caso di segnale SELL
      else {
        // Verifico se c'e' gia un ordine immesso o se il flag this.sellOrderPlaced=true (ordine immesso ma non)
        // ancora preso in carico da Alpaca.
        this.alpacaAPIServer = this.settings[`ALPACA-`+process.env.ENV_ORDERS+`-BASE`];
        logger.trace(`[handleTradeSignal] variabile alpacaAPIServer ${this.alpacaAPIServer}/v2/orders`);

        logger.trace(`[handleTradeSignal] Verifico se esiste gia un ordine SELL prima di reinserirlo ...`);
        let orders=[];
        try { 
            const res = await axios.get(`${this.alpacaAPIServer}/v2/orders`, {
                headers: {
                    'APCA-API-KEY-ID': process.env.APCA_API_KEY_ID, 
                    'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET_KEY,
                    'Content-Type': 'application/json'
                }
            });
            orders=res.data;
        } catch (error) {
            logger.error(`[handleTradeSignal] Errore recupero ordini da Alpaca ${error.message}`);
            return null;
        }
        // Data e ora correnti
        const now = new Date();
        //const createdAt = new Date(order.created_at);
        logger.trace(`[handleTradeSignal] orders: ${JSON.stringify(orders)}`)
        let exists = orders.some( o => o.symbol === bar.S && 
                                    Number(o.qty) === Number(strategy.numAzioniBuy) &&
                                    o.side === 'sell' &&
                                    o.status === 'new');

        logger.error(`[handleTradeSignal] Numero ordini trovati ${exists}`);

        if(!exists) { // Non ho ancora immesso ordine, lo immetto ora.
          orderRes = strategy.params.sell.exitMode === "order" ? await this.SELL(strategy, bar) : await this.CLOSE_POSITIONS(strategy) ;
          logger.trace(`[handleTradeSignal] ExitMode ${strategy.params.sell.exitMode} orderRes da chiusura posizioni : ${JSON.stringify(orderRes)} `);
        }
        else {
          logger.warning(`[handleTradeSignal] Ordine sell gia immesso interrompo flusso`);
          return;
        }
      }

      if(strategy.params.sell.exitMode === "close" && signal.action === 'SELL') {

        logger.trace(`[handleTradeSignal] Messaggio di ritorno dalla chiusura posizioni : ${JSON.stringify(orderRes)}`);

        rc = await this.aggiungiTransazioneClose(strategy, evalResult,bar,orderRes);
        if (!rc) {
          logger.error(`[handleTradeSignal] Aggiunta Transazione operation failed`);
          throw new Error('Aggiunta Transazione operation failed');
        }

      } 
        // Nel caso in cui la vendita sia stata fatta con la chiusura delle posizioni
      else {

        // rc = await this.addOrdertoOrderTable(orderRes);
        // if (!rc) {
        //   logger.error(`[handleTradeSignal] addOrdertoOrderTable operation failed`);
        //   throw new Error('addOrdertoOrderTable operation failed');
        // }
        rc = await this.aggiungiTransazioneOrder(strategy, evalResult,bar,orderRes);
        if (!rc) {
          logger.error(`[handleTradeSignal] Aggiunta Transazione operation failed`);
          throw new Error('Aggiunta Transazione operation failed');
        }

        rc = await this.aggiornaCapitaliImpegnati(evalResult,bar, strategy);
        if (!rc) {
          logger.error(`[handleTradeSignal] Aggiornamento capitale impegnato operation failed`);
          throw new Error('Aggiornamento capitale impegnato operation failed');
        }
      }


      rc = await this.invioComunicazione(signal, strategy, orderRes,bar, evalResult);
      if (!rc) {
        logger.error(`[handleTradeSignal] Invio comunicazione operation failed`);
        throw new Error('Invio comunicazione operation failed');
      }

  }

  pause() {
    this.active = false;
    logger.warning(`[pause] Ricevuto comando PAUSE`);
  }

  resume() {
    this.active = true;
    logger.warning(`[resume] Ricevuto comando RESUME`);
  }

  getInfo() {
    return {
      module: MODULE_NAME,
      version: MODULE_VERSION,
      paused: !this.active,
      subscribedSymbols: Object.keys(this.symbolStrategyMap),
      activeOrders : this.orderActive
    };
  }
}

module.exports = LiveMarketListener;
