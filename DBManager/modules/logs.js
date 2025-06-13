// modules/bots.js
const { getDbConnection, formatDateForMySQL, safe } = require('./core');


async function getAllLogs() {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.execute("SELECT * FROM logs");
    return rows;
  } catch (error) {
    console.error('[getActiveBots] Errore durante il recupero dei bot attivi:', error);
    throw error;
  } finally {
      connection.release();
  }
}

async function insertLogs(logs) {
  if (!logs || logs.length === 0) return { success: false, error: 'Log array is empty' };
  const conn = await getDbConnection();
  const fields = [
    'timestamp',
    'level',
    'functionName',
    'message',
    'jsonDetails',
    'microservice',
    'moduleName',
    'moduleVersion'
  ];

  const placeholders = logs.map(() => `(${fields.map(() => '?').join(', ')})`).join(', ');

  const values = logs.flatMap(log => [
    safe(formatDateForMySQL(log.timestamp)),
    safe(log.level),
    safe(log.functionName),
    safe(log.message),
    log.jsonDetails ? safe(log.jsonDetails) : null,
    safe(log.microservice),
    safe(log.moduleName),
    safe(log.moduleVersion)
  ]);

  const sql = `INSERT INTO logs (${fields.join(', ')}) VALUES ${placeholders}`;

  try {
    
    await conn.execute(sql, values);
    return { success: true };
  } catch (err) {
    console.error('[insertLogs]', err.message);
    return { success: false, error: err.message };
  } finally {
      conn.release();
  }
}


module.exports = {
  getAllLogs,
  insertLogs
};