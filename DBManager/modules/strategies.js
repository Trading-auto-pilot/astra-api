// modules/strategies.js

const { getDbConnection, sanitizeData } = require('./core');
const { resolveBotIdByName } = require('./bots');
const { v4: uuidv4 } = require('uuid');
const crypto = require("crypto");
const { resolveSymbolIdByName } = require('./symbols');
const createLogger = require('../../shared/logger');
const { publishCommand } = require('../../shared/redisPublisher');
const cache = require('../../shared/cache');

const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'strategies';
const MODULE_VERSION = '2.0';


let logLevel = process.env.LOG_LEVEL || 'info';
let flushDBSec = Number(process.env.FLUSH_DB_SEC) || 30;
let IntervalFlush=null;
const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, logLevel);

function getLogLevel() { return logLevel}
function setLogLevel(level) {
  logLevel = level;
  logger.setLevel(logLevel);
}
function getFlushDBSec() { return flushDBSec}
function setFlushDBSec(value) {
  flushDBSec = value;
  clearInterval(IntervalFlush);
  startAtSecondSec(flushDB);
}

function hashId(name, description) {
  const raw = `${name}|${description || ""}|${new Date().toISOString()}`;
  return crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16);
}
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
function safeParseJSON(s) { try { return JSON.parse(s); } catch { return undefined; } }
function asJson(v) {
  if (v == null) return undefined;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return undefined; } }
  if (typeof v === "object") return v; // già deserializzato dal driver
  return undefined;
}

function rowToStrategy(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.Description ?? null,
    enabled: !!row.enabled,
    priority: Number(row.priority),
    direction: row.direction,
    buy_bot_id: String(row.buy_bot_id),
    sell_bot_id: String(row.sell_bot_id),
    config: row.config,
    bot_params:row.bot_params,
    updated_at: row.updated_at, // opzionale
    share_perc:row.share_perc
  };
}

