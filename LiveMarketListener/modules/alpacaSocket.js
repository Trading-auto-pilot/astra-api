const WebSocket = require('ws');
const createLogger = require('../../shared/logger');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const MICROSERVICE = 'LiveMarketListener';
const MODULE_NAME = 'alpacaSocket';
const MODULE_VERSION = '2.0';

class AlpacaSocket {
  constructor(settings, symbolStrategyMap, processBar) {
    this.settings = settings;
    this.symbolStrategyMap = symbolStrategyMap;
    this.processBar = processBar;
    this.orderActive = []; // Array dei simboli con ordini attivi
    this.retryDelay = 5000; // ms
    this.maxRetries = 10;
    this.retryCount = 0;
    this.messageQueue = [];
    this.processing = false;
    this.delayProcess = this.settings('PROCESS_DELAY_BETWEEN_MESSAGES') || 500;
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, this.logLevel);
    this.connectionStatus="NOT CONNECTED";
    this.alpacaWsUrl = this.settings([`ALPACA-${process.env.ENV_MARKET}-MARKET`])+"/"+process.env.FEED
    this.shouldReconnect = false;
    this.reconnecting = false;
  }

    getConnectionStatus(){
        return this.connectionStatus;
    }

    getLogLevel(){
        return this.logLevel;
    }

    setLogLevel(level) {
        this.logLevel=level;
        this.logger.setLevel(level);
    }

    getParams() {
      return ({
        Url : this.alpacaWsUrl,
        delayBetweenMessages : this.delayProcess,
        messageQueued : this.messageQueue.length,
        connRetry : this.retryCount
      })
    }

  async disconnect(){
    this.logger.warning('[disconnect] Chiamata disconnessione da Alpaca.');
    this.shouldReconnect = false;
    this.ws.terminate();
  }

  async connect() {
    if (this.reconnecting) {
      this.logger.warning('[connect] Tentativo di connessione ignorato: già in fase di riconnessione.');
      return;
    }
    this.logger.log('[connect] Entrata in connect() this.reconnecting '+this.reconnecting);

    return new Promise((resolve, reject) => {
      // const baseUrl = this.settings([`ALPACA-${process.env.ENV_MARKET}-MARKET`]);
      // const wsUrl = `${baseUrl}/${process.env.FEED}`;
      this.logger.info(`[connect] Connessione a: ${this.alpacaWsUrl}`);

      this.ws = new WebSocket(this.alpacaWsUrl);
      this.ws.removeAllListeners('close');
      this.ws.removeAllListeners('error');
      this.ws.removeAllListeners('open');

      const authTimeout = setTimeout(() => {
        reject(new Error('Timeout autenticazione WebSocket'));
        this.connectionStatus="NOT CONNECTED";
        this.ws.terminate(); // forza chiusura se non arriva risposta
      }, 5000); // timeout 5s 
 
      // Apro la connessione websocket
      this.ws.on('open', () => {
        this.logger.info(`[connect] WebSocket connesso. Autenticazione in corso...`);
        this.connectionStatus="AUTHENTICATING ... ";
        resolve(true);
        this.ws.send(JSON.stringify({
          action: 'auth',
          key: process.env.APCA_API_KEY_ID,
          secret: process.env.APCA_API_SECRET_KEY
        })); 
      });

      // Gestione Sincrona dei messaggi
      setInterval(async () => {
        if (this.processing || this.messageQueue.length === 0) return;
        const msg = this.messageQueue.shift();
        this.processing = true;
        this.logger.trace(`[connect] Elaborazione messaggio T ricevuto ${JSON.stringify(msg)} `);
        try {
          await this.processBar(msg);
        } catch (err) {
          this.logger.error('[queue] Errore in processBar:', err.message);
        } finally {
          this.processing = false;
        }
      }, this.delayProcess || 500);

      // Connessione su websocket, autenticazione e sottoscrizione
      this.ws.on('message', async (data) => {
        this.logger.trace(`[connect] messaggio ricevuto ${data}`);

        let messages;
        try {
          messages = JSON.parse(data);
        } catch (err) {
          this.logger.error('[connect] Errore parsing JSON:', err.message);
          return;
        }

        // Se il messaggio è un singolo oggetto, lo convertiamo in array per uniformità
        if (!Array.isArray(messages)) messages = [messages];

        for (const msg of messages) {

          if (msg.T === 'b' && !this.orderActive.includes(msg.S)) {
            this.logger.trace(`[connect] messaggio T ricevuto ${data} accodo per elaborazione processBar`);
            this.messageQueue.push(msg);
            //await this.processBar(msg);
            //await new Promise(resolve => setTimeout(resolve, this.delayProcess)); 
          } else if (msg.T === 'b') {
            this.logger.trace(`[connect] Candela non processata per ordine già attivo`);
          } else if (msg.T === 'success' && msg.msg === 'authenticated') {
              this.logger.info('[connect] Autenticato. Passo alla sottoscrizione dei simboli');
              this.connectionStatus="CONNECTED";
              const symbols = Object.keys(this.symbolStrategyMap);
              this.ws.send(JSON.stringify({ action: 'subscribe', bars: symbols }));
              this.logger.info(`[connect] Sottoscritto ai simboli: ${symbols.join(', ')}`);
              this.retryCount = 0; // reset
              clearTimeout(authTimeout);
              resolve();
          }
        }
      });

      this.ws.once('close', async (code, reason) => {
        this.logger.warning(`[connect] Connessione chiusa. Codice: ${code}, Motivo: ${reason.toString()}.  Tentativo di riconnessione in ${this.retryDelay / 1000}s`);
        this.connectionStatus="CLOSING";

        if(code === 1006)
          this.shouldReconnect=true;

        if (this.shouldReconnect) {
          await this.scheduleReconnect();
        } else {
          this.logger.info('[connect] Connessione chiusa manualmente, nessuna riconnessione');
          this.connectionStatus="CLOSED";
        }
      });

      this.ws.on('unexpected-response', (req, res) => {
        this.connectionStatus="UNEXPECTED ERROR";
        this.logger.error(`[client] Risposta inattesa durante handshake: ${res.statusCode}`);
        this.shouldReconnect = true;
      });


      this.ws.on('error', async (err) => {
        this.connectionStatus="ERROR CONNECTION";
        this.logger.error(`[connect] Errore WebSocket: ${err.message}`);
        this.shouldReconnect = true;
        // Qui in futuro si potrà pubblicare un messaggio su Redis per notificare l'errore
        clearTimeout(authTimeout);
        // reject(err);
        //await this.scheduleReconnect();
      });
    })
  }

  async scheduleReconnect() {
    if (this.reconnecting) return;

    this.reconnecting = true;

    let attempt=0;
    while (true) {
      try {
        this.logger.info(`[reconnect] Tentativo ${attempt}`);
        await this.connect(); 
        this.logger.info('[reconnect] Connessione riuscita');
        this.reconnecting = false;
        break; 
      } catch (err) {
        this.logger.warning(`[reconnect] Connessione fallita (tentativo ${attempt}): ${err.message}`);
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
