const WebSocket = require('ws');
const createLogger = require('../../shared/logger');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const MICROSERVICE = 'LiveMarketListener';
const MODULE_NAME = 'alpacaSocket';
const MODULE_VERSION = '2.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');
 

class AlpacaSocket {
  constructor(settings, symbolStrategyMap, processBar) {
    this.settings = settings;
    this.symbolStrategyMap = symbolStrategyMap;
    this.processBar = processBar;
    this.orderActive = []; // Array dei simboli con ordini attivi
    this.retryDelay = 5000; // ms
    this.maxRetries = 10;
    this.retryCount = 0;
  }

  async connect() {
    const baseUrl = this.settings([`ALPACA-${process.env.ENV_MARKET}-MARKET`]);
    const wsUrl = `${baseUrl}/${process.env.FEED}`;
    logger.info(`[connect] Connessione a: ${wsUrl}`);

    this.ws = new WebSocket(wsUrl);

    // Apro la connessione websocket
    this.ws.on('open', () => {
      logger.info(`[connect] WebSocket connesso. Autenticazione in corso...`);
      this.ws.send(JSON.stringify({
        action: 'auth',
        key: process.env.APCA_API_KEY_ID,
        secret: process.env.APCA_API_SECRET_KEY
      }));
    });

    // Connessione su websocket, autenticazione e sottoscrizione
    this.ws.on('message', async (data) => {
      logger.trace(`[connect] messaggio ricevuto ${data}`);

      let messages;
      try {
        messages = JSON.parse(data);
      } catch (err) {
        logger.error('[connect] Errore parsing JSON:', err.message);
        return;
      }

      // Se il messaggio è un singolo oggetto, lo convertiamo in array per uniformità
      if (!Array.isArray(messages)) messages = [messages];

      for (const msg of messages) {
        if (msg.T === 'success' && msg.msg === 'authenticated') {
          logger.info('[connect] Autenticato. Passo alla sottoscrizione dei simboli');
          const symbols = Object.keys(this.symbolStrategyMap);
          this.ws.send(JSON.stringify({ action: 'subscribe', bars: symbols }));
          logger.info(`[connect] Sottoscritto ai simboli: ${symbols.join(', ')}`);
          this.retryCount = 0; // reset
        }

        if (msg.T === 'b' && !this.orderActive.includes(msg.S)) {
          await this.processBar(msg);
        } else if (msg.T === 'b') {
          logger.trace(`[connect] Candela non processata per ordine già attivo`);
        }
      }
    });


    this.ws.on('close', () => {
      logger.warning(`[connect] Connessione chiusa. Tentativo di riconnessione in ${this.retryDelay / 1000}s`);
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      logger.error(`[connect] Errore WebSocket: ${err.message}`);
      // Qui in futuro si potrà pubblicare un messaggio su Redis per notificare l'errore
      this.scheduleReconnect();
    });
  }

  async scheduleReconnect() {
    let attempt=0;
    while (true) {
      try {
        logger.info(`[reconnect] Tentativo ${attempt}`);
        await this.connect(); // deve essere async
        logger.info('[reconnect] Connessione riuscita');
        break; // esce se la connessione ha successo
      } catch (err) {
        logger.warn(`[reconnect] Connessione fallita (tentativo ${attempt}): ${err.message}`);
        attempt++;
        await new Promise(res => setTimeout(res, this.retryDelay));
      }
    }
  }

  setActiveOrders(symbols) {
    this.orderActive = symbols;
  }


  // GETTER E SETTER PER PARAMETRI DI RICONNESSIONE
    // Getter e Setter per retryDelay
    getRetryDelay() {
      return this.retryDelay;
    }
    setRetryDelay(ms) {
      this.retryDelay = parseInt(ms) || 5000;
    }

    // Getter e Setter per maxRetries
    getMaxRetries() {
      return this.maxRetries;
    }
    setMaxRetries(count) {
      this.maxRetries = parseInt(count) || 50;
    }

    // Getter e Setter per retryCount
    getRetryCount() {
    return this.retryCount;
    }
    setRetryCount(count) {
      this.retryCount = parseInt(count) || 0;
    }
    resetRetryCount() {
      this.retryCount = 0;
    }

}

module.exports = AlpacaSocket;
