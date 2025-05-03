// orderListener/OrderListener.js
const WebSocket = require('ws');
const axios = require('axios');
const createLogger = require('../shared/logger');

const MODULE_NAME = 'OrderListener';
const MODULE_VERSION = '1.0';
const logger = createLogger(MODULE_NAME);

class OrderListener {
  constructor() {
    this.ws = null;
    this.settings = {};
    this.dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
    this.env = process.env.ENVIRONMENT;
    this.isPaper = this.env === 'PAPER' ? true : this.env === 'LIVE' ? false : null;
    this.timeout = 10000;
  }

  async init() {
    logger.info(`[init] Inizializzazione...`);

    if (this.isPaper === null) {
        logger.warning(`[init] ENVIRONMENT non valido o mancante: "${this.env}". Valori accettati: PAPER, LIVE`);
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
      'ALPACA-WSS-PAPER-STREAM-BASE',
      'ALPACA-WSS-STREAM-BASE',
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

    this.timeout = parseInt(this.settings['ALPACA-API-TIMEOUT']) || 10000;
  }

  connect() {
    const wsUrl = this.isPaper ? this.settings['ALPACA-WSS-PAPER-STREAM-BASE'] : this.settings['ALPACA-WSS-STREAM-BASE'];
    logger.info(`[${MODULE_NAME}][connect] Connessione al WebSocket: ${wsUrl}`);

    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      logger.info(`[${MODULE_NAME}][connect] WebSocket connesso. Autenticazione in corso...`);

      this.ws.send(JSON.stringify({
        action: 'authenticate',
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
        logger.warn(`[message] JSON malformato: ${raw}`);
        return;
      }

      if (msg.stream === 'authorization') {
        logger.info(`Autenticazione: ${msg.data.status}`);
        return;
      }

      if (msg.stream === 'listening') {
        logger.info(`In ascolto sugli eventi`);
        return;
      }

      if (msg.stream === 'trade_updates') {
        const event = msg.data.event;
        logger.log(`Evento ordine: ${event}`);
        logger.trace(JSON.stringify(msg.data, null, 2));

        // TODO: qui possiamo inviare al DBManager, Alerting, ecc.
      }
    });

    this.ws.on('error', (err) => {
      logger.error(`[connect] Errore WebSocket: ${err.message}`);
    });

    this.ws.on('close', () => {
      logger.warn(`[connect] WebSocket chiuso.`);
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
    logger.warn(`[${MODULE_NAME}][pause] Ricevuta richiesta di pausa, disconnessione in corso...`);
    if (this.ws) this.ws.close();
  }
}

module.exports = OrderListener;
