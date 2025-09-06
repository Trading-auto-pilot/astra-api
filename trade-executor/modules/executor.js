// modules/executor.js — core: gestione candela e decisioni
const { withSymbolLock } = require('./locks');
const { addActiveOrderToStream } = require('./streams');
const { requestSignalREST, requestCapital, placeOrder, closePosition } = require('./clients');


function handleCandleFactory({ redis, state, logger }) {
return async function handleCandle(candle) {
try {
const { symbol } = candle || {};
if (!symbol) return;


await withSymbolLock({ redis, env: state.env, symbol }, async () => {
const strategyId = state.getStrategyId(symbol);
if (!strategyId) return;


const signal = await requestSignalREST(state, { strategyId, symbol, candle });
if (signal === 'HOLD') return;


const inSet = await redis.sIsMember(state.ACTIVE_ORDERS_SET, symbol);


if (signal === 'BUY') {
if (inSet) return; // già in gestione
const cap = await requestCapital({ strategyId, symbol });
if (!cap?.ok || (cap.amount || 0) <= 0) return;
const px = candle.close ?? candle.price ?? 0;
const qty = cap.qty ?? (px > 0 ? Math.floor(cap.amount / px) : 0);
if (qty <= 0) return;


const o = await placeOrder({ side: 'buy', symbol, qty, strategyId });
if (o?.ok) {
await addActiveOrderToStream({ redis, state, evt: {
symbol, side: 'buy', qty, price: o.price, strategyId,
clientOrderId: o.client_order_id, ts: Date.now()
}});
}
}


if (signal === 'SELL') {
if (!inSet) return; // niente da chiudere (o gestisci fetch posizione)
const o = await closePosition({ symbol, strategyId });
if (o?.ok) {
await addActiveOrderToStream({ redis, state, evt: {
symbol, side: 'sell', qty: o.qty, price: o.price, strategyId,
clientOrderId: o.client_order_id, ts: Date.now()
}});
}
}
});
} catch (e) {
logger.error(`[handleCandle] ${e.message}`);
}
};
}


module.exports = { handleCandleFactory };