// OrderSimulator.js
const axios = require('axios');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const createLogger = require('../shared/logger');

const MODULE_NAME = 'OrderSimulator';
const MODULE_VERSION = '1.2';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL);

class OrderSimulator {
  constructor() {
    this.wsClients = [];
    this.settings = {};
    this.dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
    this.liveMarketManager = process.env.LIVEMARKETMANAGER_URL || 'http://localhost:3012';
    this.wsServer = null;
    this.sharedClock=null;
  }

  async loadSettings() {
    logger.info('[loadSettings] Lettura configurazione da DBManager...');
    const keys = [
      'ALPACA-API-TIMEOUT',
      'ALPACA-DEV-MARKET',
      'ALPACA-PAPER-MARKET',
      'ALPACA-LIVE-MARKET',
      'ALPACA-LOCAL-MARKET'
    ];

    for (const key of keys) {
      try {
        const res = await axios.get(`${this.dbManagerUrl}/getSetting/${key}`);
        this.settings[key] = res.data.value;
        logger.trace(`[loadSettings] Impostato ${key} = ${res.data.value}`);
      } catch (err) {
        logger.error(`[loadSettings] Errore su ${key}: ${err.message}`);
      }
    }

    for (const [key, value] of Object.entries(process.env)) {
      logger.trace(`Environment variable ${key}=${value}`);
    }

    for (const [key, value] of Object.entries(process.env)) {
      logger.trace(`Environment variable ${key}=${value}`);
    }
  }

  applySharedClockToOrder(order) {
    if (!this.sharedClock) {
      throw new Error('sharedClock non definito. Assicurati che sia stato inizializzato.');
    }

    const baseDate = new Date(this.sharedClock); // es. "2025-05-10T12:52:49Z"

    // converte in ISO esteso (come restituito da Alpaca)
    const fullPrecisionIso = baseDate.toISOString().replace('Z', '') + 'Z';

    order.created_at = fullPrecisionIso;
    order.updated_at = fullPrecisionIso;
    order.submitted_at = fullPrecisionIso;

    // gestisce expires_at solo se time_in_force è "day"
    if (order.time_in_force === 'day') {
      const expiresDate = new Date(baseDate);
      expiresDate.setUTCDate(expiresDate.getUTCDate() + 1);
      order.expires_at = expiresDate.toISOString().replace('Z', '') + 'Z';
    }

    return order;
  }

  async sendNew(orderPayload) {

    const newMessage = {
        "stream":"trade_updates",
        "data":{
                "at": orderPayload.created_at,
                "event_id": "01JVSKESVEQERFRR4F0B8V34EH",
                "event": "new",
                "timestamp": orderPayload.created_at,
                "order": orderPayload,
                "execution_id": uuidv4()
            } 
    }

    this.sendPayloadToClients(newMessage);
  }

  async sendFill(orderPayload) {

    const FillMessage = {
        "stream":"trade_updates",
        "data":{
            "at": orderPayload.created_at,
            "event_id": "01JVSKESVEQERFRR4F0B8V34EH",
            "event": "fill",
            "timestamp": orderPayload.created_at,
            "order": orderPayload,
            "execution_id": uuidv4()
          } 
    }

    logger.trace(`[sendFill] Messaggio da inviare su webSocket ${JSON.stringify(FillMessage)}`);
    this.sendPayloadToClients(FillMessage);
  }

