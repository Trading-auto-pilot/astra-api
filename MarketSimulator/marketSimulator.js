const WebSocket = require('ws');
const axios = require('axios');
const { publishCommand } = require('../shared/redisPublisher');
const createLogger = require('../shared/logger');
const crypto = require('crypto');

const MICROSERVICE = "MarketSimulator"
const MODULE_NAME = 'core';
const MODULE_VERSION = '1.0';


class MarketSimulator {
  constructor() {
    this.settings = {};
    this.wsClients = [];
    this.dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
    this.cacheManagerUrl = process.env.CACHEMANAGER_URL || 'http://localhost:3006';
    this.capitalManagerUrl = process.env.CAPITALMANAGER_URL || 'http://localhost:3009';
    this.liveMarketListenerUrl = process.env.LIVEMARKETLISTENER_URL || 'http://localhost:3012';
    this.interval = null;
    this.saveLastDate = null;
    this.nextDate = null;
    this.saveEndDate = null;
    this.simulationStatus = 'STOP';
    this.saveTf = null;
    this.intervals = {};
    this.logLevel = process.env.LOG_LEVEL;
    this.logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, this.logLevel || 'info');
    this.path = null;

    // Log delle variabili definite nell'istanza
    for (const key of Object.keys(this)) {
        // Esclude i metodi (funzioni)
        if (typeof this[key] !== 'function') {
        this.logger.trace(`[init] Variabile ${key} =`, this[key]);  
      }
    }
  }

  getLogLevel(){
    return this.logLevel;
  }

  setLogLevel(level) {
    this.logLevel=level;
    this.logger.setLevel(level);
  }

  async loadSettings() {
    this.logger.info(`[loadSettings] Caricamento configurazione da CacheManager...`);
    const keys = ['STREAM-SIMULATION-DELAY'];
    for (const key of keys) {
      const res = await axios.get(`${this.dbManagerUrl}/settings/${key}`);
      this.settings[key] = res.data;
      this.logger.trace(`[loadSettings] ${key} = ${res.data}`);
    }

    for (const [key, value] of Object.entries(process.env)) {
      this.logger.trace(`Environment variable ${key}=${value}`);
    }
  }

  async disconnect (targetId) {
    const clientToKill = [...this.wss.clients].find(ws => ws.id === targetId);
    if (clientToKill) {
      clientToKill.close(1000, 'Disconnected by server');
    }
  }


  getParams() {
    const clientInfo = [];

    this.wss.clients.forEach((ws) => {
      clientInfo.push({
        id: ws.id,
        isAlive: ws.isAlice ,                            // flag personalizzato
        path : ws.path,
        ip: ws._socket?.remoteAddress || 'unknown',             // indirizzo IP
        authenticated: ws.isAuthenticated || false,             // stato autenticazione
        subscribedSymbols: ws.subscribedSymbols || [],          // simboli sottoscritti
        readyState: ws.readyState                                // stato della connessione (0=connecting, 1=open, ecc.)
      });
    });
    return({
      simulationStatus : this.simulationStatus,
      nextDate: this.nextDate,
      wssServer : this.path,
      wsClientnumber : this.wsClients.length,
      clientInfo : clientInfo

    })
  }

  attachWebSocketServer(server) {
    
    const path = '/v2/iex';
    this.path = path
    this.wss = new WebSocket.Server({ server, path });
    this.logger.info(`[WebSocket] WebSocket server avviato su path: ${path}`);

    this.wss.on('connection', (ws, request) => {
      ws.id = crypto.randomUUID();
      ws.path = request.url; 
      this.logger.info(`[WebSocket] Nuovo client connesso ${ws.path}`);
      this.wsClients.push(ws);
      ws.isAlive = true;

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('close', (code, reason) => {
        this.wsClients = this.wsClients.filter(c => c !== ws);
        this.logger.info(`[WebSocket] Client disconnesso. Codice: ${code}, Motivo: ${reason.toString()}`);
      });

      ws.on('error', (err) => {
        this.logger.error(`[WebSocket] Errore su client: ${err.message}`);
      });

      ws.on('message', (message) => {
        try {
          const msg = JSON.parse(message);
      
          if (msg.action === 'auth') {
            this.logger.info(`[WebSocket] Autenticazione richiesta da client con key: ${msg.key}`);
      
            // Simula autenticazione
            ws.isAuthenticated = true;
            ws.subscribedSymbols = [];
            ws.send(JSON.stringify([{ T: 'success', msg: 'authenticated' }]));
      
          } else if (msg.action === 'subscribe') {
            if (!ws.isAuthenticated) {
              this.logger.warning(`[WebSocket] Tentata sottoscrizione senza autenticazione`);
              ws.send(JSON.stringify([{ T: 'error', msg: 'not authenticated' }]));
              return;
            }
      
            if (Array.isArray(msg.bars)) {
              ws.subscribedSymbols = msg.bars;
              this.logger.info(`[WebSocket] Sottoscritto ai simboli: ${msg.bars.join(', ')}`);
              ws.send(JSON.stringify([{ T: 'subscription', bars: msg.bars }]));
            }
      
          } else {
            this.logger.warning(`[WebSocket] Azione non riconosciuta: ${msg.action}`);
          }
      
        } catch (err) {
          this.logger.error(`[WebSocket] Errore parsing messaggio: ${err.message}`);
        }
      });

    });

    setInterval(() => {
    this.wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        this.logger.warning('[WebSocket] Nessun PONG ricevuto. Chiudo connessione inattiva.');
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping(); // invia ping al client
    });
  }, 30000); // ogni 30 secondi

  }
 
  async resetSimulation(){
    this.logger.info(`[resetSimulation] cancello ordini con DELETE [${this.dbManagerUrl}/simul/orders]`);
    const orders = await axios.delete(`${this.dbManagerUrl}/simul/orders`);
    this.logger.info(`[resetSimulation] cancello posizioni con DELETE [${this.dbManagerUrl}/simul/positions]`);
    const position = await axios.delete(`${this.dbManagerUrl}/simul/positions`);
    this.logger.info(`[resetSimulation] cancello strategy runs con DELETE [${this.dbManagerUrl}/strategies]`);
    let strategies = await axios.delete(`${this.dbManagerUrl}/strategies`);
    this.logger.info(`[resetSimulation] sincronizzo account con POST [${this.dbManagerUrl}/simul/account]`);
    let account = await axios.post(`${this.dbManagerUrl}/simul/account`);

    this.logger.info(`[resetSimulation] rinizzializzo capital manager con PUT [${this.capitalManagerUrl}/initCapitalManager]`);
    await axios.put(`${this.capitalManagerUrl}/initCapitalManager`);

    // Riazzero strategies
    strategies = await axios.get(`${this.dbManagerUrl}/strategies`);
    strategies = strategies.data;
    this.logger.info(`[resetSimulation] Azzero i valori di strategies ${JSON.stringify(strategies)}`);
    for (let i = 0; i < strategies.length; i++) {
      let strategy = strategies[i];
      this.logger.info(`[resetSimulation] Azzero strategy id ${strategy.id}`);

      strategy.CapitaleInvestito = 0;
      strategy.OpenOrders = 0;
      strategy.NumeroOperazioni = 0;
      strategy.NumeroOperazioniVincenti = 0;
      strategy.ggCapitaleInvestito = 0;
      strategy.MaxDay = 0;
      strategy.MinDay = 0;
      strategy.posizioneMercato = 'OFF';
      strategy.CapitaleResiduo = 0;

      // Salva la modifica se serve (es. in DB o array aggiornato)
      //strategies[i] = strategy;
      await axios.put(`${this.dbManagerUrl}/strategies/${strategy.id}`,strategy);
    }
    // this.logger.info(`[resetSimulation] Inizzializzazione LiveMarketListener ${this.liveMarketListenerUrl}/init}`);
    // await axios.post(`${this.liveMarketListenerUrl}/init`);
  }
 
  async getCandles( params ) {
    this.logger.log(`[getCandles] Chiamo [GET] ${this.cacheManagerUrl}/candles con params ${JSON.stringify(params)}`);
    const res = await axios.get(`${this.cacheManagerUrl}/candles`, params);
    this.logger.log(`[getCandles] Numero Candele ricevute : ${res.data.length}`);
    return res.data;
  }
 
  async pauseSimulation() {
    // this.saveLastDate = startDate;
    // this.saveEndDate = endDate;
    // this.saveTf = tf;
    this.simulationStatus = 'PAUSED';
    for (const key in this.intervals) {
      this.logger.info(`[stopSimulation] Interrompo simulazione per ${key}`);
      clearInterval(this.intervals[key]);
      delete this.intervals[key];
    }
    this.flushDB();
  }
  

  async startSimulation(startDate, endDate, tf = '15Min', stopCandles = 0) {

    if(this.nextDate)
         startDate = this.nextDate;

    if(this.saveEndDate)
      endDate = this.saveEndDate
  
    if(this.saveTf)
      tf = this.saveTf;

    let candlesProcessed = 0;
    this.simulationStatus = 'STARTED';
    const simulationStartTime = Date.now();
    this.logger.log(`[startSimulation] Avvio simulazione con startDate ${startDate} endDate ${endDate} tf ${tf} stopCandles ${stopCandles} simulationStartTime ${simulationStartTime} numero Client connessi ${this.wsClients.length}`);

    for (const ws of this.wsClients) {

        if (!ws.isAuthenticated || !ws.subscribedSymbols || ws.subscribedSymbols.length === 0) {
          this.logger.warning(`[startSimulation] non autenticato o senza simboli sottoscritti`);
          continue;  
        } 

        this.logger.log(`ws.subscribedSymbols ${ws.subscribedSymbols}`)
        for (const symbol of ws.subscribedSymbols) {
            this.logger.log(`[startSimulation] Simulazione per ${symbol} da ${startDate} a ${endDate} con TF ${tf}`);
            await this.loadSettings();

            const body = { 
                params: {
                  symbol,
                  startDate,
                  endDate,
                  tf
              }} 
            const candles = await this.getCandles(body);
            // this.logger.log(`[startSimulation] Chiamo : ${this.cacheManagerUrl}/candles con body ${JSON.stringify(body)}`);
            // const res = await axios.get(`${this.cacheManagerUrl}/candles`, body);
        
            //const candles = res.data;
            if (!Array.isArray(candles) || candles.length === 0) {
              this.logger.warning(`[startSimulation] Nessuna candela trovata per ${symbol}`);
              return;
            }
 
            const delay = parseInt(this.settings['STREAM-SIMULATION-DELAY']) || 500;
            let index = 0;
        
            const intervalKey = `${ws.id || ws.clientId || Math.random()}_${symbol}`;

            this.intervals[intervalKey] = setInterval(() => {
              if (index >= candles.length) {
                const elapsedMs = Date.now() - simulationStartTime;
                const totalSeconds = Math.floor(elapsedMs / 1000);
                const hours = Math.floor(totalSeconds / 3600);
                const minutes = Math.floor((totalSeconds % 3600) / 60);
                const seconds = totalSeconds % 60;

                this.logger.info(`[startSimulation] Fine simulazione per ${symbol} con chiave ${intervalKey} - Tempo impiegato: ${hours}h ${minutes}m ${seconds}s`);
                clearInterval(this.intervals[intervalKey]);
                delete this.intervals[intervalKey];
                this.flushDB();
                return;
              }              

              const candle = candles[index++];
              const nextCandle = candles[index];
              candle['S'] = symbol;
              candle["T"] = "b"; 
              this.saveLastDate = candle['t'];
              if(nextCandle)
                this.nextDate = nextCandle['t'];
              
              this.broadcastMessage([candle]);
        
              this.logger.trace(`[startSimulation] Inviata candela: ${JSON.stringify(candle)}`);
              

              if(stopCandles !== 0 && (candlesProcessed < stopCandles)){}
                this.pauseSimulation();
              candlesProcessed++;

            }, delay);
        }
    }
  }
 
  stopSimulation() {
    this.saveLastDate = null;
    this.saveEndDate = null;
    this.saveTf = null;
    this.nextDate=null;
    this.simulationStatus = 'STOP';
    this.logger.info(`[stopSimulation] Interrompo simulazione intervals`);
    for (const key in this.intervals) {
      this.logger.info(`[stopSimulation] Interrompo simulazione per ${key}`);
      clearInterval(this.intervals[key]);
      delete this.intervals[key];
    }
    this.flushDB();
  }

  async broadcastMessage(payload) {
    const ret = await this.updatePositionFromCandle(payload);
    const message = JSON.stringify(payload);
  
    this.wsClients.forEach(client => {
      if (client.readyState === 1) { // 1 = WebSocket.OPEN
        client.send(message);
      }
    }); 
  
    this.logger.log(`[broadcastMessage] Messaggio inviato a ${this.wsClients.length} client: ${message}`);
  }

  
  restartSimulation(startDate, endDate, tf = '15Min', stopCandles = 0) {

    this.simulationStatus = 'STARTED';
    if(!this.nextDate)
        this.nextDate = startDate;

    if(!this.saveEndDate)
      this.saveEndDate=endDate
  
    this.saveTf=tf;

    this.startSimulation(this.nextDate, this.saveEndDate, this.saveTf, stopCandles)
    return (this.nextDate);
  }

