// modules/clients.js — REST client per signal/capital/order
const axios = require('axios').create({ timeout: 8000 });


async function requestSignalREST(state, { strategyId, symbol, candle }) {
const svc = state.getExecService(strategyId);
if (!svc || svc.type !== 'rest' || !svc.url) return 'HOLD';
const url = `${svc.url.replace(/\/$/, '')}/signal`;
const { data } = await axios.post(url, { strategyId, symbol, candle });
return (data && data.signal) || 'HOLD';
}


async function requestCapital({ strategyId, symbol }) {
const CAPITAL_URL = process.env.CAPITAL_URL || 'http://capital-manager:7005';
const url = `${CAPITAL_URL.replace(/\/$/, '')}/allocate`;
const { data } = await axios.post(url, { strategyId, symbol });
return data || { ok: false, amount: 0 };
}


async function placeOrder({ side, symbol, qty, strategyId }) {
const ORDER_URL = process.env.ORDER_URL || 'http://order-gateway:7006';
const url = `${ORDER_URL.replace(/\/$/, '')}/orders`;
const { data } = await axios.post(url, { side, symbol, qty, strategyId });
return data;
}


async function closePosition({ symbol, strategyId }) {
const ORDER_URL = process.env.ORDER_URL || 'http://order-gateway:7006';
const url = `${ORDER_URL.replace(/\/$/, '')}/close-position`;
const { data } = await axios.post(url, { symbol, strategyId });
return data;
}


module.exports = { requestSignalREST, requestCapital, placeOrder, closePosition };