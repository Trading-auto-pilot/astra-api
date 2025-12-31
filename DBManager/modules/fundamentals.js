const { getDbConnection } = require('./core');
const createLogger = require('../../shared/logger');

const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'fundamentals';
const MODULE_VERSION = '1.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

async function getAllFundamentals() {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.query(
      "SELECT * FROM fundamentals ORDER BY symbol ASC"
    );
    return rows;
  } finally {
    connection.release();
  }
}

async function getFundamentalsBySymbol(symbol) {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.query(
      "SELECT * FROM fundamentals WHERE symbol = ?",
      [symbol]
    );
    return rows[0] || null;
  } finally {
    connection.release();
  }
}


/**
 * Insert/Update di un array di record fundamentals nella tabella `fundamentals`.
 *
 * @param {Array<object>} records - array di oggetti come quello di NVDA
 */
async function insertOrUpdateFundamentalsBulk(records) {

  if (!Array.isArray(records) || records.length === 0) {
    logger.log("[insertOrUpdateFundamentalsBulk] Nessun record da processare");
    return { affectedRows: 0, records: 0 };
  }

  const connection = await getDbConnection();

  try {
    const columns = [
      "symbol",
      "sector",
      "industry",
      "country",

      "valuation_score",
      "quality_score",
      "risk_score",
      "momentum_score",
      "total_score",

      "pe",
      "pb",
      "dcf_upside",
      "pe_score",
      "pb_score",
      "dcf_score",
      "rating_score",

      "roe",
      "roa",
      "op_margin",
      "piotroski",
      "roe_score",
      "roa_score",
      "op_margin_score",
      "piot_score",

      "beta",
      "debt_equity",
      "altman_z",
      "beta_score",
      "debt_equity_score",
      "altman_z_score",

      "momentum_json",
    ];

    const values = [];
    const placeholders = [];

    for (const r of records) {
      // 👇 ORA leggiamo direttamente dai campi "flat" del record
      const row = [
        r.symbol || null,
        r.sector ?? null,
        r.industry ?? null,
        r.country ?? null,

        r.valuation_score ?? null,
        r.quality_score ?? null,
        r.risk_score ?? null,
        r.momentum_score ?? null,
        r.total_score ?? null,

        r.pe ?? null,
        r.pb ?? null,
        r.dcf_upside ?? null,
        r.pe_score ?? null,
        r.pb_score ?? null,
        r.dcf_score ?? null,
        r.rating_score ?? null,

        r.roe ?? null,
        r.roa ?? null,
        r.op_margin ?? null,
        r.piotroski ?? null,
        r.roe_score ?? null,
        r.roa_score ?? null,
        r.op_margin_score ?? null,
        r.piot_score ?? null,

        r.beta ?? null,
        r.debt_equity ?? null,
        r.altman_z ?? null,
        r.beta_score ?? null,
        r.debt_equity_score ?? null,
        r.altman_z_score ?? null,

        r.momentum_json ?? null,
      ];

      values.push(...row);
      placeholders.push(`(${columns.map(() => "?").join(",")})`);
    }

    const sql = `
      INSERT INTO fundamentals (
        ${columns.join(",")}
      ) VALUES
        ${placeholders.join(",")}
      ON DUPLICATE KEY UPDATE
        sector              = VALUES(sector),
        industry            = VALUES(industry),
        country             = VALUES(country),

        valuation_score     = VALUES(valuation_score),
        quality_score       = VALUES(quality_score),
        risk_score          = VALUES(risk_score),
        momentum_score      = VALUES(momentum_score),
        total_score         = VALUES(total_score),

        pe                  = VALUES(pe),
        pb                  = VALUES(pb),
        dcf_upside          = VALUES(dcf_upside),
        pe_score            = VALUES(pe_score),
        pb_score            = VALUES(pb_score),
        dcf_score           = VALUES(dcf_score),
        rating_score        = VALUES(rating_score),

        roe                 = VALUES(roe),
        roa                 = VALUES(roa),
        op_margin           = VALUES(op_margin),
        piotroski           = VALUES(piotroski),
        roe_score           = VALUES(roe_score),
        roa_score           = VALUES(roa_score),
        op_margin_score     = VALUES(op_margin_score),
        piot_score          = VALUES(piot_score),

        beta                = VALUES(beta),
        debt_equity         = VALUES(debt_equity),
        altman_z            = VALUES(altman_z),
        beta_score          = VALUES(beta_score),
        debt_equity_score   = VALUES(debt_equity_score),
        altman_z_score      = VALUES(altman_z_score),

        momentum_json       = VALUES(momentum_json),
        updated_at          = CURRENT_TIMESTAMP
    `;

    const [result] = await connection.query(sql, values);

    logger.log(
      `[insertOrUpdateFundamentalsBulk] Processati ${records.length} record, affectedRows=${result.affectedRows}`
    );

    return {
      records: records.length,
      affectedRows: result.affectedRows,
    };
  } catch (err) {
    logger.error(
      `[insertOrUpdateFundamentalsBulk] Errore:`,
      err.message
    );
    throw err;
  } finally {
    connection.release();
  }
}


