// modules/core/db.js

const mysql = require('mysql2/promise');
const createLogger = require('../../shared/logger');

const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'core';
const MODULE_VERSION = '2.0';


const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

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
  formatDateForMySQL
};
