// Costruisce un predicato di filtro dal client config
function buildFilter(opts = {}) {
  const { topics, symbols, types } = opts;
  const symSet   = symbols ? new Set(symbols.map(s => String(s).toUpperCase())) : null;
  const typeSet  = types   ? new Set(types) : null;
  const empty = !(topics?.length) && !(symbols?.length) && !(types?.length);
  if (empty) return () => true; // <— default pass-through

  // topics: array di glob/regex sul campo __channel
  const topicMatchers = (topics || []).map(t => {
    if (t.startsWith('re:')) return (s) => new RegExp(t.slice(3)).test(s);
    const glob = t.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const re = new RegExp(`^${glob}$`);
    return (s) => re.test(s);
  });

  return (msg) => {
    if (typeSet && !typeSet.has(msg.type)) return false;
    if (symSet) {
      const sym = (msg.symbol || msg.S || msg.data?.symbol || '').toUpperCase();
      if (sym && !symSet.has(sym)) return false;
    }
    if (topicMatchers.length && !topicMatchers.some(fn => fn(msg.__channel || ''))) return false;
    return true;
  };
}

// Aggregatori semplici
function makeThrottler(intervalMs, sendFn) {
  let timer = null, last;
  return (msg) => {
    last = msg;
    if (timer) return;
    timer = setTimeout(() => { timer = null; if (last) sendFn(last); }, intervalMs);
  };
}

function makeLastPerKey(intervalMs, keyFn, sendFn) {
  const buf = new Map(); // key -> lastMsg
  let timer = null;
  return (msg) => {
    const k = keyFn(msg);
    buf.set(k, msg);
    if (timer) return;
    timer = setTimeout(() => {
      for (const m of buf.values()) sendFn(m);
      buf.clear(); timer = null;
    }, intervalMs);
  };
}

// Esempio: aggrega tick→bar 1s (minimo)
function makeTickToBar1s(sendFn) {
  const buckets = new Map(); // sym+sec -> {o,h,l,c, t(symbol second)}
  let timer = null;
  return (msg) => {
    const sym = (msg.symbol || msg.S || '').toUpperCase();
    const t = typeof msg.t === 'number' ? msg.t : Date.parse(msg.t || msg.ts || msg.time);
    const sec = Math.floor((t || Date.now()) / 1000);
    const k = `${sym}:${sec}`;
    const p = msg.p ?? msg.price ?? msg.c ?? msg.pc;
    if (p == null) return;
    const b = buckets.get(k) || { o: p, h: p, l: p, c: p, S: sym, t: sec*1000, T: 'b' };
    b.h = Math.max(b.h, p); b.l = Math.min(b.l, p); b.c = p;
    buckets.set(k, b);
    if (!timer) {
      timer = setTimeout(() => {
        for (const bar of buckets.values()) sendFn(bar);
        buckets.clear(); timer = null;
      }, 1000);
    }
  };
}

module.exports = { buildFilter, makeThrottler, makeLastPerKey, makeTickToBar1s };
