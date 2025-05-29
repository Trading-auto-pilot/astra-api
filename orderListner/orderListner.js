// orderListener/OrderListener.js
const WebSocket = require('ws');
const axios = require('axios');
const routeEvent = require('./router');
const createLogger = require('../shared/logger');

const MODULE_NAME = 'OrderListener';
const MODULE_VERSION = '1.2';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL);

class OrderListener {
  constructor() {
    this.ws = null;
    this.settings = {};
    this.dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
    this.liveMarketListnerUrl = process.env.LIVEMARKETMANAGER_URL || 'http://localhost:3012';
    this.timeout = 10000;
    this.AlpacaEnv=null;
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
      'ALPACA-PAPER-TRADING',
      'ALPACA-LIVE-TRADING',
      'ALPACA-LOCAL-TRADING',
      'ALPACA-DEV-TRADING',
      'ALPACA-PAPER-BASE',
      'ALPACA-LIVE-BASE',
      'ALPACA-LOCAL-BASE',
      'ALPACA-DEV-BASE',
      'ALPACA-API-TIMEOUT'
    ];

    for (const key of keys) {
      try {
        const res = await axios.get(`${this.dbManagerUrl}/settings/${key}`);
        this.settings[key] = res.data;
        logger.trace(`[loadSettings] ${key} = ${res.data}`);
      } catch (err) {
        logger.error(`[loadSettings] Errore nel recupero di ${key}: ${err.message}`);
        throw err;
      }
    }
    this.AlpacaEnv = this.settings['ALPACA-'+process.env.ENV_ORDERS+'-BASE'];
    logger.trace(`[loadSettings] this.AlpacaEnv = ${this.AlpacaEnv}`);

    for (const [key, value] of Object.entries(process.env)) {
      logger.trace(`Environment variable ${key}=${value}`);
    }

    this.timeout = parseInt(this.settings['ALPACA-API-TIMEOUT']) || 10000;
  }

connect(retry = true) {
  const RECONNECT_DELAY_MS = 5000;
  const wsUrl = this.settings['ALPACA-' + process.env.ENV_TRADING + '-TRADING'];

  logger.info(`[${MODULE_NAME}][connect] Connessione al WebSocket: ${wsUrl}`);

  this.ws = new WebSocket(wsUrl);

  this.ws.on('open', () => {
    logger.info(`[${MODULE_NAME}][connect] WebSocket connesso. Autenticazione in corso...`);

    this.ws.send(JSON.stringify({
      action: 'auth',
      data: {
        key_id: process.env.APCA_API_KEY_ID,
        secret_key: process.env.APCA_API_SECRET_KEY
      }
    }));
  });

  this.ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
      logger.trace(`[message] ricevuto: ${JSON.stringify(msg)}`);
    } catch (err) {
      logger.warning(`[message] JSON malformato: ${raw}`);
      return;
    }

    if (msg.stream === 'authorization' && msg.data.status === 'authorized') {
      logger.info(`[auth] Autenticazione riuscita`);
      this.ws.send(JSON.stringify({
        action: 'listen',
        data: { streams: ['trade_updates'] }
      }));
      return;
    }

    if (msg.stream === 'listening') {
      logger.info(`[connect] In ascolto sugli eventi`);
      return;
    }

    if (msg.stream === 'trade_updates') {
      logger.trace(`[update] Evento trade: ${JSON.stringify(msg.data, null, 2)}`);
      // Processo il messaggio
      routeEvent(msg.data.event, msg.data, this.AlpacaEnv);
      // Nel caso sia un messaggio relativo a una chiusura di una posizione DELETE positions, lo giro al liveMarketListner
      //await axios.post(`${this.liveMarketListnerUrl}/addOrdertoOrderTable`,msg.data.order); 

      // Richiamo aggiornaCapitaliImpegnati di LiveMarketListner 
    } else {
      logger.warning(`[connect] Evento sconosciuto: ${JSON.stringify(msg)}`);
    }
  });

  this.ws.on('error', (err) => {
    logger.error(`[connect] Errore WebSocket: ${err.message}`);
    // chiude forzatamente in caso di errore persistente
    if (this.ws.readyState !== WebSocket.CLOSED && this.ws.readyState !== WebSocket.CLOSING) {
      this.ws.terminate?.();
    }
  });

  this.ws.on('close', () => {
    logger.warning(`[connect] WebSocket chiuso.`);
    if (retry) {
      logger.info(`[connect] Tentativo di riconnessione in ${RECONNECT_DELAY_MS / 1000}s...`);
      setTimeout(() => this.connect(true), RECONNECT_DELAY_MS);
    }
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
