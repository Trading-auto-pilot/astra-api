// OrderSimulator.js
const axios = require('axios');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const createLogger = require('../shared/logger');

const MODULE_NAME = 'OrderSimulator';
const MODULE_VERSION = '1.1';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL);

class OrderSimulator {
  constructor() {
    this.wsClients = [];
    this.settings = {};
    this.dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
    this.wsServer = null;
  }

  async loadSettings() {
    logger.info('[loadSettings] Lettura configurazione da DBManager...');
    const keys = [
      'ALPACA-API-TIMEOUT'
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
    const now = new Date().toISOString();
    const orderId = uuidv4();
    const clientOrderId = uuidv4();

    const simulatedResponse =  {
        "id": "dad32b64-1b9a-42ac-ba38-1b12ed6c7891",
        "client_order_id": "2203bf6b-598d-47db-b647-d276fd400851",
        "created_at": "2025-05-10T12:52:49.542957477Z",
        "updated_at": "2025-05-10T12:52:49.544975207Z",
        "submitted_at": "2025-05-10T12:52:49.542957477Z",
        "filled_at": null,
        "expired_at": null,
        "canceled_at": null,
        "failed_at": null,
        "replaced_at": null,
        "replaced_by": null,
        "replaces": null,
        "asset_id": "b6d1aa75-5c9c-4353-a305-9e2caa1925ab",
        "symbol": "MSFT",
        "asset_class": "us_equity",
        "notional": null,
        "qty": "101",
        "filled_qty": "0",
        "filled_avg_price": null,
        "order_class": "",
        "order_type": "limit",
        "type": "limit",
        "side": "buy",
        "position_intent": "buy_to_open",
        "time_in_force": "day",
        "limit_price": "383",
        "stop_price": null,
        "status": "accepted",
        "extended_hours": false,
        "legs": null,
        "trail_percent": null,
        "trail_price": null,
        "hwm": null,
        "subtag": null,
        "source": null,
        "expires_at": "2025-05-12T20:00:00Z"
    }
    
    // Invia ordine simulato a DBManager
    try {
      await axios.post(`${this.dbManagerUrl}/insertSimulatedOrder`, {
        order: simulatedResponse.data.order
      });
    } catch (err) {
      throw new Error(`Errore durante l'invio al DBManager: ${err.message}`);
    }

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
    this.wsClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN && ws.isAuthenticated) {
        ws.send(msg);
        logger.trace(`[sendPayloadToClients] Inviato payload: ${msg}`);
      }
    });
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
