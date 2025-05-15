// orderListener/OrderListener.js
const WebSocket = require('ws');
const axios = require('axios');
const routeEvent = require('./router');
const createLogger = require('../shared/logger');

const MODULE_NAME = 'OrderListener';
const MODULE_VERSION = '1.0';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL);

class OrderListener {
  constructor() {
    this.ws = null;
    this.settings = {};
    this.dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
    this.timeout = 10000;
  }

  async init() {
    logger.info(`[init] Inizializzazione...`);

    if (this.isPaper === null) {
        logger.warninging(`[init] ENVIRONMENT non valido o mancante: "${this.env}". Valori accettati: PAPER, LIVE`);
    }

    // Log delle variabili definite nell'istanza
    for (const key of Object.keys(this)) {
        // Esclude i metodi (funzioni)
        if (typeof this[key] !== 'function') {
            logger.trace(`[init] Variabile ${key} =`, this[key]);
        }
    }

    await this.loadSettings();
    this.connect();
  }

  async loadSettings() {
    logger.info(`[loadSettings] Lettura setting da DBManager...`);
    const keys = [
      'APCA-API-KEY-ID',
      'APCA-API-SECRET-KEY',
      'ALPACA-PAPER-TRADING',
      'ALPACA-LIVE-TRADING',
      'ALPACA-LOCAL-TRADING',
      'ALPACA-API-TIMEOUT'
    ];

    for (const key of keys) {
      try {
        const res = await axios.get(`${this.dbManagerUrl}/getSetting/${key}`);
        this.settings[key] = res.data.value;
        logger.trace(`[loadSettings] ${key} = ${res.data.value}`);
      } catch (err) {
        logger.error(`[loadSettings] Errore nel recupero di ${key}: ${err.message}`);
        throw err;
      }
    }

    for (const [key, value] of Object.entries(process.env)) {
      logger.trace(`Environment variable ${key}=${value}`);
    }

    this.timeout = parseInt(this.settings['ALPACA-API-TIMEOUT']) || 10000;
  }

  connect() {
    const wsUrl = this.settings['ALPACA-'+process.env.ENV_TRADING+'-TRADING'];
    logger.info(`[${MODULE_NAME}][connect] Connessione al WebSocket: ${wsUrl}`);

    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      logger.info(`[${MODULE_NAME}][connect] WebSocket connesso. Autenticazione in corso...`);

      this.ws.send(JSON.stringify({
        action: 'auth',
        data: {
          key_id: this.settings['APCA-API-KEY-ID'],
          secret_key: this.settings['APCA-API-SECRET-KEY']
        }
      }));
    });

    this.ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (err) {
        logger.warning(`[message] JSON malformato: ${raw}`);
        return;
      }

      if (msg.stream === 'authorization' && msg.data.status === 'authorized' ) {
          logger.info(`Autenticazione riuscita : ${msg.data.status}`);
          this.ws.send(JSON.stringify({
            action: "listen",
            data: {
              streams: ["trade_updates"]
            }
          }));
        return;
      }

      if (msg.stream === 'listening') {
        logger.info(`In ascolto sugli eventi`);
        return;
      }

      if (msg.event === 'trade_updates') {
        const event = msg.data.event;
        logger.trace(JSON.stringify(msg.data, null, 2));

        // Invio messaggio al router
        routeEvent(msg.data.event, msg.data);
      }   else {
        logger.warning('[connect] Altri tipi di eventi:', parsed);
      }
    });

    this.ws.on('error', (err) => {
      logger.error(`[connect] Errore WebSocket: ${err.message}`);
    });

    this.ws.on('close', () => {
      logger.warning(`[connect] WebSocket chiuso.`);
    });
  }

  getInfo() {
    return {
      module: MODULE_NAME,
      version: MODULE_VERSION,
      environment: this.isPaper ? 'PAPER' : 'LIVE',
      status: this.ws && this.ws.readyState === 1 ? 'connected' : 'disconnected'
    };
  }

  // da richiamare da server.js
  pause() {
    logger.warning(`[pause] Ricevuta richiesta di pausa, disconnessione in corso...`);
    if (this.ws) this.ws.close();
  }
}

module.exports = OrderListener;