async function deleteFundamentalsBySymbol(symbol) {
  const connection = await getDbConnection();
  try {
    const [result] = await connection.query(
      "DELETE FROM fundamentals WHERE symbol = ?",
      [symbol]
    );

    logger.log(
      `[deleteFundamentalsBySymbol] Deleted fundamentals for ${symbol}, affectedRows=${result.affectedRows}`
    );

    return { symbol, affectedRows: result.affectedRows };
  } catch (err) {
    logger.error(
      `[deleteFundamentalsBySymbol] Error for ${symbol}:`,
      err.message
    );
    throw err;
  } finally {
    connection.release();
  }
}

async function updateFundamentalsMomentumBulk(records) {
  const conn = await getDbConnection();
  try {
    let updated = 0;

    for (const r of records) {
      const { symbol, momentum } = r;
      if (!symbol || !momentum) continue;

      const momentumJson = JSON.stringify(momentum);
      const momentumScore = momentum.score ?? null;

      const [res] = await conn.query(
        `
        UPDATE fundamentals
        SET momentum_json = ?, momentum_score = ?, updated_at = NOW()
        WHERE symbol = ?
        `,
        [momentumJson, momentumScore, symbol]
      );

      updated += res.affectedRows || 0;
    }

    return { updated };
  } finally {
    conn.release();
  }
}

