const { asBool, asInt } = require('../../shared/helpers');

class StateManager {
  constructor(env) {
    // Alpaca WS endpoint + feed
    this._alpacaMarketServer = process.env.ALPACA_MARKET_URL || 'ws://localhost:3003/v2'; // es. 'wss://stream.data.alpaca.markets/v2'
    this._feed               = process.env.FEED || 'iex';

    // Parametri retry WS Alpaca
    this._alpacaRetryDelay = asInt(process.env.ALPACA_WSS_RETRAY_DELAY, 5000);
    this._alpacaMaxRetray  = asInt(process.env.ALPACA_WSS_MAX_RETRY, 10);

    // Flags / intervalli BUS (usa asBool/asInt)
    this._msgTelemetryOn        = asBool(process.env.MSG_TELEMETRY, true);
    this._msgTelemetryIntervals = asInt(process.env.MSG_TELEMETRY_INTERVALS, 500);

    this._msgTickOn             = asBool(process.env.MSG_TICK, true);
    this._msgTickIntervals      = asInt(process.env.MSG_TICK_INTERVALS, 500);

    this._msgCandleOn           = asBool(process.env.MSG_CANDLE, true);
    this._msgCandleIntervals    = asInt(process.env.MSG_CANDLE_INTERVALS, 500);

    this._msgLogsOn             = asBool(process.env.MSG_LOGS, true);
    this._msgLogsIntervals      = asInt(process.env.MSG_LOGS_INTERVALS, 500);

    // Stato modulo
    this._symbolStrategyMap = [];
    this._moduleActive = true;
    this._logLevel = process.env.LOG_LEVEL || 'info';

    // Abilitazione canali BUS
    this._communicationChannels = {
      telemetry : { on: this._msgTelemetryOn, params : { intervalsMs : this._msgTelemetryIntervals }},
      tick      : { on: this._msgTickOn,      params : { intervalsMs : this._msgTickIntervals }},
      candle    : { on: this._msgCandleOn,    params : { intervalsMs : this._msgCandleIntervals }},
      logs      : { on: this._msgLogsOn,      params : { intervalsMs : this._msgLogsIntervals }}
    };

  }

  // Status
  get status() { return this._status; }
  set status(value) { this._status = value; }

  get statusDetails() { return this._statusDetails; }
  set statusDetails(value) { this._statusDetails = value; }

  // Symbol strategy
  get symbolStrategyMap() { return this._symbolStrategyMap; }
  set symbolStrategyMap(map) { this._symbolStrategyMap = map; }

  // Module active
  get moduleActive() { return this._moduleActive; }
  set moduleActive(v) { this._moduleActive = !!v; }

  // Communication channels
  get communicationChannels() { return this._communicationChannels; }
  set communicationChannels(cfg) { this._communicationChannels = cfg; }

  // snapshot utile per debug/logging
  toJSON() {
    return {
      alpacaMarketServer: this._alpacaMarketServer,
      feed: this._feed,
      alpacaRetryDelay: this._alpacaRetryDelay,
      alpacaMaxRetray: this._alpacaMaxRetray,
      communicationChannels: this._communicationChannels,
      symbolStrategyMap: this._symbolStrategyMap,
      moduleActive: this._moduleActive,
      logLevel: this._logLevel
    };
  }
}

module.exports = StateManager;
