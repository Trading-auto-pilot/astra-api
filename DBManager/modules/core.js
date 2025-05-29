// modules/core/db.js

const mysql = require('mysql2/promise');
const logger = require('../../shared/logger')('DBManager');

function safe(val) {
  return val === undefined ? null : val;
}

function formatDateForMySQL(date) {
  if (!date) return null;
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

async function getDbConnection() {
  try {
    return await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost',
      port: process.env.MYSQL_PORT || '3306',
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'Trading'
    });
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
