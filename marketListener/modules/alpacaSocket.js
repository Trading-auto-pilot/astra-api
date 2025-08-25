const WebSocket = require('ws');
const { createClient } = require('redis');
const EventEmitter = require('events');
const path = require('path');
const SymbolDedupQueue = require('./SymbolDedupQueue');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const MICROSERVICE = 'marketListener';
const MODULE_NAME = 'alpacaSocket';
const MODULE_VERSION = '3.1';

class AlpacaSocket extends EventEmitter {
  constructor(config) {
    super();
    this.messageQueue = new SymbolDedupQueue();
    this.symbolStrategyMap = config.symbolStrategyMap;
    this.processBar = config.processBar;

    // === Redis orderActive (fonte di verità) ===
    this.env = process.env.ENV || 'dev';
    this.redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.ACTIVE_SET = `${this.env}.orders.active.set`;
    this.EVENTS_CH = `${this.env}.orders.active.events.v1`;

    this.orderActiveSet = new Set();       // cache locale O(1)
    this.redis = createClient({ url: this.redisUrl });
    this.sub   = this.redis.duplicate();
    /********************************************* */

    this.retryDelay = config.alpacaRetryDelay;      // ms
    this.alpacaMaxRetry = config.alpacaMaxRetry;       // (non ancora usato sotto; vedi TODO)
    this.retryCount = 0;

    this.processing = false;

    this.logger = config.logger; 

    this.status = 'NOT CONNECTED';
    this.alpacaWsUrl = config.alpacaMarketServer;

    this.shouldReconnect = false;
    this.reconnecting = false;

    this.ws = null;
    this._connectPromise = null;
  }
  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  _setStatus(newStatus,  message='') {
    this.connectionStatus = { newStatus, message };
    this.emit('status', this.connectionStatus);   // <--- notifica i listener
  }

  _sendCandle(candle) {
    this.emit('candle', candle);   // <--- notifica i listener
  }

  // ====== NUOVO: entry-point con retry ======
  async start() {
    // abilita reconnessioni finché non chiami disconnect()
    this.shouldReconnect = true;

    // se è già in corso un loop di reconnessione, non avviarne un altro
    if (this.reconnecting) return;

    this.reconnecting = true;
    let attempt = 0;

    while (this.shouldReconnect  && attempt < (this.alpacaMaxRetry ?? Infinity)) {
      try {
        this.logger.info(`[start] Tentativo connessione #${attempt}`);
        await this.connect();               // singolo tentativo -> authenticated oppure throw
        this.logger.info('[start] Connessione stabilita');
        this.reconnecting = false;
        return;                             // esci: la socket è su
      } catch (err) {
        this.logger.warning(`[start] Connessione fallita #${attempt}: ${err?.message || err}`);
        attempt++;
        this.retryCount = attempt;
        await this._sleep(this.retryDelay || 5000);
        // continua il loop
      }
    }

    this.reconnecting = false;
  }

  // ====== utility per avviare il loop di retry dagli handler ======
  _triggerReconnect(reason) {
    if (!this.shouldReconnect || this.reconnecting) return;
    const delay = this.retryDelay || 5000;
    this.logger.warn(`[reconnect] scheduling in ${delay}ms (reason=${reason})`);
    setTimeout(() => this.start().catch(e => {
      this.logger.error(`[reconnect] loop error: ${e?.message || e}`);
    }), delay);
  }

  // ---------- getters / setters ----------
  getConnectionStatus() { return this.status; }
  getLogLevel() { return this.logLevel; }
  setLogLevel(level) { this.logLevel = level; this.logger.setLevel(level); }
  getParams() {
    return {
      Url: this.alpacaWsUrl,
      messageQueued: this.messageQueue.length, // usa getter della dedup queue
      connRetry: this.retryCount
    };
  }

  getRetryDelay() { return this.retryDelay; }
  setRetryDelay(ms) { this.retryDelay = parseInt(ms) || 5000; }
  getMaxRetries() { return this.alpacaMaxRetry; }
  setMaxRetries(count) { this.alpacaMaxRetry = parseInt(count) || 50; }
  getRetryCount() { return this.retryCount; }
  setRetryCount(count) { this.retryCount = parseInt(count) || 0; }
  resetRetryCount() { this.retryCount = 0; }

  // ---------- public API ----------
  async disconnect() {
    this.logger.warning('[disconnect] Chiamata disconnessione da Alpaca.');
    this._setStatus('DISCONNECTED','Disconnesso dal server');
    this.shouldReconnect = false;
    this._teardownSocket();
    this.status = 'CLOSED';
  }

