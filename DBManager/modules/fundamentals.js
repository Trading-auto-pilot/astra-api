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


module.exports = {
  insertOrUpdateFundamentalsBulk,
  getAllFundamentals,
  getFundamentalsBySymbol,
  deleteFundamentalsBySymbol,
  updateFundamentalsMomentumBulk
};