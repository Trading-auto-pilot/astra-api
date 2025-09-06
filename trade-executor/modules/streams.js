// modules/streams.js — Redis Streams + Set per ordini attivi
async function addActiveOrderToStream({ redis, state, evt }) {
const fields = {
symbol: evt.symbol,
side: evt.side,
qty: String(evt.qty ?? 0),
price: evt.price != null ? String(evt.price) : '',
strategyId: evt.strategyId || '',
clientOrderId: evt.clientOrderId || '',
ts: String(evt.ts || Date.now()),
source: 'trade-executor',
};
await redis.sAdd(state.ACTIVE_ORDERS_SET, evt.symbol);
await redis.xAdd(state.ACTIVE_ORDERS_STREAM, '*', fields);
}


module.exports = { addActiveOrderToStream };