  async acceptOrder(orderPayload) {
    const requiredAlways = ['symbol', 'side', 'type', 'time_in_force'];

    // Verifica i campi obbligatori sempre
    const missingAlways = requiredAlways.filter(f => !orderPayload[f]);
    if (missingAlways.length > 0) {
      throw new Error(`Missing required fields: ${missingAlways.join(', ')}`);
    }

    // Verifica che esista **esattamente uno** tra `qty` e `notional`
    const hasQty = 'qty' in orderPayload;
    const hasNotional = 'notional' in orderPayload;

    if (hasQty && hasNotional) {
      throw new Error(`Only one of 'qty' or 'notional' must be provided, not both.`);
    }

    if (!hasQty && !hasNotional) {
      throw new Error(`One of 'qty' or 'notional' must be provided.`);
    }    

    // Simula la risposta Alpaca

    const orderId = uuidv4();
    const clientOrderId = uuidv4();

    const simulatedResponse =  {
        "id": orderId,
        "client_order_id": clientOrderId,
        "created_at": "",
        "updated_at": "",
        "submitted_at": "",
        "filled_at": null,
        "expired_at": null,
        "canceled_at": null,
        "failed_at": null,
        "replaced_at": null,
        "replaced_by": null,
        "replaces": null,
        "asset_id": "b6d1aa75-5c9c-4353-a305-9e2caa1925ab",
        "symbol": orderPayload.symbol,
        "asset_class": "us_equity",
        "notional": null,
        "qty": orderPayload.qty,
        "filled_qty": "0",
        "filled_avg_price": null,
        "order_class": "",
        "order_type": orderPayload.type,
        "type": orderPayload.type,
        "side": orderPayload.side,
        "position_intent": orderPayload.side === 'buy'?"buy_to_open":"sell_to_close",
        "time_in_force": orderPayload.time_in_force,
        "limit_price": orderPayload.limit_price,
        "stop_price": null,
        "status": "accepted",
        "extended_hours": false,
        "legs": null,
        "trail_percent": null,
        "trail_price": null,
        "hwm": null,
        "subtag": null,
        "source": null,
        "expires_at": ""
    }

    this.applySharedClockToOrder(simulatedResponse);
    logger.trace(`[acceptOrder] messaggio Order Simulated ${JSON.stringify(simulatedResponse)}`);
    
    // Invia ordine simulato a DBManager
    try {
      await axios.post(`${this.dbManagerUrl}/simul/orders`,simulatedResponse );
    } catch (err) {
      throw new Error(`Errore durante l'invio al DBManager: ${err.message}`);
    }

    // Invio il Messaggio new
    setTimeout(() => {
      this.sendNew(simulatedResponse);
    }, 300); // 3000 ms = 3 secondi

    return simulatedResponse;
  }

  attachWebSocketServer(server) {
    logger.info(`[attachWebSocketServer] Avvio WebSocket Server...`);
    this.wsServer = new WebSocket.Server({ server });

    this.wsServer.on('connection', (ws) => {
        logger.info('[WebSocket] Nuovo client connesso');
        ws.isAuthenticated = false;
        this.wsClients.push(ws);

        ws.on('message', (message) => {
            try {
              const msg = JSON.parse(message);
              logger.log(`[WebSocket] Messaggio ricevuto ${JSON.stringify(msg)}`);
            if (msg.action === 'auth') {
                if (msg.key === this.settings['APCA-API-KEY-ID'] && msg.secret === this.settings['APCA-API-SECRET-KEY']) {
                ws.isAuthenticated = true;
                ws.send(JSON.stringify({
                  "stream": "authorization",
                  "data": {
                    "status": "authorized",
                    "action": "authenticate"
                  }
                }));
                logger.info('[WebSocket] Autenticazione riuscita');
                } else {
                ws.send(JSON.stringify({ T: 'error', msg: 'authentication failed' }));
                logger.warning('[WebSocket] Autenticazione fallita');
                }
            }
            } catch (err) {
            logger.error('[WebSocket] Errore parsing messaggio:', err.message);
            }
        });

        ws.on('close', () => {
            this.wsClients = this.wsClients.filter(c => c !== ws);
            logger.info('[WebSocket] Client disconnesso');
        });
    });
  }

  connectToMarketWebSocketForClock() {
    logger.info(`[connectToMarketWebSocketForClock] Connessione in corso...`);
    const baseUrl = this.settings['ALPACA-' + process.env.ENV_MARKET + '-MARKET'];
    const wsUrl = `${baseUrl}/${process.env.FEED}`;
    logger.log(`[connectToMarketWebSocketForClock] Mi connetto a url : ${wsUrl}`);

    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      logger.info(`[connectToMarketWebSocketForClock] WebSocket connesso. Autenticazione in corso...`);
      this.ws.send(JSON.stringify({
        action: 'auth',
        key: process.env.APCA_API_KEY_ID,
        secret: process.env.APCA_API_SECRET_KEY
      }));
    });

    this.ws.on('message', async (data) => {
      
      let messages;

      try {
        messages = JSON.parse(data);
      } catch (err) {
        logger.error('[connectToMarketWebSocketForClock] Errore parsing JSON iniziale:', err.message);
        return;
      }

      for (const msg of messages) {
        if (msg.T === 'success' && msg.msg === 'authenticated') {
          logger.info('Autenticato.');
        }

        if (msg.T === 'b' && msg.t) {
          logger.trace(`[connectToMarketWebSocketForClock] messaggio ricevuto ${data}`);
          this.processCandle(msg);
        }
      }
    });

    this.ws.on('close', () => {
      logger.warning(`[connect] Connessione WebSocket chiusa.`);
    });

    this.ws.on('error', (err) => {
      logger.error(`[connect] Errore WebSocket ${wsUrl}: ${err.message}`);
    });
  }




  async startSimulation() {
    logger.info('[startSimulation] Simulazione avviata');
    // Placeholder - future implementation (e.g. broadcast simulated order statuses)
  }

  async stopSimulation() {
    logger.info('[stopSimulation] Simulazione fermata');
    // Placeholder - clear intervals or other cleanup
  }

  async sendPayloadToClients(payload) {
    const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
    logger.info(`[sendPayloadToClients] Messaggio da inviare su ws ${msg} Client Connessi ${this.wsClients.length}`);
    this.wsClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN && ws.isAuthenticated) {
        ws.send(msg);
        logger.trace(`[sendPayloadToClients] Inviato payload: ${msg}`);
      } else {
        logger.error(`[sendPayloadToClients] Errore nell'invio del messaggio su ws: ${msg} readyState ${ws.readyState === WebSocket.OPEN} authenticated ${ws.isAuthenticated}`);
      }
    });
  }

