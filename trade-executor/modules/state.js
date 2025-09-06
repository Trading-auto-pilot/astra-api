// modules/state.js — mapping e info stream
const { createClient } = require('redis');


function initState({ env = 'DEV', logger }) {
const strategyBySymbol = new Map(); // symbol -> strategyId
const execSvcByStrategy = new Map(); // strategyId -> { type:'rest'|'redis', url?, reqCh?, resCh? }


const ACTIVE_ORDERS_STREAM = `${env}.orders.active.stream.v1`;
const ACTIVE_ORDERS_SET = `${env}.orders.active.set`;


return {
env,
logger,
ACTIVE_ORDERS_STREAM,
ACTIVE_ORDERS_SET,


getStrategyId(symbol) { return strategyBySymbol.get(symbol); },
getExecService(strategyId) { return execSvcByStrategy.get(strategyId); },


updateMappings(mappings) {
for (const m of mappings) if (m?.symbol && m?.strategyId) strategyBySymbol.set(m.symbol, m.strategyId);
},
updateExecServices(exec) {
for (const e of exec) if (e?.strategyId && e?.type) execSvcByStrategy.set(e.strategyId, { type: e.type, url: e.url, reqCh: e.reqCh, resCh: e.resCh });
},


snapshot() {
return {
symbols: [...strategyBySymbol.entries()],
strategies: [...execSvcByStrategy.entries()],
};
},
streamsInfo() { return { activeOrdersStream: ACTIVE_ORDERS_STREAM, activeOrdersSet: ACTIVE_ORDERS_SET }; },


async resetActiveOrdersSet(redis) {
// nota: la firma in status.js chiama senza argomento, quindi bindiamolo noi
// (iniettare redis in esecuzione è più pulito; qui lasciamo compatibilità)
try {
const client = redis || (global.__redis_for_state__);
if (!client) return 0;
const members = await client.sMembers(ACTIVE_ORDERS_SET);
let removed = 0;
for (const m of members) removed += await client.sRem(ACTIVE_ORDERS_SET, m);
return removed;
} catch { return 0; }
},
};
}


module.exports = { initState };