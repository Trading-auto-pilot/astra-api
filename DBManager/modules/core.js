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

  for (const key in tableMap) {
    const type = tableMap[key];
    const value = data[key];

    if (type === 'decimal' || type === 'integer') {
      sanitized[key] = (value === null || value === undefined || value === 'null') ? 0 : Number(value);
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

async function getDbConnection() {
  try {
    const conn = await pool.getConnection();
    return conn;
  } catch (err) {
    logger.error(`[getDbConnection] Errore apertura DB:`, err.message);
    throw err;
  }
}


module.exports = {
  getDbConnection,
  safe,
  formatDateForMySQL,
  sanitizeData
};