/** Ritorna tutte le strategie con symbols e bot_params */
async function listStrategiesV2() {
  const conn = await getDbConnection();
  const [rows] = await conn.query(
    `SELECT id, name, Description, enabled, priority, direction, buy_bot_id, sell_bot_id, config, notes, updated_at, share_perc
     FROM strategies_v2
     ORDER BY updated_at DESC`
  );
  if (!rows.length) return [];

  const ids = rows.map(r => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const [symRows] = await conn.query(
    `SELECT strategy_id, symbol, enabled, priority_override, params_override
     FROM strategy_symbol
     WHERE strategy_id IN (${placeholders})
     ORDER BY symbol ASC`,
    ids
  );

  // indicizza symbols per strategy_id
  const byStrat = new Map();
  for (const r of rows) {
    byStrat.set(r.id, {
      strategy: rowToStrategy(r),
      symbols: [],
      bot_params: r.notes ? safeParseJSON(r.notes) : undefined,
    });
  }
  for (const s of symRows) {
    const bucket = byStrat.get(s.strategy_id);
    if (!bucket) continue;
    bucket.symbols.push({
      symbol: String(s.symbol).toUpperCase(),
      enabled: s.enabled !== 0,
      priority_override: s.priority_override != null ? Number(s.priority_override) : null,
      params_override: asJson(s.params_override) ?? null,
    });
  }
  conn.release();
  return Array.from(byStrat.values());
}

/** (facoltativa) singola strategia per id */
async function getStrategyV2(id) {
  const conn = await getDbConnection();
  const [rows] = await conn.query(
    `SELECT id, name, Description, enabled, priority, direction, buy_bot_id, sell_bot_id, notes, updated_at, share_perc
     FROM strategies_v2 WHERE id = ? LIMIT 1`, [id]
  );
  if (!rows.length) return null;

  const base = rows[0];
  const [symRows] = await conn.query(
    `SELECT strategy_id, symbol, enabled, priority_override, params_override
     FROM strategy_symbol WHERE strategy_id = ? ORDER BY symbol ASC`, [id]
  );
  conn.release();
  return {
    strategy: rowToStrategy(base),
    symbols: symRows.map(s => ({
      symbol: String(s.symbol).toUpperCase(),
      enabled: s.enabled !== 0,
      priority_override: s.priority_override != null ? Number(s.priority_override) : null,
      params_override: s.params_override ? safeParseJSON(s.params_override) : null,
    })),
    bot_params: base.notes ? safeParseJSON(base.notes) : undefined,
  };
}

/**
 * payload:
 * {
 *   strategy: { name, description?, enabled, priority, direction, buy_bot_id, sell_bot_id },
 *   symbols:  [{ symbol, enabled?, priority_override?, params_override? }, ...],
 *   bot_params?: { [botId]: any } // config dei due BOT (verrà salvata in strategies_v2.config)
 * }
 */

const isPlainObj = (v) =>
  v && typeof v === "object" && !Array.isArray(v) &&
  Object.prototype.toString.call(v) === "[object Object]";

function hashId(name, description) {
  const raw = `${name}|${description || ""}|${new Date().toISOString()}`;
  return "str_" + crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

function normalizeBotParams(v) {
  if (v == null) return {};
  if (typeof v === "string") {
    try { return normalizeBotParams(JSON.parse(v)); } catch { return {}; }
  }
  if (Array.isArray(v)) {
    const out = {};
    for (const it of v) {
      if (it && typeof it === "object") {
        const id = it.bot_id ?? it.id ?? it.key;
        if (id != null) out[String(id)] = isPlainObj(it.params) ? it.params : {};
      }
    }
    return out;
  }
  return isPlainObj(v) ? v : {};
}

function coercePercent(x, fieldName = "share") {
  if (x == null || x === "") return null;
  const n = Number(x);
  if (!Number.isFinite(n)) throw new Error(`${fieldName} non numerico`);
  if (n < 0 || n > 100) throw new Error(`${fieldName} fuori range 0..100`);
  return Math.round(n * 100) / 100; // 2 decimali max
}

function ensureDirection(d) {
  if (d === "LONG_ONLY" || d === "BOTH") return d;
  throw new Error("direction non valido");
}

function toUpperSym(s) {
  return String(s || "").trim().toUpperCase();
}

async function modifyStrategyV2(id, payload) {
  const s = payload?.strategy || {};
  //const id = String(s?.id || "").trim();
  if (!id) throw new Error("strategy.id mancante");

  // validazioni base / normalizzazioni
  if (!s?.name || typeof s.name !== "string") throw new Error("strategy.name mancante");
  if (s.buy_bot_id == null || s.sell_bot_id == null) throw new Error("buy_bot_id/sell_bot_id mancanti");
  const buyId  = String(s.buy_bot_id);
  const sellId = String(s.sell_bot_id);

  const prio = Number(s.priority);
  if (!Number.isInteger(prio) || prio <= 0) throw new Error("priority non valido");

  const direction = ensureDirection(s.direction);
  const botParams = normalizeBotParams(payload?.bot_params);

  // share a livello root (se non presente, prova fallback da params del BUY)
  const buyParamsRaw  = isPlainObj(botParams[buyId])  ? { ...botParams[buyId] }  : {};
  const sellParamsRaw = isPlainObj(botParams[sellId]) ? { ...botParams[sellId] } : {};

  const sharePerc = coercePercent(
    payload.sharePerc ?? payload.share ?? payload.allocation ??
    buyParamsRaw.share ?? buyParamsRaw.sharePerc ?? buyParamsRaw.allocation,
    "sharePerc"
  );
  // rimuovi eventuali chiavi share dal BUY params
  delete buyParamsRaw.share;
  delete buyParamsRaw.sharePerc;
  delete buyParamsRaw.allocation;

  // config (fonte di verità per i due bot)
  const config = {
    buy:  { bot_id: buyId,  params: buyParamsRaw },
    sell: { bot_id: sellId, params: sellParamsRaw },
  };

  // legacy/compat: conserva blob bot_params in notes (opzionale)
  const notes = Object.keys(botParams).length ? JSON.stringify(botParams) : null;

  // symbols: se forniti nel payload, rappresentano lo stato DESIDERATO
  const symbols = Array.isArray(payload?.symbols) ? payload.symbols : undefined;
  let desired = undefined;
  if (symbols) {
    const arr = symbols.map(row => ({
      symbol: toUpperSym(row.symbol),
      enabled: row.enabled === false ? 0 : 1,
      priority_override: row.priority_override != null ? Number(row.priority_override) : null,
      params_override: isPlainObj(row.params_override) ? JSON.stringify(row.params_override) : (row.params_override ?? null),
    })).filter(r => r.symbol);
    // dedup by symbol
    const seen = new Set();
    desired = [];
    for (const r of arr) {
      if (!seen.has(r.symbol)) { desired.push(r); seen.add(r.symbol); }
    }
  }

  const conn = await getDbConnection();
  try {
    await conn.beginTransaction();

    // esistenza + lock
    const [exist] = await conn.query("SELECT id FROM strategies_v2 WHERE id = ? FOR UPDATE", [id]);
    if (!exist.length) throw new Error(`strategy id non trovato: ${id}`);

    // UPDATE strategies_v2
    await conn.execute(
      `UPDATE strategies_v2
         SET name = ?, Description = ?, enabled = ?, priority = ?, direction = ?,
             buy_bot_id = ?, sell_bot_id = ?, config = ?, notes = ?, share_perc = ?
       WHERE id = ?`,
      [
        s.name,
        s.description || null,
        s.enabled === false ? 0 : 1,
        prio,
        direction,
        buyId,
        sellId,
        config,           // mysql2 su colonna JSON accetta l'oggetto
        notes,
        sharePerc,        // può essere null
        id
      ]
    );

    // Sincronizza strategy_symbol solo se symbols è presente nel payload
    let symChanges = { inserted: 0, updated: 0, deleted: 0 };
    if (desired) {
      // leggi stato attuale
      const [curRows] = await conn.query(
        "SELECT symbol, enabled, priority_override, params_override FROM strategy_symbol WHERE strategy_id = ?",
        [id]
      );
      const currentMap = new Map(curRows.map(r => [toUpperSym(r.symbol), r]));

      const desiredMap = new Map(desired.map(r => [r.symbol, r]));

      // delete: tutti quelli in current che non sono più desired
      const toDelete = [...currentMap.keys()].filter(sym => !desiredMap.has(sym));
      if (toDelete.length) {
        const qs = toDelete.map(() => "?").join(",");
        await conn.execute(
          `DELETE FROM strategy_symbol WHERE strategy_id = ? AND symbol IN (${qs})`,
          [id, ...toDelete]
        );
        symChanges.deleted = toDelete.length;
      }

      // insert/update
      const toInsert = [];
      for (const [sym, row] of desiredMap.entries()) {
        if (!currentMap.has(sym)) {
          toInsert.push([id, sym, row.enabled, row.priority_override, row.params_override]);
        } else {
          const cur = currentMap.get(sym);
          const needUpdate =
            Number(cur.enabled) !== Number(row.enabled) ||
            (cur.priority_override == null ? null : Number(cur.priority_override)) !== (row.priority_override == null ? null : Number(row.priority_override)) ||
            String(cur.params_override ?? null) !== String(row.params_override ?? null);
          if (needUpdate) {
            await conn.execute(
              `UPDATE strategy_symbol
                  SET enabled = ?, priority_override = ?, params_override = ?
                WHERE strategy_id = ? AND symbol = ?`,
              [row.enabled, row.priority_override, row.params_override, id, sym]
            );
            symChanges.updated++;
          }
        }
      }

      if (toInsert.length) {
        const placeholders = toInsert.map(() => "(?,?,?,?,?)").join(",");
        await conn.execute(
          `INSERT INTO strategy_symbol
             (strategy_id, symbol, enabled, priority_override, params_override)
           VALUES ${placeholders}`,
          toInsert.flat()
        );
        symChanges.inserted = toInsert.length;
      }
    }

    await conn.commit();
    return { ok: true, id, symbols: symbols ? symChanges : undefined };
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    if (typeof conn.release === "function") conn.release();
    else if (typeof conn.end === "function") await conn.end();
  }
}

async function createStrategyV2(payload) {
  const s = payload?.strategy || {};
  const symbols = Array.isArray(payload?.symbols) ? payload.symbols : [];
  const botParams = normalizeBotParams(payload?.bot_params);

  // --- validazioni base
  if (!s?.name || typeof s.name !== "string") throw new Error("strategy.name mancante");
  if (s.buy_bot_id == null || s.sell_bot_id == null) throw new Error("buy_bot_id/sell_bot_id mancanti");
  const buyId  = String(s.buy_bot_id);
  const sellId = String(s.sell_bot_id);

  const prio = Number(s.priority);
  if (!Number.isInteger(prio) || prio <= 0) throw new Error("priority non valido");
  if (!["LONG_ONLY", "BOTH"].includes(s?.direction)) throw new Error("direction non valido");
  if (symbols.length === 0) throw new Error("symbols vuoto");

  // dedup symbols
  const normSymbols = symbols.map(x => String(x.symbol || "").trim().toUpperCase()).filter(Boolean);
  if (new Set(normSymbols).size !== normSymbols.length) throw new Error("symbols contiene duplicati");
  // --- share a livello ROOT (preferenza root -> fallback da BUY params)
  const buyParamsRaw = isPlainObj(botParams[buyId]) ? { ...botParams[buyId] } : {};
  const sharePerc = coercePercent(payload.strategy.sharePerc);

  // rimuovi eventuali chiavi share dai params del BUY per non duplicare
  delete buyParamsRaw.share;
  delete buyParamsRaw.sharePerc;
  delete buyParamsRaw.allocation;

  const sellParamsRaw = isPlainObj(botParams[sellId]) ? botParams[sellId] : {};
  // --- config (solo parametri BOT, niente share qui)
  const config = {
    buy:  { bot_id: buyId,  params: buyParamsRaw },
    sell: { bot_id: sellId, params: sellParamsRaw },
  };
  // ID e config serializzata (fonte di verità per i due BOT)
  const id = hashId(s.name, s.description);

  // (legacy) opzionale: conserva anche il vecchio blob in notes
  const notes = Object.keys(botParams).length ? JSON.stringify(botParams) : null;

  const conn = await getDbConnection();
  try {
    await conn.beginTransaction();

    // INSERT strategies_v2 (assume colonna JSON `config` esiste)
    await conn.execute(
      `INSERT INTO strategies_v2
       (id, name, Description, enabled, priority, direction, buy_bot_id, sell_bot_id, config, notes, share_perc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        s.name,
        s.description || null,
        !!s.enabled ? 1 : 0,
        Number(s.priority),
        s.direction,
        String(s.buy_bot_id),
        String(s.sell_bot_id),
        JSON.stringify(config),
        notes,
        sharePerc
      ]
    );

    // INSERT strategy_symbol (serializza overrides)
    if (symbols.length) {
      const rows = symbols.map(row => {
        const sym = String(row.symbol).trim().toUpperCase();
        if (!sym) throw new Error("symbol vuoto in symbols[]");
        const enabled = row.enabled === false ? 0 : 1;
        const prioOv = row.priority_override != null ? Number(row.priority_override) : null;
        if (prioOv != null && !Number.isFinite(prioOv)) throw new Error(`priority_override non numerico per ${sym}`);
        const ovObj = isPlainObj(row.params_override) ? row.params_override : null;
        return [id, sym, enabled, prioOv, ovObj ? JSON.stringify(ovObj) : null];
      });

      const placeholders = rows.map(() => "(?,?,?,?,?)").join(",");
      await conn.execute(
        `INSERT INTO strategy_symbol
         (strategy_id, symbol, enabled, priority_override, params_override)
         VALUES ${placeholders}`,
        rows.flat()
      );
    }

    await conn.commit();
    return { ok: true, id };
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    // mysql2/promise: release() se è pooled, altrimenti end()
    if (typeof conn.release === "function") conn.release();
    else if (typeof conn.end === "function") await conn.end();
  }
}

async function getDBActiveStrategies(symbol = null) {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query(`SELECT * FROM vstrategies WHERE status = 'active'`);
    return rows
      .map(row => {
        try {
          if (row.params) row.params = JSON.parse(row.params);
        } catch (err) {
          logger.error(`[getDBActiveStrategies] Errore parsing JSON su params per id ${row.id}:`, err.message);
          row.params = {};
        }
        return row;
      })
      .filter(row => !symbol || row.idSymbol === symbol);
  } catch (err) {
    logger.error(`[getDBActiveStrategies] Errore select:`, err.message);
    throw err;
  } finally {
     conn.release();
  }
}

async function getActiveStrategies(symbol = null) {
  const keys = await cache.keys('strategies:*');
  const records = [];

  for (const key of keys) {
    const data = await cache.get(key);
    if (!symbol || data.symbol === symbol) {
      if(data && typeof(data.params) === 'string') data.params = JSON.parse(data.params);
      records.push(data);
    }
  }

  // Se ho record da Redis li ritorno
  if (records.length > 0) return records;

  // Altrimenti leggo dal DB
  const dbRecords = await getDBActiveStrategies(symbol);

  // Salvo ogni record in Redis con chiave "strategies:<id>"
  for (const record of dbRecords) {
    const redisKey = `strategies:${record.id}`;
    await cache.setp(redisKey, record); // senza TTL
  }

  return dbRecords;
}

async function getStrategiesCapital() {
  const strategies = await getActiveStrategies();
  return strategies.map(s => ({
    id: s.id,
    share: s.share,
    CapitaleInvestito: s.CapitaleInvestito,
    OpenOrders: s.OpenOrders
  }));
}


async function setStrategiesCapital(capitalData) {
  let rc = [];
  let records = [];

  try {
    for (const [idi, row] of Object.entries(capitalData)) {
      let id = row.id;
      let investito = Number(row.CapitaleInvestito) || 0;
      let ordini = Number(row.OpenOrders) || 0;

      if (investito < 0) {
        logger.error(`[setStrategiesCapital] Valore negativo non ammesso per la strategia ${id}: CapitaleInvestito=${investito}, imposto a zero`);
        investito = 0;
      }

      if (ordini < 0) {
        logger.error(`[setStrategiesCapital] Valore negativo non ammesso per la strategia ${id}: OpenOrders=${ordini}, imposto a zero`);
        ordini = 0;
      }

      const redisKey = `strategies:${id}`;
      const record = await cache.get(redisKey);

      if (record) {
        record.CapitaleInvestito = investito;
        record.OpenOrders = ordini;
        await cache.setp(redisKey, record);
        rc.push({ id, updated: true });
        records.push(record);
      } else {
        logger.warning(`[setStrategiesCapital] Strategia ${id} non trovata in Redis`);
        rc.push({ id, updated: false, reason: 'not found in Redis' });
      }
    }

    publishCommand('strategies:update',JSON.stringify(records));
    return rc;
  } catch (error) {
    logger.error(`[setStrategiesCapital] Errore aggiornando Redis con dati: ${JSON.stringify(capitalData)} → ${error.message}`);
    throw error;
  }
}


async function updateStrategies(id, update) {
  if (!id) {
    logger.error('[updateStrategies] ID mancante');
    return null;
  }

  if (!update || typeof update !== 'object') {
    logger.error('[updateStrategies] Parametro update non valido');
    return null;
  }

  const excluded = ['id', 'TotalCommitted'];
  const fields = Object.keys(update).filter(f => !excluded.includes(f));
  if (fields.length === 0) {
    logger.warning('[updateStrategies] Nessun campo valido da aggiornare');
    return { success: false, reason: 'Nessun campo aggiornabile' };
  }

  if ('CapitaleInvestito' in update && update.CapitaleInvestito < 0) {
    logger.error(`[updateStrategies] CapitaleInvestito negativo per strategia ${id}, impostato a 0`);
    update.CapitaleInvestito = 0;
  }

  if ('OpenOrders' in update && update.OpenOrders < 0) {
    logger.error(`[updateStrategies] OpenOrders negativo per strategia ${id}, impostato a 0`);
    update.OpenOrders = 0;
  }

  const redisKey = `strategies:${id}`;
  const record = await cache.get(redisKey);
  if (!record) {
    logger.warning(`[updateStrategies] Strategia ${id} non trovata in Redis`);
    return { success: false, reason: 'Strategia non trovata in Redis' };
  }

  // Applica gli aggiornamenti al record
  for (const field of fields) {
    record[field] = field === 'params' ? JSON.stringify(update[field]) : update[field];
  }

  await cache.setp(redisKey, record);
  logger.info(`[updateStrategies] Strategia ${id} aggiornata in Redis`);

  publishCommand('strategies:update',JSON.stringify(record));
  return { success: true, id };
}

async function getStrategiesRun() {
  const redisPattern = 'strategy_runs:*';
  const keys = await cache.keys(redisPattern);

  if (keys.length > 0) {
    const results = [];
    for (const key of keys) {
      const record = await cache.hgetall(key);
      const sanitizedData = sanitizeData("strategy_runs",record)
      if (record) results.push(sanitizedData);
    }
    return results;
  }

}

async function insertStrategyRun(strategyRun) {
  try {
    // Costruzione chiave: strategy_runs:<UUID>
    const id = strategyRun.strategy_runs_id; //uuidv4();
    const key = `strategy_runs:${id}`;
    console.log("id="+id);
    // open_date a oggi se mancante
    if (!strategyRun.open_date) {
      strategyRun.open_date = new Date().toISOString();
    }

    // const record = {
    //   id,
    //   ...strategyRun,
    // };

    const flatRecord = {};
    for (const [k, v] of Object.entries(strategyRun)) {
      if (v !== undefined && v !== null && typeof v !== 'object') {
        flatRecord[k] = String(v);
      } else if (typeof v === 'object') {
        flatRecord[k] = JSON.stringify(v);
      }
    }
    const sanitizedData = sanitizeData("strategy_runs",flatRecord);
    await cache.hmset(key, sanitizedData);


    logger.info('[insertStrategyRun] Inserito strategy_run in Redis con successo');
    publishCommand('strategy_run:update',sanitizedData);
    return { success: true, id };
  } catch (err) {
    logger.error('[insertStrategyRun] Errore Redis insert:', err.message);
    throw err;
  }

}


async function updateStrategyRun(strategy_runs_id, updates) {
  if (!strategy_runs_id || strategy_runs_id === 'OFF') {
    logger.warning('[updateStrategyRun] strategy_runs_id mancante');
    return { success: false, error: 'strategy_runs_id richiesto' };
  }

  const key = `strategy_runs:${strategy_runs_id}`;
  const existing = await cache.hgetall(key);

  if (!existing) {
    logger.error(`[updateStrategyRun] Nessun record trovato per strategy_runs_id : ${strategy_runs_id}`);
    return { success: false, error: 'Record non trovato' };
  }

  const updated = { ...existing };

  for (const [field, value] of Object.entries(updates)) {
    if (value !== undefined) {
      updated[field] = (field === 'close_date' || field === 'update_date')
        ? new Date(value).toISOString()
        : value;
    }
  }

  // Scrive il record aggiornato
  await cache.hmset(key, updated);
  logger.info(`[updateStrategyRun] strategy_run ${strategy_runs_id} aggiornato su Redis`);
  publishCommand('strategy_run:update',updated);
  return { success: true };
}


async function resetStrategiesCache() {
  if (IntervalFlush) clearInterval(IntervalFlush);

  const stratKeys = await cache.keys('strategies:*');
  const runKeys = await cache.keys('strategy_runs:*');
  const allKeys = [...stratKeys, ...runKeys];

  if (allKeys.length > 0) {
    await Promise.all(allKeys.map(key => cache.del(key)));
    logger.log(`[resetStrategiesCache] Cancellate ${allKeys.length} chiavi da Redis`);
  } else {
    logger.log(`[resetStrategiesCache] Nessuna chiave trovata da cancellare`);
  }

  await getActiveStrategies(); // ripopola le strategie
  logger.log(`[resetStrategiesCache] Strategie ricaricate in cache`);
  syncStrategyOnce();
  publishCommand('strategy_run:update',"reset");
  publishCommand('strategies:update',"reset");
}

async function updateSingleStrategyField(strategy_id, column, value) {
  if (!strategy_id || !column) {
    logger.error('[updateSingleStrategyField] Parametri mancanti');
    return { success: false, error: 'Parametri richiesti: strategy_id, column' };
  }

  const key = `strategies:${strategy_id}`;
  const record = await cache.get(key);

  if (!record) {
    logger.warn(`[updateSingleStrategyField] Strategia ${strategy_id} non trovata in cache`);
    return { success: false, error: 'Strategia non trovata' };
  }

  record[column] = value;
  await cache.setp(key, record);
  logger.info(`[updateSingleStrategyField] Strategia ${strategy_id} aggiornata: ${column} = ${value}`);
  publishCommand('strategies:update',JSON.stringifyrecord);
  return { success: true };
} 
/** Esecuzione in Loop al second sec di ogni minuto */

// Calcola il tempo fino al prossimo secondo 30
function startAtSecondSec(fn) {
  const now = new Date();
  const millis = now.getMilliseconds();
  const seconds = now.getSeconds();
  let delay;

  if (seconds < flushDBSec) {
    delay = (flushDBSec - seconds) * 1000 - millis;
  } else {
    delay = (60 - seconds +flushDBSec ) * 1000 - millis;
  }

  setTimeout(() => {
    fn(); // prima esecuzione
    IntervalFlush = setInterval(fn, 60 * 1000); // poi ogni 60 secondi
  }, delay);
}

async function syncStrategy() {
  let numStrategySync = 0;
  let records = [];
  const conn = await getDbConnection();
  try {
    const keys = await cache.keys('strategies:*');
    numStrategySync = keys.length;

    for (const key of keys) {
      const raw = await cache.get(key);
      if (!raw || !raw.id) {
        logger.warning(`[syncStrategy] Chiave ${key} senza record valido`);
        continue;
      }

      // Copia del record originale per non mutare direttamente
      const record = { ...raw };

      if (record.idBotIn && typeof record.idBotIn === 'string') {
        record.idBotIn = await resolveBotIdByName(record.idBotIn);
      }
      if (record.idBotOut && typeof record.idBotOut === 'string') {
        record.idBotOut = await resolveBotIdByName(record.idBotOut);
      }
      if (record.idSymbol && typeof record.idSymbol === 'string') {
        record.idSymbol = await resolveSymbolIdByName(record.idSymbol);
      }

      const data = sanitizeData("strategies", record); 

      const [existing] = await conn.execute(
        'SELECT id FROM strategies WHERE id = ?',
        [data.id]
      );

      const fields = Object.keys(data);
      const values = fields.map(f => data[f]);
      const placeholders = fields.map(() => '?').join(', ');

      if (existing.length > 0) {
        const setClause = fields.map(f => `${f} = ?`).join(', ');
        await conn.execute(
          `UPDATE strategies SET ${setClause} WHERE id = ?`,
          [...values, data.id]
        );
        logger.info(`[syncStrategy] Updated strategy ${data.id}`);
      } else {
        await conn.execute(
          `INSERT INTO strategies (${fields.join(', ')}) VALUES (${placeholders})`,
          values
        );
        logger.info(`[syncStrategy] Inserted strategy ${data.id}`);
      }

      records.push(data);
    }

    logger.info('[syncStrategy] Sincronizzazione completata');
  } catch (err) {
    logger.error('[syncStrategy] Errore:', err.message);
    throw err;
  } finally {
    conn.release();
  }

  return { success: true, numStrategy: numStrategySync };
}


async function syncStrategyRuns() {
  let numStrategyRuns = 0, numStrategyRunsClosed = 0;
  const keys = await cache.keys('strategy_runs:*');
  if (!keys.length) {
    logger.info('[syncStrategyRuns] Nessun record trovato in Redis');
    return;
  }

  numStrategyRuns = keys.length;
  const conn = await getDbConnection();

  try {
    for (const key of keys) {
      const id = key.split(':')[1];
      if (!id) {
        logger.error(`[syncStrategyRuns] id non valido per chiave ${key}`);
        continue;
      }

      const rawData = await cache.hgetall(key);
      if (!rawData || Object.keys(rawData).length === 0) {
        logger.warning(`[syncStrategyRuns] Nessun dato per ${key}`);
        continue;
      }

      // Usa sempre id dalla chiave, ignora rawData.strategy_runs_id
      delete rawData.id;
      delete rawData.strategy_runs_id;

      const data = sanitizeData("strategy_runs", rawData);
      const fields = Object.keys(data);
      const values = fields.map(f => data[f]);

      // 🔍 Debug: verifica presenza di undefined nei valori
      if (values.includes(undefined)) {
        logger.error(`[syncStrategyRuns] Valore undefined trovato in ${key}:`, values);
        continue;
      }

      const [rows] = await conn.execute(
        'SELECT 1 FROM strategy_runs WHERE strategy_runs_id = ? LIMIT 1',
        [id]
      );

      if (rows.length > 0) {
        const setClause = fields.map(f => `${f} = ?`).join(', ');
        await conn.execute(
          `UPDATE strategy_runs SET ${setClause} WHERE strategy_runs_id = ?`,
          [...values, id]
        );
        logger.info(`[syncStrategyRuns] Aggiornato strategy_run ${id}`);
      } else {
        const placeholders = fields.map(() => '?').join(', ');
        await conn.execute(
          `INSERT INTO strategy_runs (strategy_runs_id, ${fields.join(', ')}) VALUES (?, ${placeholders})`,
          [id, ...values]
        );
        logger.info(`[syncStrategyRuns] Inserito strategy_run ${id}`);
      }

      // ✅ Elimina da Redis se chiuso
      const numBuy = parseInt(data.numAzioniBuy || 0, 10);
      const numSell = parseInt(data.numAzioniSell || 0, 10);
      if (numBuy === numSell) {
        numStrategyRunsClosed++;
        await cache.del(key);
        logger.info(`[syncStrategyRuns] Eliminato da Redis ${key} (chiuso: ${numBuy}==${numSell})`);
      }
    }
  } catch (err) {
    logger.error(`[syncStrategyRuns] Errore: ${err.message}`);
    throw err;
  } finally {
    conn.release();
  }

  publishCommand('strategy_runs:update', JSON.stringify({}));
  return { success: true, numRecordSync: numStrategyRuns, numRecordDeleted: numStrategyRunsClosed };
}


// IntervalFlush
async function syncStrategyStart(){
  if (IntervalFlush) {
    logger.warning('[syncStrategyStart] Sync già attivo');
    return;
  }
  IntervalFlush = startAtSecondSec(syncStrategyOnce);
  logger.info('[syncStrategyStart] Sync attivato (ogni 30s)');
}

async function syncStrategyStop(){
  if (IntervalFlush) {
    clearInterval(IntervalFlush);
    IntervalFlush = null;
    logger.info('[syncStrategyStop] Sync fermato');
  } else {
    logger.warning('[syncStrategyStop] Sync non attivo');
  }
}

async function syncStrategyOnce(){
  const strategies = await syncStrategy();
  const strategy_runs = await syncStrategyRuns();
  return({success:true, recordsStrategy:strategies.numStrategy, recordsStrategyRuns:strategies.numRecordSync, deletedStrategyRuns:strategies.numRecordDeleted})
}

async function deleteStrategyV2(id) {
  const strategyId = String(id || "").trim();
  if (!strategyId) throw new Error("strategy id mancante");

  const conn = await getDbConnection();
  try {
    await conn.beginTransaction();

    // opzionale: verifica esistenza (lock per evitare race)
    const [rows] = await conn.query(
      "SELECT id FROM strategies_v2 WHERE id = ? FOR UPDATE",
      [strategyId]
    );
    if (!rows.length) {
      await conn.rollback();
      const err = new Error(`strategy non trovata: ${strategyId}`);
      err.code = "NOT_FOUND";
      throw err;
    }

    // 1) elimina i simboli collegati
    const [symRes] = await conn.execute(
      "DELETE FROM strategy_symbol WHERE strategy_id = ?",
      [strategyId]
    );

    // 2) elimina la strategia
    const [strRes] = await conn.execute(
      "DELETE FROM strategies_v2 WHERE id = ?",
      [strategyId]
    );

    await conn.commit();
    return {
      ok: true,
      id: strategyId,
      deleted: {
        strategies: strRes.affectedRows || 0,
        symbols: symRes.affectedRows || 0,
      },
    };
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    if (typeof conn.release === "function") conn.release();
    else if (typeof conn.end === "function") await conn.end();
  }
}

if(!process.env.FAST_SIMUL)
  syncStrategyStart();

module.exports = {
  getActiveStrategies,
  updateStrategies,
  getStrategiesRun,
  insertStrategyRun,
  syncStrategyRuns,
  getStrategiesCapital,
  setStrategiesCapital,
  getLogLevel,
  setLogLevel,
  getFlushDBSec,
  setFlushDBSec,
  resetStrategiesCache,
  updateSingleStrategyField,
  updateStrategyRun,
  syncStrategyStart,
  syncStrategyStop,
  syncStrategyOnce,
  createStrategyV2,
  listStrategiesV2,
  getStrategyV2,
  modifyStrategyV2,
  deleteStrategyV2

};