async function insertOrUpdateFundamentalsHistoryBulk(records) {
  if (!Array.isArray(records) || !records.length) {
    logger.log("[insertOrUpdateFundamentalsHistoryBulk] Nessun record da processare");
    return { affectedRows: 0, records: 0 };
  }

  const connection = await getDbConnection();
  try {
    const columns = [
      "symbol",
      "as_of_date",
      "price",
      "beta",
      "pe",
      "pb",
      "roe",
      "roa",
      "op_margin",
      "debt_equity",
      "altman_z",
      "piotroski",
      "dcf_upside",
      "valuation_score",
      "quality_score",
      "risk_score",
      "momentum_score",
      "momentum_short_score",
      "momentum_volume_score",
      "market_score",
      "market_risk_score",
      "short_risk_score",
      "total_score",
      "growth_probability",
      "volume_score",
      "momentum_json",
      "profile_json",
      "ratios_json",
      "scores_json",
      "dcf_json",
    ];

    const values = [];
    const placeholders = [];

    for (const r of records) {
      const row = [
        r.symbol || null,
        r.as_of_date || r.asOfDate || null,
        r.price ?? null,
        r.beta ?? null,
        r.pe ?? null,
        r.pb ?? null,
        r.roe ?? null,
        r.roa ?? null,
        r.op_margin ?? null,
        r.debt_equity ?? null,
        r.altman_z ?? null,
        r.piotroski ?? null,
        r.dcf_upside ?? null,
        r.valuation_score ?? null,
        r.quality_score ?? null,
        r.risk_score ?? null,
        r.momentum_score ?? null,
        r.momentum_short_score ?? null,
        r.momentum_volume_score ?? null,
        r.market_score ?? null,
        r.market_risk_score ?? null,
        r.short_risk_score ?? null,
        r.total_score ?? null,
        r.growth_probability ?? null,
        r.volume_score ?? null,
        r.momentum_json ? JSON.stringify(r.momentum_json) : null,
        r.profile_json ? JSON.stringify(r.profile_json) : null,
        r.ratios_json ? JSON.stringify(r.ratios_json) : null,
        r.scores_json ? JSON.stringify(r.scores_json) : null,
        r.dcf_json ? JSON.stringify(r.dcf_json) : null,
      ];
      values.push(...row);
      placeholders.push(`(${columns.map(() => "?").join(",")})`);
    }

    const sql = `
      INSERT INTO ticker_fundamentals_history (
        ${columns.join(",")}
      ) VALUES
        ${placeholders.join(",")}
      ON DUPLICATE KEY UPDATE
        price                = VALUES(price),
        beta                 = VALUES(beta),
        pe                   = VALUES(pe),
        pb                   = VALUES(pb),
        roe                  = VALUES(roe),
        roa                  = VALUES(roa),
        op_margin            = VALUES(op_margin),
        debt_equity          = VALUES(debt_equity),
        altman_z             = VALUES(altman_z),
        piotroski            = VALUES(piotroski),
        dcf_upside           = VALUES(dcf_upside),
        valuation_score      = VALUES(valuation_score),
        quality_score        = VALUES(quality_score),
        risk_score           = VALUES(risk_score),
        momentum_score       = VALUES(momentum_score),
        momentum_short_score = VALUES(momentum_short_score),
        momentum_volume_score= VALUES(momentum_volume_score),
        market_score         = VALUES(market_score),
        market_risk_score    = VALUES(market_risk_score),
        short_risk_score     = VALUES(short_risk_score),
        total_score          = VALUES(total_score),
        growth_probability   = VALUES(growth_probability),
        volume_score         = VALUES(volume_score),
        momentum_json        = VALUES(momentum_json),
        profile_json         = VALUES(profile_json),
        ratios_json          = VALUES(ratios_json),
        scores_json          = VALUES(scores_json),
        dcf_json             = VALUES(dcf_json)
    `;

    const [result] = await connection.query(sql, values);

    logger.log(
      `[insertOrUpdateFundamentalsHistoryBulk] Processati ${records.length} record, affectedRows=${result.affectedRows}`
    );

    return { records: records.length, affectedRows: result.affectedRows };
  } catch (err) {
    logger.error("[insertOrUpdateFundamentalsHistoryBulk] Errore:", err.message);
    throw err;
  } finally {
    connection.release();
  }
}

async function getFundamentalsHistory({ symbol = null, limitDays = 70 } = {}) {
  const connection = await getDbConnection();
  try {
    const args = [];
    let where = "";
    if (symbol) {
      where = "WHERE symbol = ?";
      args.push(symbol);
    }
    const limitClause = Number.isFinite(limitDays) ? "AND as_of_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)" : "";
    if (limitClause) args.push(limitDays);

    const sql = `
      SELECT *
      FROM ticker_fundamentals_history
      ${where ? where : ""}
      ${where ? limitClause : limitClause.replace("AND", "WHERE")}
      ORDER BY as_of_date DESC, symbol ASC
    `;
    const [rows] = await connection.query(sql, args);
    return rows;
  } finally {
    connection.release();
  }
}


async function getUserFilters(userId, pipeId = null) {
  const connection = await getDbConnection();
  try {
    let sql =
      "SELECT id, user_id, pipe_id, filter_name, value, comparator, enabled, created_at, updated_at FROM user_filters WHERE user_id = ?";
    const params = [userId];
    if (pipeId !== null && pipeId !== undefined) {
      sql += " AND pipe_id <=> ?";
      params.push(pipeId);
    }
    const [rows] = await connection.query(sql, params);
    return rows;
  } finally {
    connection.release();
  }
}

