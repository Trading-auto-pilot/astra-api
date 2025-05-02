// strategies/sma/processCandle.js

const StrategyUtils = require('../../shared/utils');

const MODULE_NAME = 'processCandle';
const MODULE_VERSION = '1.0';

async function processCandle(element, state, strategyParams, cacheManager) {
  const { id, SL, TP, period, symbol } = strategyParams;

  const now = new Date(element.t);

  // Inizializza lastOp se mancante
  if (!state.lastOp) {
    state.lastOp = now;
  }

  // Calcolo media mobile
  const mediaMobile = await StrategyUtils.calcMediaMobileFromCache(symbol, now, period, cacheManager);
  if (!mediaMobile) {
    return { action: 'HOLD', reason : 'Media mobile non disponibile'}; // Media mobile non disponibile
  }

  // BUY: prezzo sopra media mobile e capitale libero
  if (element.c > mediaMobile && state.capitaleLibero > 0) {
    return {
      action: 'BUY',
      prezzo: element.c,
      mediaMobile: mediaMobile,
    };
  }

  // SELL: se capitale investito
  if (state.capitaleInvestito > 0) {
    const days = (now - state.lastOp) / (1000 * 60 * 60 * 24); // giorni passati

    // Verifica condizioni di SELL
    if (element.c < state.comprato * (1 - SL)) {
      return {
        action: 'SELL',
        prezzo: element.c,
        motivo: 'SL',
        mediaMobile : mediaMobile,
        days: days
      };
    }

    if (element.c > state.comprato * (1 + TP)) {
      return {
        action: 'SELL',
        prezzo: element.c,
        motivo: 'TP',
        mediaMobile :mediaMobile,
        days : days
      };
    }
  }

  return { action: 'HOLD' };
}

module.exports = processCandle;
