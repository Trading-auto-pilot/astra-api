const WebSocket = require('ws');
const axios = require('axios');
const createLogger = require('../shared/logger');

const MODULE_NAME = 'MarketSimulator';
const MODULE_VERSION = '1.0';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL || 'log');

class MarketSimulator {
  constructor() {
    this.settings = {};
    this.wsClients = [];
    this.dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
    this.cacheManagerUrl = process.env.CACHEMANAGER_URL || 'http://localhost:3006';
    this.interval = null;

    // Log delle variabili definite nell'istanza
    for (const key of Object.keys(this)) {
        // Esclude i metodi (funzioni)
        if (typeof this[key] !== 'function') {
        logger.trace(`[init] Variabile ${key} =`, this[key]);  
      }
    }
  }

  async loadSettings() {
    logger.info(`[loadSettings] Caricamento configurazione da DBManager...`);
    const keys = ['STREAM-SIMULATION-DELAY'];
    for (const key of keys) {
      const res = await axios.get(`${this.dbManagerUrl}/getSetting/${key}`);
      this.settings[key] = res.data.value;
      logger.trace(`[loadSettings] ${key} = ${res.data.value}`);
    }
  }

  attachWebSocketServer(server) {
    const path = '/v2/iex';
    this.wss = new WebSocket.Server({ server, path });
    logger.info(`[WebSocket] WebSocket server avviato su path: ${path}`);

    this.wss.on('connection', (ws) => {
      logger.info(`[WebSocket] Nuovo client connesso`);
      this.wsClients.push(ws);

      ws.on('close', () => {
        this.wsClients = this.wsClients.filter(c => c !== ws);
        logger.info(`[WebSocket] Client disconnesso`);
      });

      ws.on('message', (message) => {
        try {
          const msg = JSON.parse(message);
      
          if (msg.action === 'auth') {
            logger.info(`[WebSocket] Autenticazione richiesta da client con key: ${msg.key}`);
      
            // Simula autenticazione
            ws.isAuthenticated = true;
            ws.subscribedSymbols = [];
            ws.send(JSON.stringify([{ T: 'success', msg: 'authenticated' }]));
      
          } else if (msg.action === 'subscribe') {
            if (!ws.isAuthenticated) {
              logger.warning(`[WebSocket] Tentata sottoscrizione senza autenticazione`);
              ws.send(JSON.stringify([{ T: 'error', msg: 'not authenticated' }]));
              return;
            }
      
            if (Array.isArray(msg.bars)) {
              ws.subscribedSymbols = msg.bars;
              logger.info(`[WebSocket] Sottoscritto ai simboli: ${msg.bars.join(', ')}`);
              ws.send(JSON.stringify([{ T: 'subscription', bars: msg.bars }]));
            }
      
          } else {
            logger.warning(`[WebSocket] Azione non riconosciuta: ${msg.action}`);
          }
      
        } catch (err) {
          logger.error(`[WebSocket] Errore parsing messaggio: ${err.message}`);
        }
      });

    });
  }

  async startSimulation(startDate, endDate, tf = '15Min') {

    for (const ws of this.wsClients) {
        if (!ws.isAuthenticated || !ws.subscribedSymbols || ws.subscribedSymbols.length === 0) {
          logger.warning('[startSimulation] Client non autenticato o senza simboli sottoscritti');
          continue;  
        }

        for (const symbol of ws.subscribedSymbols) {
            logger.log(`[startSimulation] Simulazione per ${symbol} da ${startDate} a ${endDate} con TF ${tf}`);
            await this.loadSettings();
        
            const res = await axios.get(`${this.cacheManagerUrl}/candles`, {
              params: {
                symbol,
                startDate,
                endDate,
                tf
              }
            });
        
            const candles = res.data;
            if (!Array.isArray(candles) || candles.length === 0) {
              logger.warning(`[startSimulation] Nessuna candela trovata`);
              return;
            }
        
            const delay = parseInt(this.settings['STREAM-SIMULATION-DELAY']) * 1000 || 1000;
            let index = 0;
        
            this.interval = setInterval(() => {
              if (index >= candles.length) {
                logger.info(`[startSimulation] Fine simulazione`);
                clearInterval(this.interval);
                return;
              }
        
              const candle = candles[index++];
              const payload = JSON.stringify({ T: 'b', ...candle });
        
              this.wsClients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(payload);
                }
              });
        
              logger.trace(`[startSimulation] Inviata candela: ${payload}`);
            }, delay);
        }
    }


  }

  stopSimulation() {
    if (this.interval) {
      clearInterval(this.interval);
      logger.info(`[stopSimulation] Simulazione fermata`);
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

module.exports = MarketSimulator;
