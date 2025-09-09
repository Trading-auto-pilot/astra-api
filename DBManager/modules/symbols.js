// modules/symbols.js

const { getDbConnection } = require('./core');
const createLogger = require('../../shared/logger');

const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'symbols';
const MODULE_VERSION = '2.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

async function getSymbolsList() {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.query('SELECT name FROM Symbols');
    return rows.map(row => row.name);
  } catch (err) {
    logger.error(`[getSymbolsList] Errore select:`, err.message);
    throw err;
  } finally {
    connection.release();
  }
}

async function resolveSymbolIdByName(name) {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.execute('SELECT id FROM Symbols WHERE name = ? LIMIT 1', [name]);
    if (rows.length > 0) {
      return rows[0].id;
    } else {
      throw new Error(`Simbolo con nome "${name}" non trovato`);
    }
  } finally {
    connection.release();
  }
}

function pickBranding(payload) {
  const r = payload;
  if (!r?.ticker) throw new Error("ticker mancante nel payload");
  const symbol = String(r.ticker).trim().toUpperCase();

  const branding = r.branding || {};
  const logoUrl = branding.logo_url || null;
  const iconUrl = branding.icon_url || null;

  return { symbol, logoUrl, iconUrl };
}

async function upsertSymbolBrandingFromPolygon(payload) {
  const { symbol, logoUrl, iconUrl } = pickBranding(payload);

  const conn = await getDbConnection();
  try {
    // esiste già?
    const [rows] = await conn.query(
      "SELECT name, logo, icon FROM Symbols WHERE name = ? LIMIT 1",
      [symbol]
    );

    if (rows.length) {
      // aggiorna SOLO se mancanti
      const cur = rows[0];
      const toSet = [];
      const vals = [];
      if ((cur.logo_url == null || cur.logo_url === "") && logoUrl) {
        toSet.push("logo = ?");
        vals.push(logoUrl);
      }
      if ((cur.icon_url == null || cur.icon_url === "") && iconUrl) {
        toSet.push("icon = ?");
        vals.push(iconUrl);
      }
      if (toSet.length) {
        vals.push(symbol);
        await conn.execute(`UPDATE Symbols SET ${toSet.join(", ")} WHERE name = ?`, vals);
        return { ok: true, symbol, inserted: false, updated: true };
      }
      return { ok: true, symbol, inserted: false, updated: false };
    }

    // inserisci nuovo
    await conn.execute(
      "INSERT INTO symbols (symbol, logo, icon) VALUES (?, ?, ?)",
      [symbol, logoUrl, iconUrl]
    );
    return { ok: true, symbol, inserted: true, updated: false };
  } finally {
    if (typeof conn.release === "function") conn.release();
    else if (typeof conn.end === "function") await conn.end();
  }
}

/**
 * Legge la tabella Symbols.
 * @param {string | string[] | undefined} symbol - opzionale; se string filtra per symbol esatto,
 *                                                 se array filtra per elenco.
 * @returns {Promise<Array<{id:number, symbol:string, icon:string|null, logo:string|null}>>}
 */
async function listSymbols(symbol) {
  const conn = await getDbConnection();
  try {
    // normalizza input
    const toUpper = (s) => String(s).trim().toUpperCase();
    const list = Array.isArray(symbol)
      ? symbol.map(toUpper).filter(Boolean)
      : (typeof symbol === "string" && symbol.trim() ? [toUpper(symbol)] : []);

    let rows;
    if (list.length === 1) {
      // un singolo symbol
      [rows] = await conn.query(
        "SELECT id, name, icon, logo FROM Symbols WHERE UPPER(name) = ? LIMIT 1",
        [list[0]]
      );
    } else if (list.length > 1) {
      // più symbol
      const qs = list.map(() => "?").join(",");
      [rows] = await conn.query(
        `SELECT id, name, icon, logo FROM Symbols WHERE UPPER(name) IN (${qs}) ORDER BY name ASC`,
        list
      );
    } else {
      // nessun filtro: tutti
      [rows] = await conn.query(
        "SELECT id, name, icon, logo FROM Symbols ORDER BY name ASC"
      );
    }

    return rows.map((r) => ({
      id: r.id,
      symbol: r.name,   // normalizzo il campo
      icon: r.icon ?? null,
      logo: r.logo ?? null,
    }));
  } finally {
    if (typeof conn.release === "function") conn.release();
    else if (typeof conn.end === "function") await conn.end();
  }
}

module.exports = {
  getSymbolsList,
  resolveSymbolIdByName,
  upsertSymbolBrandingFromPolygon,
  listSymbols
};
