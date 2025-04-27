// /strategies/sma/processCandle.js

const StrategyUtils = require('../../shared/utils');

async function processCandle(element, state, strategyParams, cacheManager) {
  //const { id, dataset, index, SL, TP } = strategyParams;

  if (!state.lastOp) {
    state.lastOp = new Date(element.t);
  }

  // Calcolo Media Mobile
  const mediaMobile = await StrategyUtils.calcMediaMobileFromCache(strategyParams.symbol, new Date(element.t), strategyParams.period, cacheManager, strategyParams.tf);

  if (!mediaMobile) {
    console.log('Media mobile non disponibile');
    return { action: 'HOLD' }; // Se non ancora disponibile la media mobile
  }

  // BUY se Prezzo > MediaMobile e ho capitale libero
  if (element.c > mediaMobile && state.capitaleLibero > 0) {
    const now = new Date(element.t);
    const days = (now - state.lastOp) / (1000 * 60 * 60 * 24);

    state.capitaleInvestito = state.capitaleLibero;
    state.daysFree += days;
    state.capitaleLibero = 0;
    state.comprato = element.c;
    state.lastOp = new Date(element.t);
    state.minDay = Math.min(state.minDay, days);
    state.maxDay = Math.max(state.maxDay, days);

    return {
        action: 'BUY',
        prezzo: element.c,
        daysFree:state.daysInvested,
        days:days,
        minDay:Math.min(state.minDay, days),
        maxDay:Math.max(state.maxDay, days)
      };
  }

  // SELL se ho capitale investito
  if (state.capitaleInvestito > 0) {
    const now = new Date(element.t);
    const days = (now - state.lastOp) / (1000 * 60 * 60 * 24);

    if (element.c < state.comprato * (1 - Number(strategyParams.SL))) {
      
        state.profitLoss = element.c / state.comprato;
        state.capitaleLibero = (element.c / state.comprato) * state.capitaleInvestito;
        state.capitaleInvestito = 0;
        state.daysInvested += days;
        state.numOp++;
        state.minDay = Math.min(state.minDay, days);
        state.maxDay = Math.max(state.maxDay, days);
        state.lastOp = now;
        
        return {
            action: 'SELL',
            prezzo: element.c,
            motivo: 'SL',
            profitLoss:state.profitLoss,
            daysInvested:state.daysInvested,
            days:days,
            minDay:Math.min(state.minDay, days),
            maxDay:Math.max(state.maxDay, days)
        };

    }

    if (element.c > state.comprato * (1 + Number(strategyParams.TP))) {

        state.profitLoss = element.c / state.comprato;
        state.capitaleLibero = (element.c / state.comprato) * state.capitaleInvestito;
        state.capitaleInvestito = 0;
        state.daysInvested += days;
        state.numOp++;
        state.minDay = Math.min(state.minDay, days);
        state.maxDay = Math.max(state.maxDay, days);
        state.lastOp = now;

        return {
            action: 'SELL',
            prezzo: element.c,
            motivo: 'TP',
            profitLoss:state.profitLoss,
            days:state.daysInvested,
            minDay:Math.min(state.minDay, days),
            maxDay:Math.max(state.maxDay, days)
        };

    }
  }
  return { action: 'HOLD' };
}

module.exports = processCandle;
