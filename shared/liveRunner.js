const axios = require('axios');
const WebSocket = require('ws');
const StrategyUtils = require('./utils');
const processCandle = require('../strategies/sma/processCandle');
const CacheManager = require('./cacheManager'); // se serve ancora per SMA su dati recenti
const { placeOrder } = require('./placeOrders');
require('dotenv').config({ path: '../.env' });

async function runLive(symbol, strategyParams) {
  const ws = new WebSocket('wss://stream.data.alpaca.markets/v2/iex');
  //const ws = new WebSocket('wss://paper-api.alpaca.markets/stream');

  let params={};

  const state = {
    capitaleLibero: strategyParams.capitaleIniziale,
    capitaleInvestito: 0,
    comprato: 0,
    lastOp: null,
    daysFree: 0,
    daysInvested: 0,
    minDay: 9999999,
    maxDay: 0,
    numOp: 0
  };

  const cacheManager = new CacheManager('./cache'); // se vuoi tenerlo in linea

  ws.on('open', () => {
    console.log('[WS] Connessione aperta. Autenticazione in corso...');

    ws.send(JSON.stringify({
      action: "auth",
      key: process.env.APCA_API_KEY_ID,
      secret: process.env.APCA_API_SECRET_KEY
    }));
  });

  ws.on('message', async (data) => {
    const message = JSON.parse(data.toString());
    
    if (Array.isArray(message)) {
      for(const msg of message){
        console.log('[WS] Messaggio ricevuto:', JSON.stringify(msg));

        if (msg.T === 'success'  && msg.msg === 'authenticated') {
          console.log('[WS] Autenticazione OK. Sottoscrizione...');
          const symbolsList = await StrategyUtils.getSymbolsList();
          ws.send(JSON.stringify({
            action: "subscribe",
            bars:symbolsList
           // quotes:["FAKEPACA"] // oppure "trades" se vuoi tick-by-tick
          }));
        }

        if (msg.T === 'b') { // 'b' = bar (candle) evento su timeframe aggregato
          const candle = {
            t: msg.t,
            o: msg.o,
            h: msg.h,
            l: msg.l,
            c: msg.c,
            v: msg.v
          };

          console.log(`[LIVE] Nuova candela ricevuta: ${candle.t}`);

          // Recupero le strategie per la candela in arrivo
          const strategies = await StrategyUtils.getStrategy(msg.S);

          // Avvio tutte le strategie per questa candela
          for (const strategy of strategies) {

            try {
              params = JSON.parse(strategy.params);
            } catch (error) {
              console.log('[LIVE] Errore nella conversione di '+strategy.params+' '+error);
            }
            
            console.log(`[LIVE] Trovata strategia attiva: ${strategy.bot} per simbolo ${strategy.symbol} con parametri ${strategy.params}`);
            console.log(`[LIVE] Chiamo http://${strategy.containerName}:3001/processCandle con i seguenti parametri`);

            try {
              const body = { candle : candle, strategyParams: state, params:params };
              // 📤 Chiamata HTTP al container SMA
              const response = await axios.post(`http://${strategy.containerName}:3001/processCandle`,  body );

              const result = response.data;
              console.log('[LIVE] Response data');
              console.log(result);

              if (result.action === 'BUY') {
                console.log(`[LIVE] BUY Triggered at ${candle.c}`);
    
                try{
                  const order = await placeOrder(candle.S, 1000, 'buy', 'limit', 'day',msg.c);
                  console.log('Order confirmed:', order.id);

                  state.capitaleInvestito = state.capitaleLibero;
                  state.capitaleLibero = 0;
                  state.comprato = result.prezzo;
                  state.lastOp = new Date(candle.t);
                }
                catch (error) {
                  console.error('Order error:', error.message);
                }
    
              }
    
              if (result.action === 'SELL') {
                /**
                 *             
                console.log(`[LIVE] SELL Triggered at ${candle.c} motivo ${result.motivo}`);
                await StrategyUtils.writeSell(strategyParams.id, candle, state.capitaleInvestito, state.comprato, result.motivo, state.lastOp);
                state.capitaleLibero = (candle.c / state.comprato) * state.capitaleInvestito;
                state.capitaleInvestito = 0;
                state.daysInvested += result.days;
                state.minDay = Math.min(state.minDay, result.days);
                state.maxDay = Math.max(state.maxDay, result.days);
                state.numOp++;
                state.lastOp = new Date(candle.t);
                 */
    
              }
            } 
            catch (error) {
              console.error(`[HTTP] Errore nella chiamata al container ${strategy.bot}:`, error.message);
            }
          }

        }

      }
    }
  });

  ws.on('error', (error) => {
    console.error('[WS] Errore:', error);
  });

  ws.on('close', () => {
    console.log('[WS] Connessione chiusa.');
  });
}

module.exports = {
  runLive
};
