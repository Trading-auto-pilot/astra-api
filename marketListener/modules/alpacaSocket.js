const WebSocket = require('ws');
const EventEmitter = require('events');
const createLogger = require('../../shared/logger');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const MICROSERVICE = 'marketListener';
const MODULE_NAME = 'alpacaSocket';
const MODULE_VERSION = '3.1';

class AlpacaSocket extends EventEmitter {
  constructor(config) {
    super();
    this.symbolStrategyMap = config.symbolStrategyMap;
    this.processBar = config.processBar;

    this.orderActive = []; // simboli con ordini attivi
    this.retryDelay = config.alpacaRetryDelay;      // ms
    this.maxRetries = config.alpacaMaxRetray;       // (non ancora usato sotto; vedi TODO)
    this.retryCount = 0;

    this.messageQueue = [];
    this.processing = false;
    this.delayProcess = config.delayBetweenMessages || 500;

    //this.logLevel = process.env.LOG_LEVEL || 'info';
    this.logger = config.logger; //createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, this.logLevel);

    this.connectionStatus = 'NOT CONNECTED';
    this.alpacaWsUrl = config.alpacaMarketServer;

    this.shouldReconnect = false;
    this.reconnecting = false;

    this.ws = null;
    this._connectPromise = null;
    this._processorTimer = null;

    this._ensureQueueProcessor(); // un solo setInterval
  }
  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  _setStatus(newStatus) {
    this.connectionStatus = newStatus;
    this.emit('status', newStatus);   // <--- notifica i listener
  }

// ====== NUOVO: entry-point con retry ======
async start() {
  // abilita reconnessioni finché non chiami disconnect()
  this.shouldReconnect = true;

  // se è già in corso un loop di reconnessione, non avviarne un altro
  if (this.reconnecting) return;

  this.reconnecting = true;
  let attempt = 0;

  while (this.shouldReconnect) {
    try {
      this.logger.info(`[start] Tentativo connessione #${attempt}`);
      await this.connect();               // singolo tentativo -> authenticated oppure throw
      this.logger.info('[start] Connessione stabilita');
      this.reconnecting = false;
      return;                             // esci: la socket è su
    } catch (err) {
      this.logger.warning(`[start] Connessione fallita #${attempt}: ${err?.message || err}`);
      attempt++;
      await this._sleep(this.retryDelay || 5000);
      // continua il loop
    }
  }

  this.reconnecting = false;
}

// ====== utility per avviare il loop di retry dagli handler ======
_triggerReconnect(reason) {
  // evita più loop sovrapposti
  if (!this.shouldReconnect) return;
  if (this.reconnecting) return;

  // non attendere dentro l'handler, lascia che il loop parta fuori stack
  setTimeout(() => {
    // ignora eventuali errori non catturati qui
    this.start().catch(e => {
      this.logger.error(`[reconnect] errore nel loop start(): ${e?.message || e}`, { __opts:{skipBus:true} });
    });
  }, this.retryDelay || 5000);
}

  // ---------- getters / setters ----------
  getConnectionStatus() { return this.connectionStatus; }
  getLogLevel() { return this.logLevel; }
  setLogLevel(level) { this.logLevel = level; this.logger.setLevel(level); }
  getParams() {
    return {
      Url: this.alpacaWsUrl,
      delayBetweenMessages: this.delayProcess,
      messageQueued: this.messageQueue.length,
      connRetry: this.retryCount
    };
  }

  setActiveOrders(symbols) { this.orderActive = symbols; }
  getRetryDelay() { return this.retryDelay; }
  setRetryDelay(ms) { this.retryDelay = parseInt(ms) || 5000; }
  getMaxRetries() { return this.maxRetries; }
  setMaxRetries(count) { this.maxRetries = parseInt(count) || 50; }
  getRetryCount() { return this.retryCount; }
  setRetryCount(count) { this.retryCount = parseInt(count) || 0; }
  resetRetryCount() { this.retryCount = 0; }

  // ---------- public API ----------
  async disconnect() {
    this.logger.warning('[disconnect] Chiamata disconnessione da Alpaca.');
    this.shouldReconnect = false;
    this._teardownSocket();
    this.connectionStatus = 'CLOSED';
  }

