// modules/bots.js
const { getDbConnection, formatDateForMySQL, safe } = require('./core');


// Prende le ultime `limit` righe ordinate per timestamp decrescente.
// `timestampColumn` default 'ts' (cambia se la tua colonna è diversa: es. 'created_at' o 'timestamp')
// Prende le ultime `limit` righe ordinate per `timestamp` (DESC).
async function getAllLogs(limit = 100) {
  const conn = await getDbConnection();

  // valida/clampa il limite
  const n = Number(limit);
  const safeLimit = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1000) : 100;

  try {
    const sql = `
      SELECT *
      FROM \`logs\`
      WHERE \`timestamp\` IS NOT NULL
      ORDER BY \`timestamp\` DESC
      LIMIT ${safeLimit}   -- inietto intero validato
    `;
    const [rows] = await conn.query(sql);
    return rows;
  } catch (error) {
    console.error('[getAllLogs] Errore durante la lettura dei log:', error);
    throw error;
  } finally {
    try { conn.release(); } catch {}
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