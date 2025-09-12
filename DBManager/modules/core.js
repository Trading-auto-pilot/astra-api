// modules/core/db.js

const mysql = require('mysql2/promise');
const createLogger = require('../../shared/logger');
const Alpaca = require('../../shared/Alpaca');
const cache = require('../../shared/cache');

const AlpacaApi = new Alpaca();

const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'core';
const MODULE_VERSION = '2.0';


const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

typeMap = {
  strategies : {
    "id":"integer",
    "idBotIn":"integer",
    "idBotOut":"integer",
    "idSymbol":"integer",
    "status":"string",
    "params":"string",
    "share":"decimal",
    "CapitaleInvestito":"decimal",
    "OpenOrders":"decimal",
    "NumeroOperazioni":"integer",
    "NumeroOperazioniVincenti":"integer",
    "ggCapitaleInvestito":"decimal",
    "MaxDay":"decimal",
    "MinDay":"decimal",
    "posizioneMercato":"string",
    "CapitaleResiduo":"decimal"
  },
  strategy_runs : {
    "AvgBuy": "decimal",
    "AvgSell": "decimal",
    "numAzioniBuy": "integer",
    "numAzioniSell": "integer",
    "PLAzione": "decimal",
    "PLCapitale": "decimal",
    "PLPerc": "decimal",
    "Drawdown_PeakMax": "decimal",
    "Drawdown_PeakMin": "decimal",
    "MaxDrawdown": "decimal",
    "Mean": "decimal",
    "M2": "decimal",
    "Varianza": "decimal",
    "ScartoQuadratico": "decimal",
    "ggCapitaleInvestito": "decimal",
    "open_date": "date",
    "CapitaleInvestito": "decimal",
    "strategy_runs_id": "string",
    "strategy_id": "string"
  },
  Positions : {
    "position_id":"string",
    "asset_id" :"string",
    "exchange":"string",
    "asset_class":"string",
    "qty":"decimal",
    "avg_entry_price":"decimal",
    "side":"string",
    "market_value":"decimal",
    "cost_basis":"decimal",
    "unrealized_pl":"decimal",
    "unrealized_plpc":"decimal",
    "unrealized_intraday_pl":"decimal",
    "unrealized_intraday_plpc":"decimal",
    "current_price":"decimal",
    "lastday_price":"decimal",
    "change_today":"decimal",
    "qty_available":"integer",
    "symbol":"string",
    "softDel":"integer"
  },

  Orders : {
    "id":"string",
    "client_order_id":"string",
    "created_at":"date",
    "updated_at":"date",
    "submitted_at":"date",
    "filled_at":"date",
    "expired_at":"date",
    "canceled_at":"date",
    "failed_at":"date",
    "replaced_at":"date",
    "replaced_by":"string",
    "replaces":"string",
    "asset_id":"string",
    "symbol":"string",
    "asset_class":"string",
    "notional":"string",
    "qty":"integer",
    "filled_qty":"integer",
    "filled_avg_price":"decomal",
    "order_class":"string",
    "order_type":"string",
    "type":"string",
    "side":"string",
    "time_in_force":"string",
    "limit_price":"decimal",
    "stop_price":"decimal",
    "status":"string",
    "extended_hours":"integer",
    "legs":"string",
    "trail_percent":"decimal",
    "trail_price":"decimal",
    "hwm":"string",
    "subtag":"string",
    "source":"string"
  },

  Account : {
    "id":"string",
    "account_number":"string",
    "status":"string",
    "currency":"string",
    "buying_power":"decimal",
    "cash":"decimal",
    "cash_withdrawable":"decimal",
    "cash_transferable":"decimal",
    "portfolio_value":"decimal",
    "pattern_day_trader":"integer",
    "trading_blocked":"integer",
    "transfers_blocked":"integer",
    "account_blocked":"integer",
    "trade_suspended_by_user":"integer",
    "multiplier":"string",
    "shorting_enabled":"integer",
    "equity":"decimal",
    "last_equity":"decimal",
    "long_market_value":"decimal",
    "short_market_value":"decimal",
    "initial_margin":"decimal",
    "maintenance_margin":"decimal",
    "last_maintenance_margin":"decimal",
    "sma":"decimal",
    "daytrade_count":"integer",
    "created_at":"date"
  }
}

function safe(val) {
  return val === undefined ? null : val;
}

function formatDateForMySQL(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return null; // Ritorna null se la data non è valida
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  const ms = String(d.getMilliseconds());//.padStart(3, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}.${ms}`;
}

/**
 * Sanifica un oggetto JSON in base alla tabella e mappa tipi
 * @param {string} tableName - Nome della tabella (usata per leggere il typeMap)
 * @param {Object} data - Oggetto con i dati grezzi
 * @param {Object} typeMap - Oggetto del tipo { table: { field: type } }
 * @returns {Object} - Oggetto sanificato
 */
function sanitizeData(tableName, data) {
  const sanitized = {};
  const tableMap = typeMap[tableName] || {};

  for (const key in data) {
    const type = tableMap[key];
    const value = data[key];

    if (value === undefined) {
      sanitized[key] = null; // fallback generico
    } else if (type === 'decimal' || type === 'integer') {
      sanitized[key] = (value === null || value === 'null') ? 0 : Number(value);
    } else if (type === 'date') {
      sanitized[key] = formatDateForMySQL(value);
    } else if (type === 'string') {
      sanitized[key] = safe(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT || '3306',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'Trading',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function q(sql, params) {
  const conn = await pool.getConnection()
  try { const [rows] = await conn.query(sql, params); return rows }
  finally { conn.release() }              // <-- SEMPRE
}

async function getDbConnection() {
  try {
    const conn = await pool.getConnection();
    return conn;
  } catch (err) {
    logger.error(`[getDbConnection] Errore apertura DB:`, err.message);
    throw err;
  }
}

function getDbLogStatus() { return logger.getDbLogStatus()}
function setDbLogStatus(status) { return (logger.setDbLogStatus(status))}


module.exports = {
  getDbConnection,
  safe,
  formatDateForMySQL,
  sanitizeData,
  getDbLogStatus,
  setDbLogStatus
};