  async connect() {
    // lock per evitare doppi connect e dare un'unica Promise a chi chiama
    if (this._connectPromise) return this._connectPromise;

    this.shouldReconnect = true; // abilita reconnect finché non si fa disconnect()
    this.status = 'CONNECTING';

    this._connectPromise = new Promise((resolve, reject) => {
      // Crea socket nuovo; non risolvere su 'open', ma solo dopo autenticazione
      this.logger.info(`[connect] Connessione a: ${this.alpacaWsUrl}`);
      const ws = new WebSocket(this.alpacaWsUrl);
      this.ws = ws;

      const authTimeoutMs = 5000;
      const authTimeout = setTimeout(() => {
        this._setStatus("NOT CONNECTED",'Timeout autenticazione WebSocket');
        this.logger.error('[connect] Timeout autenticazione WebSocket');
        fullCleanup();
        try { ws.terminate(); } catch {}
        reject(new Error('Timeout autenticazione WebSocket'));
      }, authTimeoutMs);

      const fullCleanup = () => {
        lightCleanup();
        try { ws.removeAllListeners('open'); } catch {}
        try { ws.removeAllListeners('message'); } catch {}
        try { ws.removeAllListeners('close'); } catch {}
        try { ws.removeAllListeners('error'); } catch {}
        try { ws.removeAllListeners('unexpected-response'); } catch {}
      };

      const lightCleanup = () => {
        clearTimeout(authTimeout);
        this._connectPromise = null; // sblocca futuri connect()
      };

      ws.on('open', () => {
        this.logger.info('[connect] WebSocket connesso. Autenticazione in corso...');
        this.status = 'AUTHENTICATING';
        this._setStatus("AUTHENTICATING",'WebSocket connesso. Autenticazione in corso...');
        try {
          ws.send(JSON.stringify({
            action: 'auth',
            key: process.env.APCA_API_KEY_ID,
            secret: process.env.APCA_API_SECRET_KEY
          }));
        } catch (e) {
          this.logger.error(`[connect] Errore invio auth: ${e.message}`);
          fullCleanup();
          try { ws.terminate(); } catch {}
          reject(e);
        }
      });

      ws.on('message', async (data) => {
        this.logger.trace(`[connect] messaggio ricevuto ${data}`);
        let messages;
        try {
          messages = JSON.parse(typeof data === 'string' ? data : data.toString());
        } catch (err) {
          this.logger.error('[connect] Errore parsing JSON:', err.message);
          return;
        }
        if (!Array.isArray(messages)) messages = [messages];

        for (const msg of messages) {
          if (msg.T === 'success' && msg.msg === 'authenticated') {
            this._setStatus("AUTHENTICATED",'Authentication succeed');
            const symbols = Object.keys(this.symbolStrategyMap || {});
            if (symbols.length) {
              ws.send(JSON.stringify({ action: 'subscribe', bars: symbols }));
              this.logger.info(`[connect] Sottoscritto ai simboli: ${symbols.join(', ')}`);
              this._setStatus("LISTENING",`Sottoscritto ai simboli: ${symbols.join(', ')}`);
            } else {
              this.logger.warning('[connect] Nessun simbolo da sottoscrivere');
              this._setStatus("LISTENING",`Nessuna sottoscrizione attiva`);
            }
            this.retryCount = 0;
            lightCleanup();
            resolve(true);
            return;
          }

          if (msg.T === 'b') {
            if (!this.isOrderActive(msg.S)) {
              this.logger.trace('[connect] Bar ricevuto, enqueue dedup per processBar');
              this.messageQueue.push(msg);    // SymbolDedupQueue, non array
              this._kickProcessor();
              this._sendCandle(msg);
            } else {
              this.logger.trace('[connect] Candela non processata: ordine già attivo');
            }
          }

        }
      });

      ws.on('unexpected-response', (req, res) => {
        this.status = 'UNEXPECTED ERROR';
        const code = res?.statusCode;
        const msg  = res?.statusMessage || '';
        this.logger.error(
          `[connect] Risposta inattesa durante handshake: ${code} ${msg} | url=${this.alpacaWsUrl} headers=${JSON.stringify(res?.headers||{})}`
        );

        // NON usare ws.terminate() qui: non è mai diventato WebSocket
        try { req?.destroy(); } catch {}

        // cleanup e retry fuori dallo stack corrente
        setImmediate(() => {
          fullCleanup(); // rimuove i listener e azzera _connectPromise
          if (this.shouldReconnect) this._triggerReconnect('unexpected-response');
        });

        // fallisci il tentativo di connect
        return reject(new Error(`Unexpected handshake response: ${code} ${msg}`));
      });


      ws.on('error', (err) => {
        this.status = 'ERROR CONNECTION';
        this.logger.error(`[connect] Errore WebSocket: ${err?.message || ''}`);
        fullCleanup();
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
        this._setStatus("CLOSED",`Connessione chiusa. Codice: ${code}, Motivo: ${reason}`);
        fullCleanup();
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

  _kickProcessor() {
    if (this.processing) return;
    this.processing = true;
    setImmediate(async () => {
      try {
        let msg;
        while ((msg = this.messageQueue.shift())) {
          try {
            await this.processBar(msg);
          } catch (err) {
            this.logger.error(`[processLoop] processBar failed for ${msg.S}: ${err.message}`);
          }
          this._sendCandle(msg);
        }
      } catch (err) {
        this.logger.error(`[processLoop] ${err.message}`);
      } finally {
        this.processing = false;
        if (this.messageQueue.length) this._kickProcessor();
      }
    });
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
    this._setStatus("NOT CONNECTED",'');
  }

  async initOrderActiveWatcher() {
    await this.redis.connect();
    await this.sub.connect();

    // bootstrap stato corrente
    const members = await this.redis.sMembers(this.ACTIVE_SET);
    this.orderActiveSet = new Set(members);
    this.logger.info(`[orderActive] bootstrap: ${members.length} simboli attivi`);

    // eventi incrementali
    await this.sub.subscribe(this.EVENTS_CH, (raw) => {
      try {
        const msg = JSON.parse(raw);
        const sym = msg?.symbol;
        if (!sym || typeof sym !== 'string') return;

        if (msg.action === 'add') {
          this.orderActiveSet.add(sym);
          this.logger.trace(`[orderActive] add ${sym}`);
        } else if (msg.action === 'remove') {
          this.orderActiveSet.delete(sym);
          this.logger.trace(`[orderActive] remove ${sym}`);
        }
      } catch (e) {
        this.logger.error(`[orderActive][subscribe] ${e.message}`);
      }
    });

    // reconcile periodico (anti-perdita-eventi)
    this._reconcileTimer = setInterval(async () => {
      try {
        const freshArr = await this.redis.sMembers(this.ACTIVE_SET);
        const fresh = new Set(freshArr);
        let changed = fresh.size !== this.orderActiveSet.size;
        if (!changed) {
          for (const s of fresh) { if (!this.orderActiveSet.has(s)) { changed = true; break; } }
        }
        if (changed) {
          this.orderActiveSet = fresh;
          this.logger.debug('[orderActive] reconciled');
        }
      } catch (e) {
        this.logger.error(`[orderActive][reconcile] ${e.message}`);
      }
    }, 30_000);
  }

  async closeOrderActiveWatcher() {
    clearInterval(this._reconcileTimer);
    try { await this.sub.unsubscribe(this.EVENTS_CH); } catch {}
    try { await this.sub.disconnect(); } catch {}
    try { await this.redis.disconnect(); } catch {}
  }

  // helper O(1)
  isOrderActive(symbol) {
    return this.orderActiveSet.has(symbol);
  }


  updateCommunicationChannels(newConfig) {
    const requiredKeys = ['telemetry', 'tick', 'candle', 'logs'];

    // Validazione: tutte le chiavi richieste devono esistere
    for (const key of requiredKeys) {
      if (!newConfig[key] || typeof newConfig[key] !== 'object') {
        this.logger.error(`[updateCommunicationChannels] Config mancante o invalida per '${key}'`);
        throw new Error(`Invalid config: missing '${key}'`);
      }
      if (typeof newConfig[key].on !== 'boolean' || !newConfig[key].params) {
        this.logger.error(`[updateCommunicationChannels] Campo 'on' o 'params' invalido per '${key}'`);
        throw new Error(`Invalid config for '${key}'`);
      }
    }

    // Aggiorna configurazione interna
    this._communicationChannels = {
      telemetry : { ...newConfig.telemetry },
      tick      : { ...newConfig.tick },
      candle    : { ...newConfig.candle },
      logs      : { ...newConfig.logs }
    };

    this.logger.info(`[updateCommunicationChannels] Configurazione aggiornata con successo`);
    this.logger.log(`[updateCommunicationChannels] Nuova configurazione: ${JSON.stringify(this._communicationChannels)}`);

    // opzionale: notificare altri moduli via Redis Pub/Sub
    if (this.redisPublisher) {
      this.redisPublisher.publish('config.events.v1', JSON.stringify({
        type: 'communicationChannelsUpdated',
        ts: new Date().toISOString(),
        service: 'alpacaSocket',
        data: this._communicationChannels
      }));
    }

    return this._communicationChannels;
  }
}

module.exports = AlpacaSocket;
