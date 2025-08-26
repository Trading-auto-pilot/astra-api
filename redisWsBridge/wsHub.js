const { buildFilter, makeThrottler, makeLastPerKey, makeTickToBar1s } = require('./pipeline');
const { v4: uuidv4 } = require('uuid');

let logger = null;

function makeWsHub({ cfg }) {
  const clients = new Map(); // id -> {socket, filter, pipe, stats, opts}
  logger = cfg.logger;

  function addClient(socket, req) {
    const id = uuidv4();
    const stats = { sent: 0, dropped: 0, connectedAt: Date.now(), lastSentTs: null };
    const opts = parseClientOptions(req.url);
    const filter = buildFilter(opts);

    // pipeline di default: throttling per evitare flood
    const sendRaw = (obj) => {
      try { socket.send(JSON.stringify(obj)); stats.sent++; stats.lastSentTs = Date.now(); }
      catch { stats.dropped++; }
    };

    // Aggregazione configurabile
    let pipe = sendRaw;
    if (opts.aggregate === 'lastPerSymbol') {
      pipe = makeLastPerKey(opts.rateMs || 200, (m)=> (m.symbol||m.S||'').toUpperCase(), sendRaw);
    } else if (opts.aggregate === 'throttle') {
      pipe = makeThrottler(opts.rateMs || 200, sendRaw);
    } else if (opts.aggregate === 'tickToBar1s') {
      pipe = makeTickToBar1s(sendRaw);
    }

    const entry = { socket, filter, pipe, stats, opts };
    clients.set(id, entry);

  logger.info('[wsHub] client connected', JSON.stringify({ id, readyState: socket.readyState, url: req.url }));


    socket.on('message', (data) => handleClientMsg(id, data));
    socket.on('close', () => {
      clients.delete(id)
      logger.warning('[wsHub] client closed', id);
    });
    socket.on('error', (e) => {
      clients.delete(id)
      logger.error('[wsHub] client error', id, e?.message);
    });
  }

  function handleClientMsg(id, data) {
    // opzionale: supporto “subscribe” runtime via messaggi WS
    try {
      const msg = JSON.parse(data.toString());
      const entry = clients.get(id);
      if (!entry) return;
      if (msg.type === 'subscribe') {
        entry.opts = { ...entry.opts, ...msg.opts };
        entry.filter = buildFilter(entry.opts);
      }
    } catch {}
  }

// wsHub.js
function dispatch(msg) {
  for (const { socket, filter, pipe } of clients.values()) {
    if (socket.readyState !== 1) continue;
    try { if (filter(msg)) pipe(msg); } catch {}
  }
}

  function getClientsSnapshot() {
    const arr = [];
    for (const [id, v] of clients.entries()) {
      arr.push({ id, connectedAt: v.stats.connectedAt, sent: v.stats.sent, dropped: v.stats.dropped, lastSentTs: v.stats.lastSentTs, opts: v.opts });
    }
    return { count: clients.size, clients: arr };
  }

  function getMetrics() {
    return getClientsSnapshot(); // minimal; estendi se vuoi
  }

  return { addClient, dispatch, getClientsSnapshot, getMetrics };
}

function parseClientOptions(url) {
  // Esempio: /ws?topics=prod.market-listener.events.v1.*&symbols=AAPL,MSFT&types=candle&aggregate=lastPerSymbol&rateMs=200
  const u = new URL(url, 'http://localhost');
  const toList = (k) => (u.searchParams.get(k)||'').split(',').map(s=>s.trim()).filter(Boolean);
  const toNum  = (k, d) => { const n = Number(u.searchParams.get(k)); return Number.isFinite(n) ? n : d; };
  return {
    topics: toList('topics'),
    symbols: toList('symbols'),
    types: toList('types'),
    aggregate: u.searchParams.get('aggregate') || 'lastPerSymbol', // throttle | lastPerSymbol | tickToBar1s
    rateMs: toNum('rateMs', 200)
  };
}

module.exports = { makeWsHub };