async  getAccount() {
  try {
    const res = await axios.get(`${this.dbManagerUrl}/simul/account`);
    return res.data;
  } catch (error) {
    logger.error(`[getAccount] Errore nel recupero account: ${error.message}`);
    throw new Error('Impossibile recuperare lo stato simulato dell’account');
  }
}

async  getPositions() {
  try {
    const res = await axios.get(`${this.dbManagerUrl}/simul/positions`);
    return res.data;
  } catch (error) {
    logger.error(`[getAccount] Errore nel recupero account: ${error.message}`);
    throw new Error('Impossibile recuperare lo stato simulato dell’account');
  }
}

async getOrders(){
  let response;
  try{
    response = await axios.get(`${this.dbManagerUrl}/simul/orders`);
  } catch(error) {
    logger.error(`[getOrders] Errore: ${err.message}`);
  }
  return(response);
}

async  processCandle(candle) {
  this.sharedClock = candle.t;

  try {
    logger.trace(`[processCandle] Recupero ordini attivi da : ${this.dbManagerUrl}/simul/orders`);
    const response = await axios.get(`${this.dbManagerUrl}/simul/orders`);
    const orders = response.data;

    //logger.trace(`[processCandle] symbol : ${candle.S} limit_price:${parseFloat(orders[0].limit_price)} candle price:${candle.l} `);
    const matchedOrders = orders.filter(order =>
      order.status === 'accepted' &&
      order.symbol === candle.S &&
      order.side === 'buy' &&
      order.limit_price &&
      parseFloat(order.limit_price) >= parseFloat(candle.l)
    );

    logger.trace(`[processCandle] Ordini attivi trovati : ${JSON.stringify(matchedOrders)}`);


    for (const order of matchedOrders) {
      const fillPrice = (
        (parseFloat(order.limit_price) + parseFloat(candle.l)) / 2
      ).toFixed(2);
      const qty = parseFloat(order.qty);
      const now = new Date(this.sharedClock).toISOString();

      logger.trace(`[processCandle] Ordine attivo ${JSON.stringify(order)} processato, aggiorno ordine DB`);
      // Aggiorna ordine nel DB
      await axios.put(`${this.dbManagerUrl}/simul/orders`, {
        id: order.id,
        status: 'filled',
        filled_qty: qty,
        filled_avg_price: fillPrice,
        filled_at: now,
        updated_at: now
      });

      const newPosition = {
        asset_id: order.asset_id,
        symbol: order.symbol,
        exchange: null,
        asset_class: order.asset_class,
        qty: order.qty,
        avg_entry_price: order.filled_avg_price,
        side:order.side,
        market_value:order.filled_avg_price,
        cost_basis:0,
        unrealized_pl:0,
        unrealized_plpc:0,
        unrealized_intraday_pl:0,
        unrealized_intraday_plpc:0,
        current_price:order.filled_avg_price,
        lastday_price: order.filled_avg_price,
        change_today:0,
        qty_available:order.qty
      };

      logger.trace(`[processCandle] Inserisco nuova posizione a DB ${JSON.stringify(newPosition)}`);
      // Aggiorna ordine nel DB
      await axios.post(`${this.dbManagerUrl}/simul/positions`, newPosition); 

      // Remove the symbol from the list of Active orders
      await axios.put(`${this.liveMarketManager}/orderActive/remove`, {symbol : order.symbol}); 
      
      // Invio messaggio fill su websocket
      logger.trace(`[processCandle] Invio messaggio FILL su websocket ${JSON.stringify(order)}`);
      this.sendFill(order);
    }
  } catch (err) {
    logger.error(`[processCandle] Errore: ${err.message}`);
  }
}

  getInfo() {
    return {
      module: MODULE_NAME,
      version: MODULE_VERSION,
      status: 'OK',
      logLevel: process.env.LOG_LEVEL || 'info'
    };
  }
}

module.exports = OrderSimulator;
