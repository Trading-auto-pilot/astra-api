const { asBool, asInt } = require('../../shared/helpers');

class StateManager {
  constructor(env) {
    // Alpaca WS endpoint + feed
    this._alpacaMarketServer = process.env.ALPACA_MARKET_URL || 'ws://localhost:3003/v2'; // es. 'wss://stream.data.alpaca.markets/v2'
    this._feed               = process.env.FEED || 'iex';

    // Parametri retry WS Alpaca
    this._alpacaRetryDelay = asInt(process.env.ALPACA_WSS_RETRAY_DELAY, 5000);
    this._alpacaMaxRetry  = asInt(process.env.ALPACA_WSS_MAX_RETRY, 10);

    // Flags / intervalli BUS (usa asBool/asInt)
    this._msgTelemetryOn        = asBool(process.env.MSG_TELEMETRY, true);
    this._msgTelemetryIntervals = asInt(process.env.MSG_TELEMETRY_INTERVALS, 500);

    this._msgMetricsOn             = asBool(process.env.MSG_METRICS, true);
    this._msgMetricsIntervals      = asInt(process.env.MSG_METRICS_INTERVALS, 500);

    this._msgCandleOn           = asBool(process.env.MSG_CANDLE, true);
    this._msgCandleIntervals    = asInt(process.env.MSG_CANDLE_INTERVALS, 500);

    this._msgLogsOn             = asBool(process.env.MSG_LOGS, true);
    this._msgLogsIntervals      = asInt(process.env.MSG_LOGS_INTERVALS, 500);

    // Stato modulo
    this._symbolStrategyMap = [];
    this._moduleActive = true;
    

    // Abilitazione canali BUS
    this._communicationChannels = {
      telemetry : { on: this._msgTelemetryOn, params : { intervalsMs : this._msgTelemetryIntervals }},
      metrics      : { on: this._msgMetricsOn,      params : { intervalsMs : this._msgMetricsIntervals }},
      candle    : { on: this._msgCandleOn,    params : { intervalsMs : this._msgCandleIntervals }},
      logs      : { on: this._msgLogsOn,      params : { intervalsMs : this._msgLogsIntervals }}
    };

    // Logs
    this._logLevel = process.env.LOG_LEVEL || 'info';
    this._logger = null;        // il logger viene impostato successivamente

  }
  set logger(l) {this._logger = l;}

  // Rete Alpaca
  get alpacaMarketServer() { return this._alpacaMarketServer;}
  set alpacaMarketServer(server) { this._alpacaMarketServer = server;}

  get feed() { return this._feed;}
  set feed(newFeed) { this._feed = newFeed;}

  // Parametri retry WS Alpaca
  get alpacaRetryDelay() { return this._alpacaRetryDelay;}
  set alpacaRetryDelay(newRetry) { this._alpacaRetryDelay = newRetry; }

  // Symbol strategy
  get symbolStrategyMap() { return this._symbolStrategyMap; }
  set symbolStrategyMap(map) { this._symbolStrategyMap = map; }

  get alpacaMaxRetry() {return this._alpacaMaxRetry;}
  set alpacaMaxRetry(maxRetry) { this._alpacaMaxRetry = maxRetry;}

  // Module active
  get moduleActive() { return this._moduleActive; }
  set moduleActive(v) { this._moduleActive = !!v; }

  // Communication channels
  get communicationChannels() { return this._communicationChannels; }
  set communicationChannels(cfg) { this._communicationChannels = cfg; }

  // Logs
  get logLevel() { return this._logLevel; }
  set logLevel(newLevel) { 
    this._logLevel = newLevel;
    this._logger.setLevel(newLevel);
  }

  

  // snapshot utile per debug/logging
  toJSON() {
    return {
      alpacaMarketServer: this._alpacaMarketServer,
      feed: this._feed,
      alpacaRetryDelay: this._alpacaRetryDelay,
      alpacaMaxRetry: this._alpacaMaxRetry,
      communicationChannels: this._communicationChannels,
      symbolStrategyMap: this._symbolStrategyMap,
      moduleActive: this._moduleActive,
      logLevel: this._logLevel
    };
  }
}

module.exports = StateManager;
