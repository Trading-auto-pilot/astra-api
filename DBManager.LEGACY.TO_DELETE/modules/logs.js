// modules/bots.js
const { getDbConnection, formatDateForMySQL, safe } = require('./core');


// Prende le ultime `limit` righe ordinate per `timestamp` (DESC) con offset opzionale e filtri.
async function getAllLogs(limit = 100, offset = 0, filtersOrMs = null) {
  const conn = await getDbConnection();

  // valida/clampa il limite
  const n = Number(limit);
  const safeLimit = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1000) : 100;
  const o = Number(offset);
  const safeOffset = Number.isFinite(o) && o >= 0 ? Math.floor(o) : 0;
  const filters =
    typeof filtersOrMs === "string"
      ? { microservice: filtersOrMs }
      : filtersOrMs || {};
  const ms = filters.microservice ? String(filters.microservice).trim() : null;
  const moduleName = filters.moduleName ? String(filters.moduleName).trim() : null;
  const functionName = filters.functionName ? String(filters.functionName).trim() : null;
  const levels = Array.isArray(filters.levels)
    ? filters.levels.map((lvl) => String(lvl).trim()).filter(Boolean)
    : null;
  const startDate = filters.startDate ? formatDateForMySQL(filters.startDate) : null;
  const endDate = filters.endDate ? formatDateForMySQL(filters.endDate) : null;

  try {
    const where = ["`timestamp` IS NOT NULL"];
    const params = [];
    if (ms) {
      where.push("microservice = ?");
      params.push(ms);
    }
    if (levels && levels.length > 0) {
      where.push(`level IN (${levels.map(() => "?").join(", ")})`);
      params.push(...levels);
    }
    if (moduleName) {
      where.push("moduleName = ?");
      params.push(moduleName);
    }
    if (functionName) {
      where.push("functionName = ?");
      params.push(functionName);
    }
    if (startDate) {
      where.push("`timestamp` >= ?");
      params.push(startDate);
    }
    if (endDate) {
      where.push("`timestamp` <= ?");
      params.push(endDate);
    }

    const sql = `
      SELECT *
      FROM \`logs\`
      WHERE ${where.join(" AND ")}
      ORDER BY \`timestamp\` DESC, \`id\` DESC
      LIMIT ${safeLimit} OFFSET ${safeOffset} -- inietto interi validati
    `;
    const [rows] = await conn.query(sql, params);
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
    log.jsonDetails
      ? safe(typeof log.jsonDetails === 'string' ? log.jsonDetails : JSON.stringify(log.jsonDetails))
      : null,
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
