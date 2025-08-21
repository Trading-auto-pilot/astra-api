// modules/RedisPubSubManager.js
const { createClient } = require('redis');
const createLogger = require('../../shared/logger');
const EventEmitter = require('events');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const MICROSERVICE = 'LiveMarketListener';
const MODULE_NAME = 'redisPubSubManager';
const MODULE_VERSION = '2.0';



class RedisPubSubManager extends EventEmitter {
  constructor({ url = process.env.REDIS_URL || 'process.env. redis://localhost:6379', retryDelay = 5000, maxRetries = 10 } = {}) {
    super();
    this.url = url;
    this.retryDelay = retryDelay;
    this.maxRetries = maxRetries;
    this.retryCount = 0;
    this.subscriber = null;
    this.publisher = null;
    this.connected = false;
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION,this.logLevel );
    this.connectionStatus = "NOT CONNECTED";
  }

  getConnectionStatus() {
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
        Url : this.url,
        retryDelay : this.retryDelay,
        maxRetries : this.maxRetries,
        retryCount : this.retryCount,
        subscriber : this.subscriber.length,
        subscriber : this.subscriber.length
      })
    }


  async init() {
    await this._initSubscriber();
    await this._initPublisher();
  }

  async _initSubscriber() {
    this.subscriber = createClient({ url: this.url });
    this._handleEvents(this.subscriber, 'subscriber');
    await this._connectWithRetry(this.subscriber, 'subscriber');
  }

  async _initPublisher() {
    this.publisher = createClient({ url: this.url });
    this._handleEvents(this.publisher, 'publisher');
    await this._connectWithRetry(this.publisher, 'publisher');
  }

  _handleEvents(client, label) {
    client.on('connect', () => this.logger.info(`[${label}] Connessione a Redis in corso...`));
    client.on('ready', () => {
      this.logger.info(`[${label}] ✅ Connessione a Redis pronta`);
      this.connectionStatus = "CONNECTED";
      this.retryCount = 0;
      this.connected = true;
    });
    client.on('end', () => {
      this.logger.warning(`[${label}] ❌ Connessione Redis terminata`);
      this.connectionStatus = "NOT CONNECTED";
    });
    client.on('error', err => {
      this.logger.error(`[${label}] Errore Redis: ${err.message}`);
      this.connectionStatus = "ERROR";
    });
  }

  async _connectWithRetry(client, label) {
    while (this.retryCount < this.maxRetries) {
      try {
        await client.connect();
        return;
      } catch (err) {
        this.retryCount++;
        this.logger.warning(`[${label}] Tentativo ${this.retryCount}/${this.maxRetries} fallito: ${err.message}`);
        await new Promise(res => setTimeout(res, this.retryDelay));
      }
    }
    this.logger.error(`[${label}] Raggiunto numero massimo di tentativi (${this.maxRetries})`);
    // TODO: notificare errori al sistema esterno
  }

  async subscribe(channel, handler) {
    if (!this.subscriber) return;
    await this.subscriber.subscribe(channel, async (message) => {
      try {
        const data = JSON.parse(message);
        await handler(data);
      } catch (err) {
        this.logger.error(`[subscribe][${channel}] Errore parsing o gestione messaggio: ${err.message}`);
      }
    });
    this.logger.info(`[subscribe] Sottoscritto al canale ${channel}`); 
  }

  async publish(channel, payload) {
    if (!this.publisher) return;
    try {
      await this.publisher.publish(channel, JSON.stringify(payload));
      this.logger.trace(`[publish] Messaggio pubblicato su ${channel}`);
    } catch (err) {
      this.logger.error(`[publish] Errore pubblicazione su ${channel}: ${err.message}`);
    }
  }

  async close() {
    if (this.subscriber) await this.subscriber.quit();
    if (this.publisher) await this.publisher.quit();
    this.logger.info(`[close] Connessioni Redis chiuse`);
  }
}

module.exports = RedisPubSubManager;
