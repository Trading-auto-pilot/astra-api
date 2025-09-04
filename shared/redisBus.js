// redisBus.js
const { createClient } = require('redis');

function safeParse(s) { try { return JSON.parse(s); } catch { return undefined; } }


class RedisBus {
  constructor(opts = {}) {
    this.url    = opts.url || process.env.REDIS_URL || "redis://localhost:6379";
    this.logger = opts.logger || console;
    this.json   = opts.json !== false;
    this.name   = opts.name || "redisBus";

    this.channelsCfg = opts.channels || {};
    this.defaultIntervalMs = Number.isFinite(opts.defaultIntervalMs) ? opts.defaultIntervalMs : 500;

    this.pub = null;
    this.sub = null;

    // { key -> { on, intervalMs, queue:[], timer } }
    this._sched = new Map();

    this._connecting = false;
    this._connected  = false;
  }

  /**
   * Svuota la coda dello scheduler `state` per il canale `key`
   * e pubblica (batch) su Redis. Fail-closed se OFF o coda vuota.
   */
// timer -> flush
  _flushScheduler(key, state) {
    try {
      if (!state?.on) return;
      if (!this._connected || !this.pub?.isOpen) return;
      if (!state.queue?.length) return;

      const items = state.queue.splice(0);
      const byCh = new Map();
      for (const { channel, message } of items) {
        if (typeof channel !== 'string' || typeof message !== 'string') continue;
        (byCh.get(channel) || byCh.set(channel, []).get(channel)).push(message);
      }
      for (const [ch, arr] of byCh) {
        // se vuoi array JSON: JSON.stringify(arr.map(JSON.parse)) —> ma qui pubblichi strings singole
        // più semplice: invia singolarmente per compatibilità WS bridge
        for (const m of arr) this.pub.publish(ch, m).catch(e =>
          this._log('error', `[${this.name}] publish ${ch} error: ${e?.message||e}`)
        );
      }
      state.lastFlushAt = Date.now();
    } catch (e) {
      this._log('error', `[${this.name}] _flushScheduler ${key} failed: ${e?.message||e}`);
    }
  }



  setChannelConfig(key, cfg) {
    this.channelsCfg[key] = cfg;
    let state = this._sched.get(key);
    if (!state) { this._ensureScheduler(key, cfg); return; }

    state.on = !!cfg?.on;
    const newInterval = Number(cfg?.params?.intervalsMs) > 0 ? Number(cfg.params.intervalsMs) : this.defaultIntervalMs;

    if (state.intervalMs !== newInterval) {
      if (state.timer) clearInterval(state.timer);
      state.intervalMs = newInterval;
      if (state.on) state.timer = setInterval(() => this._flushScheduler(key, state), newInterval);
    }
    if (!state.on) {
      if (state.timer) { clearInterval(state.timer); state.timer = null; }
      state.queue = [];                               // <-- drop backlog quando OFF
      this._log('warn', `[${this.name}] scheduler DISABLED key=${key}`);
    } else if (!state.timer) {
      state.timer = setInterval(() => this._flushScheduler(key, state), state.intervalMs);
      this._log('info', `[${this.name}] scheduler ENABLED key=${key}`);
    }
  }


  setLogger(logger) { this.logger = logger || console; }

  _log(level, msg) {
    const fn = this.logger && this.logger[level] ? this.logger[level] : console.log;
    try { fn.call(this.logger, msg, { __opts: { skipBus: true } }); }
    catch { console.log(`[${this.name}] ${msg}`); }
  }

  async connect() {
    if (this._connected || this._connecting) {
      this._log('info', `[${this.name}] connect() skipped: already ${this._connected ? 'connected' : 'connecting'}`);
      return;
    }
    this._connecting = true;
    try {
      if (!this.pub) this.pub = createClient({ url: this.url });
      if (!this.sub) this.sub = createClient({ url: this.url });

      if (!this.pub.isOpen) await this.pub.connect();
      if (!this.sub.isOpen) await this.sub.connect();

      // prepara schedulers (una sola volta per chiave)
      for (const [key, cfg] of Object.entries(this.channelsCfg)) {
        this._ensureScheduler(key, cfg);
      }

      this._connected = true;
      this._log('info', `[${this.name}] connected`);
    } catch (e) {
      this._log('error', `[${this.name}] connect() failed: ${e && e.message ? e.message : e}`);
      try { await this.pub?.quit(); } catch {}
      try { await this.sub?.quit(); } catch {}
      this.pub = null; this.sub = null;
      this._connected = false;
      throw e;
    } finally {
      this._connecting = false;
    }
  }

  async close() {
    for (const s of this._sched.values()) {
      if (s.timer) clearInterval(s.timer);
      s.timer = null;
      s.queue.length = 0;
    }
    this._sched.clear();
    try { await this.pub?.quit(); } catch {}
    try { await this.sub?.quit(); } catch {}
    this.pub = null; this.sub = null;
    this._connected = false;
    this._log('info', `[${this.name}] closed`);
  }