async function upsertUserFilter({ userId, filterName, value, comparator = "GT", enabled = true, pipeId = null }) {
  const connection = await getDbConnection();
  try {
    const comp = comparator === "LT" ? "LT" : "GT";
    const en = enabled ? 1 : 0;
    const sql = `
      INSERT INTO user_filters (user_id, pipe_id, filter_name, value, comparator, enabled)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE value = VALUES(value), comparator = VALUES(comparator), enabled = VALUES(enabled), pipe_id = VALUES(pipe_id)
    `;
    const [result] = await connection.query(sql, [userId, pipeId, filterName, value, comp, en]);
    return { affectedRows: result.affectedRows, insertId: result.insertId };
  } finally {
    connection.release();
  }
}

async function deleteUserFilter({ userId, filterName, pipeId = null }) {
  const connection = await getDbConnection();
  try {
    const [result] = await connection.query(
      "DELETE FROM user_filters WHERE user_id = ? AND filter_name = ? AND (pipe_id <=> ?)",
      [userId, filterName, pipeId]
    );
    return { affectedRows: result.affectedRows };
  } finally {
    connection.release();
  }
}

async function deleteUserFiltersByUser(userId) {
  const connection = await getDbConnection();
  try {
    const [result] = await connection.query("DELETE FROM user_filters WHERE user_id = ?", [userId]);
    return { affectedRows: result.affectedRows };
  } finally {
    connection.release();
  }
}

async function deleteUserFiltersByPipe(userId, pipeId) {
  const connection = await getDbConnection();
  try {
    const [result] = await connection.query(
      "DELETE FROM user_filters WHERE user_id = ? AND pipe_id <=> ?",
      [userId, pipeId]
    );
    return { affectedRows: result.affectedRows };
  } finally {
    connection.release();
  }
}

/**
 * Duplica i filtri di default (user_id=0, pipe_id=0) per uno user/pipe specifico.
 */
async function copyDefaultUserFilters(userId, pipeId) {
  const connection = await getDbConnection();
  try {
    const sql = `
      INSERT INTO user_filters (user_id, pipe_id, filter_name, value, comparator, enabled)
      SELECT ?, ?, filter_name, value, comparator, enabled
        FROM user_filters
       WHERE user_id = 0
         AND pipe_id = 0
    `;
    const [result] = await connection.query(sql, [userId, pipeId]);
    return { affectedRows: result.affectedRows, insertId: result.insertId };
  } finally {
    connection.release();
  }
}

async function getUserFundamentals({ userId, symbol = null }) {
  const connection = await getDbConnection();
  try {
    const args = [userId];
    let where = "WHERE uf.user_id = ?";
    if (symbol) {
      where += " AND uf.symbol = ?";
      args.push(symbol);
    }
    const sql = `
      SELECT uf.id, uf.user_id, uf.symbol,
             uf.valuation_score, uf.quality_score, uf.risk_score, uf.momentum_score, uf.momentum_short_score,
             uf.grow_score, uf.double_top_score,
             uf.created_at, uf.updated_at
      FROM user_fundamentals uf
      ${where}
      ORDER BY uf.symbol ASC
    `;
    const [rows] = await connection.query(sql, args);
    return rows;
  } finally {
    connection.release();
  }
}

async function upsertUserFundamental({
  userId,
  symbol,
  valuation_score = null,
  quality_score = null,
  risk_score = null,
  momentum_score = null,
  grow_score = null,
  double_top_score = null,
  momentum_short_score = null,
}) {
  const connection = await getDbConnection();
  try {
    const sql = `
      INSERT INTO user_fundamentals
        (user_id, symbol, valuation_score, quality_score, risk_score, momentum_score, momentum_short_score, grow_score, double_top_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        valuation_score = VALUES(valuation_score),
        quality_score   = VALUES(quality_score),
        risk_score      = VALUES(risk_score),
        momentum_score  = VALUES(momentum_score),
        momentum_short_score = VALUES(momentum_short_score),
        grow_score      = VALUES(grow_score),
        double_top_score= VALUES(double_top_score)
    `;
    const params = [
      userId,
      symbol,
      valuation_score,
      quality_score,
      risk_score,
      momentum_score,
      momentum_short_score,
      grow_score,
      double_top_score,
    ];
    const [result] = await connection.query(sql, params);
    return { affectedRows: result.affectedRows, insertId: result.insertId };
  } finally {
    connection.release();
  }
}