  async connect() {
    // lock per evitare doppi connect e dare un'unica Promise a chi chiama
    if (this._connectPromise) return this._connectPromise;

    this.shouldReconnect = true; // abilita reconnect finché non si fa disconnect()
    this.connectionStatus = 'CONNECTING';

    this._connectPromise = new Promise((resolve, reject) => {
      // Crea socket nuovo; non risolvere su 'open', ma solo dopo autenticazione
      this.logger.info(`[connect] Connessione a: ${this.alpacaWsUrl}`);
      const ws = new WebSocket(this.alpacaWsUrl);
      this.ws = ws;

      const authTimeoutMs = 5000;
      const authTimeout = setTimeout(() => {
        //this.connectionStatus = 'NOT CONNECTED';
        this._setStatus("NOT CONNECTED");
        this.logger.error('[connect] Timeout autenticazione WebSocket');
        cleanup();
        try { ws.terminate(); } catch {}
        reject(new Error('Timeout autenticazione WebSocket'));
      }, authTimeoutMs);

      const cleanup = () => {
        try { ws.removeAllListeners('open'); } catch {}
        try { ws.removeAllListeners('message'); } catch {}
        try { ws.removeAllListeners('close'); } catch {}
        try { ws.removeAllListeners('error'); } catch {}
        try { ws.removeAllListeners('unexpected-response'); } catch {}
        clearTimeout(authTimeout);
        this._connectPromise = null;
      };

      ws.on('open', () => {
        this.logger.info('[connect] WebSocket connesso. Autenticazione in corso...');
        this.connectionStatus = 'AUTHENTICATING';
        try {
          ws.send(JSON.stringify({
            action: 'auth',
            key: process.env.APCA_API_KEY_ID,
            secret: process.env.APCA_API_SECRET_KEY
          }));
        } catch (e) {
          this.logger.error(`[connect] Errore invio auth: ${e.message}`);
          cleanup();
          try { ws.terminate(); } catch {}
          reject(e);
        }
      });

      ws.on('message', async (data) => {
        this.logger.trace(`[connect] messaggio ricevuto ${data}`);

        let messages;
        try {
          messages = JSON.parse(data);
        } catch (err) {
          this.logger.error('[connect] Errore parsing JSON:', err.message);
          return;
        }
        if (!Array.isArray(messages)) messages = [messages];

        for (const msg of messages) {
          if (msg.T === 'success' && msg.msg === 'authenticated') {
            // autenticato
            //this.connectionStatus = 'CONNECTED';
            this._setStatus("CONNECTED")
            const symbols = Object.keys(this.symbolStrategyMap || {});
            if (symbols.length) {
              ws.send(JSON.stringify({ action: 'subscribe', bars: symbols }));
              this.logger.info(`[connect] Sottoscritto ai simboli: ${symbols.join(', ')}`);
            } else {
              this.logger.warning('[connect] Nessun simbolo da sottoscrivere');
            }
            this.retryCount = 0;
            cleanup();
            resolve(true);
            return;
          }

          if (msg.T === 'b') {
            if (!this.orderActive.includes(msg.S)) {
              this.logger.trace(`[connect] messaggio T ricevuto, accodo per elaborazione processBar`);
              this.messageQueue.push(msg);
            } else {
              this.logger.trace('[connect] Candela non processata per ordine già attivo');
            }
          }
        }
      });

      ws.on('unexpected-response', (req, res) => {
        this.connectionStatus = 'UNEXPECTED ERROR';
        const code = res?.statusCode;
        const msg  = res?.statusMessage || '';
        this.logger.error(
          `[connect] Risposta inattesa durante handshake: ${code} ${msg} | url=${this.alpacaWsUrl} headers=${JSON.stringify(res?.headers||{})}`
        );

        // NON usare ws.terminate() qui: non è mai diventato WebSocket
        try { req?.destroy(); } catch {}

        // cleanup e retry fuori dallo stack corrente
        setImmediate(() => {
          cleanup(); // rimuove i listener e azzera _connectPromise
          if (this.shouldReconnect) this._triggerReconnect('unexpected-response');
        });

        // fallisci il tentativo di connect
        return reject(new Error(`Unexpected handshake response: ${code} ${msg}`));
      });


      ws.on('error', (err) => {
        this.connectionStatus = 'ERROR CONNECTION';
        this.logger.error(`[connect] Errore WebSocket: ${err?.message || ''}`);
        cleanup();
        try { ws.terminate(); } catch {}
        // fai fallire il tentativo corrente...
        // (chi chiama connect() lo .catch-a dentro start())
        // ...e avvia la riconnessione se previsto
        this._triggerReconnect('error');     // <--- AGGIUNTO
        reject(err || new Error('WebSocket error'));
      });

      ws.once('close', (code, reasonBuf) => {
        const reason = reasonBuf ? reasonBuf.toString() : '';
        this.logger.warning(`[connect] Connessione chiusa. Codice: ${code}, Motivo: ${reason}.`);
        cleanup();
        // se serve, avvia il loop di retry
        if (this.shouldReconnect) this._triggerReconnect('close');   // <--- AGGIUNTO
        reject(new Error(`Socket closed during connect (code ${code})`));
      });
    });

    // non catturare qui: chi chiama (o scheduleReconnect) gestirà il reject
    return this._connectPromise;
  }

  async scheduleReconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;

    let attempt = 0;
    while (this.shouldReconnect) {
      try {
        this.logger.info(`[reconnect] Tentativo ${attempt}`);
        await this.connect(); // ora connect non esce subito: aspetta authenticated
        this.logger.info('[reconnect] Connessione riuscita');
        this.reconnecting = false;
        return; // esci: siamo connessi
      } catch (err) {
        this.logger.warning(`[reconnect] Connessione fallita (tentativo ${attempt}): ${err.message || err}`);
        attempt++;
        await new Promise(res => setTimeout(res, this.retryDelay));
        // loop finché shouldReconnect rimane true
      }
    }
    this.reconnecting = false;
  }

  // ---------- internals ----------
  _ensureQueueProcessor() {
    if (this._processorTimer) return;
    this._processorTimer = setInterval(async () => {
      if (this.processing || this.messageQueue.length === 0) return;
      const msg = this.messageQueue.shift();
      this.processing = true;
      this.logger.trace(`[queue] Elaborazione messaggio T ${JSON.stringify(msg)}`);
      try {
        await this.processBar(msg);
      } catch (err) {
        this.logger.error('[queue] Errore in processBar:', err.message);
      } finally {
        this.processing = false;
      }
    }, this.delayProcess);
  }

  _teardownSocket() {
    // chiude il socket e rimuove listener
    const ws = this.ws;
    if (!ws) return;
    try {
      ws.removeAllListeners('open');
      ws.removeAllListeners('message');
      ws.removeAllListeners('close');
      ws.removeAllListeners('error');
      ws.removeAllListeners('unexpected-response');
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    } catch {}
    this.ws = null;
    //this.connectionStatus = 'NOT CONNECTED';
    this._setStatus("NOT CONNECTED")
  }
}

module.exports = AlpacaSocket;
