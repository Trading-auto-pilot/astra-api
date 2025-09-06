// server.js — solo endpoint operativi
const { Router } = require('express');


module.exports = function buildServerRouter(ctx) {
const { handleCandle } = ctx;
const r = Router();


// Health leggero (operativo)
r.get('/healthz', (_req, res) => res.json({ ok: true }));


// Ingresso candela singola (operativo)
r.post('/candle', async (req, res) => {
await handleCandle(req.body);
res.json({ ok: true });
});


// Ingresso batch candele (operativo)
r.post('/candle/batch', async (req, res) => {
const arr = Array.isArray(req.body) ? req.body : [];
for (const c of arr) await handleCandle(c);
res.json({ ok: true, count: arr.length });
});


return r;
};