async recovery(candle) {
  this.logger.info(`[recovery] Avviata funzione recovery su | ${JSON.stringify(candle)}`);
  this.stopSimulation();
  let connected = false;

  while (!connected) {
    try {
      this.logger.info('[recovery] Tentativo di riconnessione a DBManager...');
      await axios.get(`${this.dbManagerUrl}/health`); // o `/simul/positions` se non hai un endpoint di health check
      connected = true;
      this.logger.info('[recovery] Riconnesso con successo a DBManager.');
    } catch (err) {
      this.logger.warning('[recovery] DBManager non disponibile. Nuovo tentativo tra 5 secondi...');
      await new Promise(res => setTimeout(res, 5000));
    }
  }

  this.restartSimulation();
}

async  updatePositionFromCandle(candle) {
  const symbol = candle[0].S;
  const close = parseFloat(candle[0].c);
  let position;

  this.logger.trace(`[updatePositionFromCandle] Aggiorno posizioni aperte con candela ${JSON.stringify(candle)}`);
  if (!symbol || isNaN(close)) {
    this.logger.warning('[updatePositionFromCandle] Candela non valida o incompleta');
    return { updated: false, reason: 'symbol o close mancanti' };
  }
  try {
    const allPositions = await axios.get(`${this.dbManagerUrl}/simul/positions`);
    position = allPositions.data.find(pos => pos.symbol === symbol);
    this.logger.trace(`[updatePositionFromCandle] Simbolo da cercare ${symbol}  Posizioni attive trovate | ${JSON.stringify(position)}`); 
  } catch (error) {
    if (error.code === 'ECONNRESET') {
      this.logger.error('[updatePositionFromCandle] Connessione persa con DBManager. Avvio recovery...');
      await this.recovery(candle);
    } else {
      this.logger.error('[updatePositionFromCandle] Errore non previsto:', error);
      throw error;
    }
  }
 
 
  if (!position) {
    this.logger.info(`[updatePositionFromCandle] Nessuna posizione attiva per ${symbol}`);
    return { updated: false, reason: 'nessuna posizione trovata' };
  }

  const qty = parseFloat(position.qty);
  const avg_entry_price = parseFloat(position.avg_entry_price);
  const cost_basis = parseFloat(position.cost_basis);
  const lastday_price = parseFloat(position.lastday_price);

  const market_value = qty * close;
  const unrealized_pl = (close - avg_entry_price) * qty;
  const unrealized_plpc =  (close / avg_entry_price) -1 ; //cost_basis !== 0 ? unrealized_pl / cost_basis : 0;
  const unrealized_intraday_pl = (close - lastday_price) * qty;
  const unrealized_intraday_plpc = lastday_price !== 0 ? (close - lastday_price) / lastday_price : 0;
  const change_today = unrealized_intraday_plpc;

  this.logger.trace(`[updatePositionFromCandle] qty:${qty} close:${close} market_value:${market_value} unrealized_pl:${unrealized_pl} unrealized_plpc:${unrealized_plpc}`);

  const updatedFields = {
    position_id: position.position_id,
    asset_id: position.asset_id,
    symbol: position.symbol,
    qty:0,
    avg_entry_price:avg_entry_price,
    current_price: parseFloat(close),
    market_value: parseFloat(market_value),
    unrealized_pl: parseFloat(unrealized_pl),
    unrealized_plpc: parseFloat(unrealized_plpc),
    unrealized_intraday_pl: parseFloat(unrealized_intraday_pl),
    unrealized_intraday_plpc: parseFloat(unrealized_intraday_plpc),
    change_today: parseFloat(change_today)
  };
  this.logger.trace(`[updatePositionFromCandle] updatedFields PUT ${this.dbManagerUrl}/simul/positions  |${JSON.stringify(updatedFields)}`);

  
  await axios.put(`${this.dbManagerUrl}/simul/positions`,updatedFields);
  this.logger.info(`[updatePositionFromCandle] Posizione ${symbol} aggiornata con candela`);
  
  // Inviare messaggio si websocket channel command : loadActivePosition
  await publishCommand({ action: 'loadActivePosition' });
  await publishCommand(updatedFields,"simulPositions:update");

  return { updated: true, symbol, updatedFields };
}

