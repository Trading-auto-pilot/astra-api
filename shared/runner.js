// shared/runner.js

const StrategyUtils = require('./utils');

/**
 * Runner generico per strategie (solo dati indicizzati su cache).
 * 
 * @param {Array} dataset - Array di candele [{t, o, h, l, c, v}]
 * @param {Object} initialState - Stato iniziale
 * @param {Object} strategyParams - Parametri della strategia
 * @param {Function} processCandle - Funzione che elabora una singola candela
 * @param {Object} cacheManager - Cache manager opzionale
 */

async function runBacktest(dataset, initialState, strategyParams, processCandle, cacheManager = null, id, strategy) {
    
    let state = { ...initialState };
    let minDay, maxDay;
    // 1. Creiamo il record iniziale nel DB
    await StrategyUtils.initScenario(
        strategyParams,
        strategy
    );

        // 2. Loop su tutte le candele
    for (let index = 0; index < dataset.length; index++) {
        const element = dataset[index];

    // PULITO: Passiamo solo quello che serve
    //state = await processCandle(element, state, { ...strategyParams, index }, cacheManager);
    const result = await processCandle(element, state, { ...strategyParams, index }, cacheManager);

    const newState = result?.newState || state; // fallback sicuro
    const action = result?.action;

    // Se processCandle restituisce un'azione da fare (BUY o SELL), la gestiamo qui
    if (action) {
        if (action === 'BUY') {
          await StrategyUtils.writeBuy(id, dataset[index], newState, result);
          const days = result.days;
          minDay = Math.min(state.minDay, days);
          maxDay = Math.max(state.maxDay, days);
          //minDay = result.minDay;
          //maxDay = result.maxDay;
        }
        if (action === 'SELL') {
          await StrategyUtils.writeSell(id, dataset[index], newState, result); 
          const days = result.days;
          minDay = Math.min(state.minDay, days);
          maxDay = Math.max(state.maxDay, days);
          //minDay = result.minDay;
          //maxDay = result.maxDay;
        }
    }
    state = newState; // aggiorna lo stato
  }

  const capitaleFinale = state.capitaleLibero + state.capitaleInvestito || 0;
  const profitto = (capitaleFinale / strategyParams.capitaleIniziale) ;
  const efficienza = profitto !== 0 ? state.daysInvested / (profitto * 100) : 0;

  await StrategyUtils.writeFinalResult(strategyParams, minDay,maxDay, capitaleFinale, profitto, efficienza);

  return state;
}

module.exports = {
  runBacktest
};
