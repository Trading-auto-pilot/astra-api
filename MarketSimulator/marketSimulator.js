const WebSocket = require('ws');
const axios = require('axios');
const { publishCommand } = require('../shared/redisPublisher');
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
      const res = await axios.get(`${this.dbManagerUrl}/setting/${key}`);
      this.settings[key] = res.data.value;
      logger.trace(`[loadSettings] ${key} = ${res.data.value}`);
    }

    for (const [key, value] of Object.entries(process.env)) {
      logger.trace(`Environment variable ${key}=${value}`);
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
        
              // Aggiorno posizioni 
              const ret = updatePositionFromCandle({ T: 'b', ...candle });

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

  async broadcastMessage(payload) {
    const ret = await this.updatePositionFromCandle(payload);
    const message = JSON.stringify(payload);
  
    this.wsClients.forEach(client => {
      if (client.readyState === 1) { // 1 = WebSocket.OPEN
        client.send(message);
      }
    });
  
    logger.log(`[broadcastMessage] Messaggio inviato a ${this.wsClients.length} client: ${message}`);
  }
  
  stopSimulation() {
    if (this.interval) {
      clearInterval(this.interval);
      logger.info(`[stopSimulation] Simulazione fermata`);
    }
  }

async  updatePositionFromCandle(candle) {
  const symbol = candle[0].S;
  const close = parseFloat(candle[0].c);

  logger.trace(`[updatePositionFromCandle] Aggiorno posizioni aperte con candela ${JSON.stringify(candle)}`);
  if (!symbol || isNaN(close)) {
    logger.warning('[updatePositionFromCandle] Candela non valida o incompleta');
    return { updated: false, reason: 'symbol o close mancanti' };
  }

  const allPositions = await axios.get(`${this.dbManagerUrl}/simul/positions`);

  const position = allPositions.data.find(pos => pos.symbol === symbol);

  if (!position) {
    logger.info(`[updatePositionFromCandle] Nessuna posizione attiva per ${symbol}`);
    return { updated: false, reason: 'nessuna posizione trovata' };
  }

  const qty = parseFloat(position.qty);
  const avg_entry_price = parseFloat(position.avg_entry_price);
  const cost_basis = parseFloat(position.cost_basis);
  const lastday_price = parseFloat(position.lastday_price);

  const market_value = qty * close;
  const unrealized_pl = (close - avg_entry_price) * qty;
  const unrealized_plpc = cost_basis !== 0 ? unrealized_pl / cost_basis : 0;
  const unrealized_intraday_pl = (close - lastday_price) * qty;
  const unrealized_intraday_plpc = lastday_price !== 0 ? (close - lastday_price) / lastday_price : 0;
  const change_today = unrealized_intraday_plpc;

  logger.trace(`[updatePositionFromCandle] qty:${qty} close:${close} market_value:${market_value} unrealized_pl:${unrealized_pl} unrealized_plpc:${unrealized_plpc}`);

  const updatedFields = {
    position_id: position.position_id,
    asset_id: position.asset_id,
    symbol: position.symbol,
    current_price: parseFloat(close.toFixed(2)),
    market_value: parseFloat(market_value.toFixed(2)),
    unrealized_pl: parseFloat(unrealized_pl.toFixed(2)),
    unrealized_plpc: parseFloat(unrealized_plpc.toFixed(6)),
    unrealized_intraday_pl: parseFloat(unrealized_intraday_pl.toFixed(2)),
    unrealized_intraday_plpc: parseFloat(unrealized_intraday_plpc.toFixed(6)),
    change_today: parseFloat(change_today.toFixed(6))
  };

  logger.trace(`[updatePositionFromCandle] updatedFields:${JSON.stringify(updatedFields)}`);

  
  await axios.put(`${this.dbManagerUrl}/simul/positions`,updatedFields);
  logger.info(`[updatePositionFromCandle] Posizione ${symbol} aggiornata con candela`);
  
  // Inviare messaggio si websocket channel command : loadActivePosition
  await publishCommand({ action: 'loadActivePosition' });

  return { updated: true, symbol, updatedFields };
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