//{success:true, recordsStrategy:strategies.numStrategy, recordsStrategyRuns:numRecordSync, deletedStrategyRuns:numRecordDeleted}
  async flushDB() {
    try{
      const orders = await axios.post(`${this.dbManagerUrl}/simul/orders/once`);
      const positions = await axios.post(`${this.dbManagerUrl}/simul/positions/once`);
      const strategies = await axios.post(`${this.dbManagerUrl}/strategies/once`);
      this.logger.log(`[flushDB] Sync con DB. Ordini sincronizzati ${orders.ordersSynconDB} ordini chiusi ${orders.ordersClosed}. Posizioni sincronizzate ${positions.posizioniSynctoDB}`);
      this.logger.log(`[flushDB] Sync con DB. Strategy sincronizzati ${strategies.recordsStrategy} strategy_runs ${strategies.recordsStrategyRuns}. strategy_runs chiuse ${strategies.deletedStrategyRuns}`);
    } catch (error) {
      this.logger.error(`[flushDB] Error flush DB ${error.message}`);
    }

  }

  getInfo() {
    return {
      microservice : MICROSERVICE,
      module: MODULE_NAME,
      version: MODULE_VERSION,
      status: 'OK',
      logLevel: process.env.LOG_LEVEL || 'info'
    };
  }
}

module.exports = MarketSimulator;