async function deleteUserFundamental({ userId, symbol }) {
  const connection = await getDbConnection();
  try {
    const [result] = await connection.query("DELETE FROM user_fundamentals WHERE user_id = ? AND symbol = ?", [
      userId,
      symbol,
    ]);
    return { affectedRows: result.affectedRows };
  } finally {
    connection.release();
  }
}

async function deleteUserFundamentalsByUser(userId) {
  const connection = await getDbConnection();
  try {
    const [result] = await connection.query("DELETE FROM user_fundamentals WHERE user_id = ?", [userId]);
    return { affectedRows: result.affectedRows };
  } finally {
    connection.release();
  }
}

async function getUserFundamentalsView({ userId }) {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.query(
      `
        SELECT v.*
        FROM v_user_fundamentals v
        WHERE v.user_user_id = ?
      `,
      [userId]
    );
    return rows;
  } finally {
    connection.release();
  }
}

// -------------------------
// user_order_by CRUD
// -------------------------
async function getUserOrderBy(userId, pipeId = null) {
  const connection = await getDbConnection();
  try {
    let sql = 'SELECT * FROM user_order_by WHERE user_id = ?';
    const params = [userId];
    if (pipeId !== null && pipeId !== undefined) {
      sql += ' AND pipe_id <=> ?';
      params.push(pipeId);
    }
    sql += ' ORDER BY order_id ASC, id ASC';
    const [rows] = await connection.query(sql, params);
    return rows;
  } finally {
    connection.release();
  }
}

async function insertUserOrderBy({ userId, order_field, direction, order_id = 1, pipe_id = null }) {
  const connection = await getDbConnection();
  try {
    const [result] = await connection.query(
      'INSERT INTO user_order_by (user_id, pipe_id, order_field, direction, order_id) VALUES (?, ?, ?, ?, ?)',
      [userId, pipe_id, order_field, direction, order_id]
    );
    return { insertId: result.insertId, affectedRows: result.affectedRows };
  } finally {
    connection.release();
  }
}

async function updateUserOrderBy({ id, userId, order_field, direction, order_id = 1, pipe_id = null }) {
  const connection = await getDbConnection();
  try {
    const [result] = await connection.query(
      'UPDATE user_order_by SET order_field = ?, direction = ?, order_id = ?, pipe_id = ? WHERE id = ? AND user_id = ?',
      [order_field, direction, order_id, pipe_id, id, userId]
    );
    return { affectedRows: result.affectedRows };
  } finally {
    connection.release();
  }
}

async function deleteUserOrderBy({ id, userId, pipeId = null }) {
  const connection = await getDbConnection();
  try {
    let sql = 'DELETE FROM user_order_by WHERE id = ? AND user_id = ?';
    const params = [id, userId];
    if (pipeId !== null && pipeId !== undefined) {
      sql += ' AND pipe_id <=> ?';
      params.push(pipeId);
    }
    const [result] = await connection.query(sql, params);
    return { affectedRows: result.affectedRows };
  } finally {
    connection.release();
  }
}

module.exports = {
  insertOrUpdateFundamentalsBulk,
  getAllFundamentals,
  getFundamentalsBySymbol,
  deleteFundamentalsBySymbol,
  updateFundamentalsMomentumBulk,
  insertOrUpdateFundamentalsHistoryBulk,
  getFundamentalsHistory,
  getUserFilters,
  upsertUserFilter,
  deleteUserFilter,
  deleteUserFiltersByUser,
  getUserFundamentals,
  upsertUserFundamental,
  deleteUserFundamental,
  deleteUserFundamentalsByUser,
  getUserFundamentalsView,
  getUserOrderBy,
  insertUserOrderBy,
  updateUserOrderBy,
  deleteUserOrderBy,
  copyDefaultUserFilters,
  deleteUserFiltersByPipe,
};