  // -------- Pub/Sub --------

  _matchControlKey(channel) {
    const parts = String(channel).split('.');
    for (let i = parts.length - 1; i >= 0; i--) {
      const seg = parts[i];
      if (this._sched.has(seg)) return seg;
    }
    return null;
  }

  /**
   * Regole:
   * - Se il topic contiene una chiave configurata (es. tick/candle/logs/telemetry):
   *   * se on=false => DROP
   *   * se on=true  => ACCODA (anche se non connesso). Flusha quando connesso.
   * - Se NON contiene chiavi configurate:
   *   * se connesso => publish immediato
   *   * se non connesso => SKIP (log di warning)
   */
  async publish(channel, payload) {
    const key = this._matchControlKey(channel);
    const st = key && this._sched.get(key);
    // serializza sempre non-string
    const message = (typeof payload === 'string') ? payload
      : JSON.stringify(payload && typeof payload==='object'
          ? { ...payload, __source: this.name }  // clone + source
          : payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

    if (st) {
      if (!st.on) { this.logger?.trace?.(`[BUS] DROP ${channel} OFF`); return 0; }
      (st.queue ||= []).push({ channel, message });   // <-- una sola volta
      return 1;
    }

    // canale non gestito: decidi policy (fail-closed consigliato)
    // return 0; // <- fail-closed
    if (!this._connected || !this.pub?.isOpen) {
      this._log('warn', `[${this.name}] publish skipped (bus not connected) channel=${channel}`);
      return 0;
    }
    return this.pub.publish(channel, message);
  }

  async subscribe(channel, handler) {
    return this.sub.subscribe(channel, async (raw) => {
      const parsed = this.json ? safeParse(raw) : raw;
      await handler(parsed, raw);
    });
  }

  async psubscribe(pattern, handler) {
    return this.sub.pSubscribe(pattern, async (raw, channel) => {
      const parsed = this.json ? safeParse(raw) : raw;
      await handler(parsed, raw, channel);
    });
  }

  // -------- Streams --------

  async xadd(stream, fields) { return this.pub.xAdd(stream, "*", fields); }
  async xaddJson(stream, event) {
    const data = this.json ? JSON.stringify(event) : event;
    return this.pub.xAdd(stream, "*", { event: data });
  }

  async xgroupCreate(stream, group, start = "$") {
    try { await this.pub.xGroupCreate(stream, group, start, { MKSTREAM: true }); }
    catch (e) { if (!String(e?.message).includes("BUSYGROUP")) throw e; }
  }

  async consumeLoop({ stream, group, consumer, blockMs = 5000, count = 100, onMessage, onError }) {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    await this.xgroupCreate(stream, group);
    while (true) {
      try {
        const res = await this.pub.xReadGroup(
          { group, consumer },
          { key: stream, id: ">" },
          { COUNT: count, BLOCK: blockMs }
        );
        if (!res) continue;
        for (const entry of res) {
          for (const m of entry.messages) {
            const id = m.id;
            const fields = m.message;
            const raw = fields.event;
            const json = raw && this.json ? safeParse(raw) : undefined;
            const ok = await onMessage({ id, fields, json });
            if (ok) await this.pub.xAck(stream, group, id);
          }
        }
      } catch (e) {
        onError && onError(e);
        this.logger.error?.(`[${this.name}] consumeLoop error`, e);
        await sleep(500);
      }
    }
  }

  // -------- Internals --------
// --- _ensureScheduler: usa SEMPRE _flushScheduler (niente flush inline duplicato)
_ensureScheduler(key, cfg) {
    if (this._sched.has(key)) return;
    const on = !!cfg?.on;
    const intervalMs = Number(cfg?.params?.intervalsMs) > 0 ? Number(cfg.params.intervalsMs) : this.defaultIntervalMs;
    const state = { on, intervalMs, queue: [], timer: null, lastFlushAt: null };

    if (on) state.timer = setInterval(() => this._flushScheduler(key, state), intervalMs);
    this._log(on ? 'info' : 'warn', `[${this.name}] scheduler ${on?'ENABLED':'DISABLED'} key=${key} intervalMs=${intervalMs}`);
    this._sched.set(key, state);
  }



  // ---- Debug helpers ----
  status() {
    return {
      connected: this._connected,
      pubIsOpen: !!this.pub?.isOpen,
      subIsOpen: !!this.sub?.isOpen,
      schedulers: [...this._sched.entries()].map(([key, s]) => ({
        key, on: s.on, intervalMs: s.intervalMs, queued: s.queue.length, timerActive: !!s.timer
      }))
    };
  }

  async flushNow(key) {
    const s = this._sched.get(key);
    if (!s) throw new Error(`No scheduler for key=${key}`);
    const batch = s.queue.splice(0);
    let sent = 0;
    for (const { channel, message } of batch) {
      if (typeof channel !== 'string' || typeof message !== 'string') continue;
      await this.pub.publish(channel, message);
      sent++;
    }
    return sent;
  }
}

module.exports = { RedisBus };
