// status.js — stato interno e configurazione
const { Router } = require('express');


module.exports = function buildStatusRouter(ctx) {
const { redis, bus, state, logger } = ctx;
const r = Router();


// Stato dettagliato
r.get('/', async (_req, res) => {
const ping = await redis.ping().catch(() => null);
res.json({
ok: true,
redis: !!ping,
bus: bus.status?.(),
mapping: state.snapshot(),
streams: state.streamsInfo(),
});
});


// Configura mapping simboli e servizi strategia
r.post('/config/strategy-map', (req, res) => {
const { mappings = [], exec = [] } = req.body || {};
state.updateMappings(mappings);
state.updateExecServices(exec);
res.json({ ok: true, mapping: state.snapshot() });
});


// Utility: svuota set ordini attivi (manutenzione)
r.post('/maintenance/reset-active-orders', async (_req, res) => {
const count = await state.resetActiveOrdersSet();
res.json({ ok: true, removed: count });
});


return r;
};