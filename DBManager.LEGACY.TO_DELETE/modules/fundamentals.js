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
      "is_etf",

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
      "last_touch_date",
    ];

    const values = [];
    const placeholders = [];

    for (const r of records) {
      // 👇 ORA leggiamo direttamente dai campi "flat" del record
      const isEtfRaw = r.is_etf ?? r.isEtf ?? null;
      const isEtf = isEtfRaw === null ? null : (isEtfRaw ? 1 : 0);
      const row = [
        r.symbol || null,
        r.sector ?? null,
        r.industry ?? null,
        r.country ?? null,
        isEtf,

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
        new Date(),
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
        is_etf              = VALUES(is_etf),

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
        last_touch_date     = VALUES(last_touch_date),
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

async function touchFundamentalsBulk(symbols) {
  if (!Array.isArray(symbols) || !symbols.length) return { updated: 0 };
  const conn = await getDbConnection();
  try {
    const placeholders = symbols.map(() => '?').join(',');
    const [res] = await conn.query(
      `UPDATE fundamentals SET last_touch_date = NOW() WHERE symbol IN (${placeholders})`,
      symbols
    );
    return { updated: res.affectedRows || 0 };
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

async function getFundamentalsHistoryByDate({ asOfDate } = {}) {
  const connection = await getDbConnection();
  try {
    if (!asOfDate) return [];
    const sql = `
      SELECT tfh.*,
             fh.sector,
             fh.industry,
             fh.country,
             fh.exchange_full_name AS exchange_full_name
        FROM ticker_fundamentals_history tfh
        LEFT JOIN fundamentals_history fh
          ON fh.symbol = tfh.symbol
         AND fh.valid_from <= tfh.as_of_date
         AND (fh.valid_to > tfh.as_of_date OR fh.valid_to IS NULL)
       WHERE DATE(tfh.as_of_date) = ?
       ORDER BY tfh.symbol ASC
    `;
    const [rows] = await connection.query(sql, [asOfDate]);
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

async function getFundamentalsHistoryRecords({ symbol = null } = {}) {
  const connection = await getDbConnection();
  try {
    let sql = "SELECT * FROM fundamentals_history";
    const params = [];
    if (symbol) {
      sql += " WHERE symbol = ?";
      params.push(symbol);
    }
    sql += " ORDER BY valid_from DESC, id DESC";
    const [rows] = await connection.query(sql, params);
    return rows.map((r) => {
      if (r.version_hash && Buffer.isBuffer(r.version_hash)) {
        r.version_hash = r.version_hash.toString("hex");
      }
      return r;
    });
  } finally {
    connection.release();
  }
}

function toVersionHash(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  const str = String(value).trim();
  if (str.length === 64) {
    try {
      return Buffer.from(str, "hex");
    } catch {
      return null;
    }
  }
  return null;
}

async function insertFundamentalsHistoryRecord(payload = {}) {
  const connection = await getDbConnection();
  try {
    const {
      symbol,
      valid_from,
      valid_to = null,
      period_end = null,
      as_of_date = null,
      last_seen_at = null,
      version_hash,
      sector = null,
      industry = null,
      country = null,
      market_cap = null,
      beta = null,
      cik = null,
      isin = null,
      cusip = null,
      exchange_full_name = null,
      is_etf = null,
      is_actively_trading = null,
      is_adr = null,
      is_fund = null,
      roe = null,
      roa = null,
      op_margin = null,
      piotroski = null,
      debt_equity = null,
      altman_z = null,
      // Technical indicators
      ret_1d = null,
      ret_5d = null,
      ret_20d = null,
      ret_60d = null,
      sma_10 = null,
      sma_20 = null,
      sma_50 = null,
      sma_200 = null,
      sma_20_slope = null,
      sma_50_slope = null,
      atr_14 = null,
      atr_14_pct = null,
      rsi_14 = null,
      avg_gap_20 = null,
      max_dd_60 = null,
      dollar_vol_20d = null,
    } = payload;

    if (!symbol || !valid_from || !version_hash) {
      return { ok: false, error: "symbol, valid_from e version_hash sono obbligatori" };
    }

    const sql = `
      INSERT INTO fundamentals_history
        (symbol, valid_from, valid_to, period_end, as_of_date, last_seen_at, version_hash,
         sector, industry, country, market_cap, beta, cik, isin, cusip, exchange_full_name,
         is_etf, is_actively_trading, is_adr, is_fund,
         roe, roa, op_margin, piotroski, debt_equity, altman_z,
         ret_1d, ret_5d, ret_20d, ret_60d,
         sma_10, sma_20, sma_50, sma_200, sma_20_slope, sma_50_slope,
         atr_14, atr_14_pct, rsi_14, avg_gap_20, max_dd_60, dollar_vol_20d)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      symbol,
      valid_from,
      valid_to,
      period_end,
      as_of_date,
      last_seen_at,
      toVersionHash(version_hash),
      sector,
      industry,
      country,
      market_cap,
      beta,
      cik,
      isin,
      cusip,
      exchange_full_name,
      is_etf,
      is_actively_trading,
      is_adr,
      is_fund,
      roe,
      roa,
      op_margin,
      piotroski,
      debt_equity,
      altman_z,
      ret_1d,
      ret_5d,
      ret_20d,
      ret_60d,
      sma_10,
      sma_20,
      sma_50,
      sma_200,
      sma_20_slope,
      sma_50_slope,
      atr_14,
      atr_14_pct,
      rsi_14,
      avg_gap_20,
      max_dd_60,
      dollar_vol_20d,
    ];
    const [res] = await connection.query(sql, params);
    return { ok: true, insertId: res.insertId, affectedRows: res.affectedRows };
  } finally {
    connection.release();
  }
}

async function updateFundamentalsHistoryRecord(id, payload = {}) {
  const connection = await getDbConnection();
  try {
    if (!Number.isFinite(Number(id))) {
      return { ok: false, error: "id non valido" };
    }

    const allowed = [
      "symbol",
      "valid_from",
      "valid_to",
      "period_end",
      "as_of_date",
      "last_seen_at",
      "version_hash",
      "sector",
      "industry",
      "country",
      "market_cap",
      "beta",
      "cik",
      "isin",
      "cusip",
      "exchange_full_name",
      "is_etf",
      "is_actively_trading",
      "is_adr",
      "is_fund",
      "roe",
      "roa",
      "op_margin",
      "piotroski",
      "debt_equity",
      "altman_z",
      // Technical indicators
      "ret_1d",
      "ret_5d",
      "ret_20d",
      "ret_60d",
      "sma_10",
      "sma_20",
      "sma_50",
      "sma_200",
      "sma_20_slope",
      "sma_50_slope",
      "atr_14",
      "atr_14_pct",
      "rsi_14",
      "avg_gap_20",
      "max_dd_60",
      "dollar_vol_20d",
    ];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (payload[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(key === "version_hash" ? toVersionHash(payload[key]) : payload[key]);
      }
    }
    if (!sets.length) return { ok: false, error: "Nessun campo da aggiornare" };
    params.push(id);
    const sql = `UPDATE fundamentals_history SET ${sets.join(", ")} WHERE id = ?`;
    const [res] = await connection.query(sql, params);
    return { ok: true, affectedRows: res.affectedRows };
  } finally {
    connection.release();
  }
}

async function deleteFundamentalsHistoryRecord(id) {
  const connection = await getDbConnection();
  try {
    const [res] = await connection.query("DELETE FROM fundamentals_history WHERE id = ?", [id]);
    return { affectedRows: res.affectedRows };
  } finally {
    connection.release();
  }
}

/**
 * CRUD market_daily
 */
async function getMarketDaily({ symbol = null, trade_date = null } = {}) {
  const connection = await getDbConnection();
  try {
    let sql = "SELECT * FROM market_daily";
    const params = [];
    const conds = [];
    if (symbol) {
      conds.push("symbol = ?");
      params.push(symbol);
    }
    if (trade_date) {
      conds.push("trade_date = ?");
      params.push(trade_date);
    }
    if (conds.length) {
      sql += " WHERE " + conds.join(" AND ");
    }
    sql += " ORDER BY trade_date DESC, symbol ASC";
    const [rows] = await connection.query(sql, params);
    return rows;
  } finally {
    connection.release();
  }
}

async function getMarketDailyLatest({ symbols = null } = {}) {
  const connection = await getDbConnection();
  try {
    const params = [];
    const where =
      Array.isArray(symbols) && symbols.length
        ? `WHERE symbol IN (${symbols.map(() => "?").join(", ")})`
        : "";
    if (Array.isArray(symbols) && symbols.length) {
      params.push(...symbols);
    }
    const sql = `
      SELECT md.*
        FROM market_daily md
        JOIN (
          SELECT symbol, MAX(trade_date) AS max_date
            FROM market_daily
            ${where}
           GROUP BY symbol
        ) t
          ON md.symbol = t.symbol
         AND md.trade_date = t.max_date
       ORDER BY md.symbol ASC
    `;
    const [rows] = await connection.query(sql, params);
    return rows;
  } finally {
    connection.release();
  }
}

async function insertMarketDailyRecord(payload = {}) {
  const connection = await getDbConnection();
  try {
    const {
      symbol,
      trade_date,
      open = null,
      high = null,
      low = null,
      close = null,
      adj_close = null,
      vwap = null,
      change = null,
      change_percent = null,
      source = null,
      volume = null
    } = payload;
    if (!symbol || !trade_date) {
      return { ok: false, error: "symbol e trade_date sono obbligatori" };
    }
    const sql = `
      INSERT INTO market_daily (symbol, trade_date, open, high, low, close, adj_close, vwap, \`change\`, change_percent, source, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        open = VALUES(open),
        high = VALUES(high),
        low = VALUES(low),
        close = VALUES(close),
        adj_close = VALUES(adj_close),
        vwap = VALUES(vwap),
        \`change\` = VALUES(\`change\`),
        change_percent = VALUES(change_percent),
        source = VALUES(source),
        volume = VALUES(volume)
    `;
    const [res] = await connection.query(sql, [
      symbol,
      trade_date,
      open,
      high,
      low,
      close,
      adj_close,
      vwap,
      change,
      change_percent,
      source,
      volume
    ]);
    return { ok: true, insertId: res.insertId, affectedRows: res.affectedRows };
  } finally {
    connection.release();
  }
}

async function insertMarketDailyBulk(payloads = []) {
  const connection = await getDbConnection();
  try {
    if (!Array.isArray(payloads) || payloads.length === 0) {
      return { ok: false, error: "payloads deve essere un array non vuoto" };
    }
    const rows = payloads.filter((p) => p?.symbol && p?.trade_date);
    if (!rows.length) {
      return { ok: false, error: "Nessun record valido (symbol, trade_date obbligatori)" };
    }
    const sql = `
      INSERT INTO market_daily
        (symbol, trade_date, open, high, low, close, adj_close, vwap, \`change\`, change_percent, source, volume)
      VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}
      ON DUPLICATE KEY UPDATE
        open = VALUES(open),
        high = VALUES(high),
        low = VALUES(low),
        close = VALUES(close),
        adj_close = VALUES(adj_close),
        vwap = VALUES(vwap),
        \`change\` = VALUES(\`change\`),
        change_percent = VALUES(change_percent),
        source = VALUES(source),
        volume = VALUES(volume)
    `;
    const params = [];
    for (const p of rows) {
      params.push(
        p.symbol,
        p.trade_date,
        p.open ?? null,
        p.high ?? null,
        p.low ?? null,
        p.close ?? null,
        p.adj_close ?? null,
        p.vwap ?? null,
        p.change ?? null,
        p.change_percent ?? null,
        p.source ?? null,
        p.volume ?? null
      );
    }
    const [res] = await connection.query(sql, params);
    return { ok: true, total: rows.length, affectedRows: res.affectedRows };
  } finally {
    connection.release();
  }
}

async function updateMarketDailyRecord(symbol, trade_date, payload = {}) {
  const connection = await getDbConnection();
  try {
    if (!symbol || !trade_date) return { ok: false, error: "symbol e trade_date sono obbligatori" };
    const allowed = [
      "open",
      "high",
      "low",
      "close",
      "adj_close",
      "vwap",
      "change",
      "change_percent",
      "source",
      "volume",
      "symbol",
      "trade_date"
    ];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (payload[key] !== undefined) {
        const col = key === "change" ? "`change`" : key;
        sets.push(`${col} = ?`);
        params.push(payload[key]);
      }
    }
    if (!sets.length) return { ok: false, error: "Nessun campo da aggiornare" };
    params.push(symbol, trade_date);
    const sql = `UPDATE market_daily SET ${sets.join(", ")} WHERE symbol = ? AND trade_date = ?`;
    const [res] = await connection.query(sql, params);
    return { ok: true, affectedRows: res.affectedRows };
  } finally {
    connection.release();
  }
}

async function deleteMarketDailyRecord(symbol, trade_date) {
  const connection = await getDbConnection();
  try {
    const [res] = await connection.query("DELETE FROM market_daily WHERE symbol = ? AND trade_date = ?", [
      symbol,
      trade_date,
    ]);
    return { affectedRows: res.affectedRows };
  } finally {
    connection.release();
  }
}

/**
 * CRUD scores_daily
 */
async function getScoresDaily({ symbol = null, score_date = null, user_id = null, pipe_id = null } = {}) {
  const connection = await getDbConnection();
  try {
    let sql = "SELECT * FROM scores_daily";
    const params = [];
    const conds = [];
    if (symbol) {
      conds.push("symbol = ?");
      params.push(symbol);
    }
    if (score_date) {
      conds.push("score_date = ?");
      params.push(score_date);
    }
    if (user_id !== null && user_id !== undefined) {
      conds.push("user_id = ?");
      params.push(user_id);
    }
    if (pipe_id !== null && pipe_id !== undefined) {
      conds.push("pipe_id = ?");
      params.push(pipe_id);
    }
    if (conds.length) sql += " WHERE " + conds.join(" AND ");
    sql += " ORDER BY score_date DESC, symbol ASC";
    const [rows] = await connection.query(sql, params);
    return rows;
  } finally {
    connection.release();
  }
}

async function getScoresDailyByUserPipeDate({ user_id, pipe_id, score_date } = {}) {
  const connection = await getDbConnection();
  try {
    if (!Number.isFinite(Number(user_id)) || !Number.isFinite(Number(pipe_id)) || !score_date) return [];
    const sql = `
      SELECT *
        FROM scores_daily
       WHERE user_id = ?
         AND pipe_id = ?
         AND score_date = ?
       ORDER BY symbol ASC
    `;
    const [rows] = await connection.query(sql, [Number(user_id), Number(pipe_id), score_date]);
    return rows;
  } finally {
    connection.release();
  }
}

async function getScoresDailyWithFundamentalsByUserPipeDate({ user_id, pipe_id, score_date } = {}) {
  const connection = await getDbConnection();
  try {
    if (!Number.isFinite(Number(user_id)) || !Number.isFinite(Number(pipe_id)) || !score_date) return [];
    const sql = `
      SELECT sd.*,
             fh.roe,
             fh.roa,
             fh.op_margin,
             fh.piotroski,
             fh.altman_z,
             fh.debt_equity,
             fh.industry,
             fh.sector,
             fh.country,
             fh.market_cap AS marketCap,
             fh.beta AS beta,
             fh.cik AS cik,
             fh.isin AS isin,
             fh.cusip AS cusip,
             fh.exchange_full_name AS exchangeFullName,
             fh.is_etf AS isEtf,
             fh.is_actively_trading AS isActivelyTrading,
             fh.is_adr AS isAdr,
             fh.is_fund AS isFund
        FROM scores_daily sd
        LEFT JOIN fundamentals_history fh
          ON fh.symbol = sd.symbol
         AND fh.valid_from <= sd.score_date
         AND (fh.valid_to > sd.score_date OR fh.valid_to IS NULL)
       WHERE sd.user_id = ?
         AND sd.pipe_id = ?
         AND sd.score_date = ?
       ORDER BY sd.symbol ASC
    `;
    const [rows] = await connection.query(sql, [Number(user_id), Number(pipe_id), score_date]);
    return rows;
  } finally {
    connection.release();
  }
}
async function insertScoresDailyRecord(payload = {}) {
  const connection = await getDbConnection();
  try {
    const {
      symbol,
      score_date,
      user_id,
      pipe_id,
      valuation_score = null,
      risk_score = null,
      momentum_score = null,
      momentum_score_short = null,
      quality_score = null,
      total_score = null,
      market_score = null,
      market_risk_score = null,
      short_risk_score = null,
      volume_score = null,
      growth_probability = null,
      model_id = null,
      model_version = null,
      fundamentals_history_id = null,
    } = payload;

    if (!symbol || !score_date || user_id === undefined || pipe_id === undefined) {
      return { ok: false, error: "symbol, score_date, user_id e pipe_id sono obbligatori" };
    }

    const sql = `
      INSERT INTO scores_daily
        (symbol, score_date, user_id, pipe_id, valuation_score, risk_score, momentum_score, momentum_score_short,
         quality_score, total_score, market_score, market_risk_score, short_risk_score, volume_score, growth_probability,
         model_id, model_version, fundamentals_history_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      symbol,
      score_date,
      user_id,
      pipe_id,
      valuation_score,
      risk_score,
      momentum_score,
      momentum_score_short,
      quality_score,
      total_score,
      market_score,
      market_risk_score,
      short_risk_score,
      volume_score,
      growth_probability,
      model_id,
      model_version,
      fundamentals_history_id,
    ];
    const [res] = await connection.query(sql, params);
    return { ok: true, insertId: res.insertId, affectedRows: res.affectedRows };
  } finally {
    connection.release();
  }
}

async function updateScoresDailyRecord(symbol, score_date, payload = {}) {
  const connection = await getDbConnection();
  try {
    const user_id = payload.user_id;
    const pipe_id = payload.pipe_id;
    if (!symbol || !score_date || user_id === undefined || pipe_id === undefined) {
      return { ok: false, error: "symbol, score_date, user_id e pipe_id sono obbligatori" };
    }
    const allowed = [
      "user_id",
      "pipe_id",
      "valuation_score",
      "risk_score",
      "momentum_score",
      "momentum_score_short",
      "quality_score",
      "total_score",
      "market_score",
      "market_risk_score",
      "short_risk_score",
      "volume_score",
      "growth_probability",
      "model_id",
      "model_version",
      "fundamentals_history_id",
      "symbol",
      "score_date",
    ];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (payload[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(payload[key]);
      }
    }
    if (!sets.length) return { ok: false, error: "Nessun campo da aggiornare" };
    params.push(symbol, score_date, user_id, pipe_id);
    const sql = `UPDATE scores_daily SET ${sets.join(", ")} WHERE symbol = ? AND score_date = ? AND user_id = ? AND pipe_id = ?`;
    const [res] = await connection.query(sql, params);
    return { ok: true, affectedRows: res.affectedRows };
  } finally {
    connection.release();
  }
}

async function deleteScoresDailyRecord(symbol, score_date, user_id, pipe_id) {
  const connection = await getDbConnection();
  try {
    const [res] = await connection.query(
      "DELETE FROM scores_daily WHERE symbol = ? AND score_date = ? AND user_id = ? AND pipe_id = ?",
      [symbol, score_date, user_id, pipe_id]
    );
    return { affectedRows: res.affectedRows };
  } finally {
    connection.release();
  }
}

async function getScoresDailyCountsByDate({ user_id, pipe_id = null } = {}) {
  const connection = await getDbConnection();
  try {
    if (!Number.isFinite(Number(user_id))) return [];
    const sql = `
      SELECT score_date, COUNT(*) AS total
        FROM scores_daily
       WHERE user_id = ?
         AND pipe_id <=> ?
       GROUP BY score_date
       ORDER BY score_date DESC
    `;
    const [rows] = await connection.query(sql, [Number(user_id), pipe_id]);
    return rows;
  } finally {
    connection.release();
  }
}

/**
 * CRUD scoring_models
 */
async function getScoringModels({ name = null } = {}) {
  const connection = await getDbConnection();
  try {
    let sql = "SELECT * FROM scoring_models";
    const params = [];
    if (name) {
      sql += " WHERE name = ?";
      params.push(name);
    }
    sql += " ORDER BY name ASC, version DESC, valid_from DESC";
    const [rows] = await connection.query(sql, params);
    return rows;
  } finally {
    connection.release();
  }
}

async function insertScoringModel(payload = {}) {
  const connection = await getDbConnection();
  try {
    const { name, version, valid_from, valid_to = null, params_json } = payload;
    if (!name || !version || !valid_from || params_json === undefined) {
      return { ok: false, error: "name, version, valid_from e params_json sono obbligatori" };
    }
    const sql = `
      INSERT INTO scoring_models (name, version, valid_from, valid_to, params_json)
      VALUES (?, ?, ?, ?, ?)
    `;
    const [res] = await connection.query(sql, [name, version, valid_from, valid_to, JSON.stringify(params_json)]);
    return { ok: true, insertId: res.insertId, affectedRows: res.affectedRows };
  } finally {
    connection.release();
  }
}

async function updateScoringModel(id, payload = {}) {
  const connection = await getDbConnection();
  try {
    if (!Number.isFinite(Number(id))) return { ok: false, error: "id non valido" };
    const allowed = ["name", "version", "valid_from", "valid_to", "params_json"];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (payload[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(key === "params_json" ? JSON.stringify(payload[key]) : payload[key]);
      }
    }
    if (!sets.length) return { ok: false, error: "Nessun campo da aggiornare" };
    params.push(id);
    const sql = `UPDATE scoring_models SET ${sets.join(", ")} WHERE id = ?`;
    const [res] = await connection.query(sql, params);
    return { ok: true, affectedRows: res.affectedRows };
  } finally {
    connection.release();
  }
}

async function deleteScoringModel(id) {
  const connection = await getDbConnection();
  try {
    const [res] = await connection.query("DELETE FROM scoring_models WHERE id = ?", [id]);
    return { affectedRows: res.affectedRows };
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

// -------------------------
// user_daily_score_jobs CRUD
// -------------------------
async function getUserDailyScoreJobs({
  id = null,
  user_id = null,
  pipe_id = null,
  job_id = null,
  status = null,
  limit = 20,
} = {}) {
  const connection = await getDbConnection();
  try {
    let sql = "SELECT * FROM user_daily_score_jobs FORCE INDEX (idx_udsj_user_id_id) WHERE 1=1";
    const params = [];
    if (id !== null && id !== undefined) {
      sql += " AND id = ?";
      params.push(id);
    } else {
      if (user_id !== null && user_id !== undefined) {
        sql += " AND user_id = ?";
        params.push(user_id);
      }
      if (pipe_id !== null && pipe_id !== undefined) {
        sql += " AND pipe_id <=> ?";
        params.push(pipe_id);
      }
      if (job_id) {
        sql += " AND job_id = ?";
        params.push(job_id);
      }
      if (status) {
        sql += " AND status = ?";
        params.push(status);
      }
    }
    sql += " ORDER BY id DESC";
    if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
      sql += " LIMIT ?";
      params.push(Number(limit));
    }
    const [rows] = await connection.query(sql, params);
    return rows;
  } finally {
    connection.release();
  }
}

async function insertUserDailyScoreJob(payload = {}) {
  const connection = await getDbConnection();
  try {
    const fields = [];
    const placeholders = [];
    const params = [];

    Object.entries(payload || {}).forEach(([key, value]) => {
      if (value === undefined) return;
      fields.push(key);
      placeholders.push("?");
      if (key === "errors_json" || key === "params_json") {
        params.push(typeof value === "string" ? value : JSON.stringify(value));
      } else {
        params.push(value);
      }
    });

    if (!fields.length) {
      return { ok: false, error: "Nessun campo da inserire" };
    }

    const sql = `INSERT INTO user_daily_score_jobs (${fields.join(", ")}) VALUES (${placeholders.join(", ")})`;
    const [result] = await connection.query(sql, params);
    return { insertId: result.insertId, affectedRows: result.affectedRows };
  } finally {
    connection.release();
  }
}

async function updateUserDailyScoreJob(id, payload = {}) {
  const connection = await getDbConnection();
  try {
    const fields = [];
    const params = [];

    Object.entries(payload || {}).forEach(([key, value]) => {
      if (value === undefined) return;
      if (key === "id") return;
      fields.push(`${key} = ?`);
      if (key === "errors_json" || key === "params_json") {
        params.push(typeof value === "string" ? value : JSON.stringify(value));
      } else {
        params.push(value);
      }
    });

    if (!fields.length) {
      return { ok: false, updated: 0, error: "Nessun campo da aggiornare" };
    }

    params.push(id);
    const sql = `UPDATE user_daily_score_jobs SET ${fields.join(", ")} WHERE id = ?`;
    const [result] = await connection.query(sql, params);
    return { affectedRows: result.affectedRows };
  } finally {
    connection.release();
  }
}

async function deleteUserDailyScoreJob(id) {
  const connection = await getDbConnection();
  try {
    const [result] = await connection.query("DELETE FROM user_daily_score_jobs WHERE id = ?", [id]);
    return { affectedRows: result.affectedRows };
  } finally {
    connection.release();
  }
}

// -------------------------
// market_daily_jobs CRUD
// -------------------------
async function getMarketDailyJobs({ id = null, job_id = null, status = null, limit = 50 } = {}) {
  const connection = await getDbConnection();
  try {
    let sql = "SELECT * FROM market_daily_jobs WHERE 1=1";
    const params = [];
    if (id !== null && id !== undefined) {
      sql += " AND id = ?";
      params.push(id);
    } else {
      if (job_id) {
        sql += " AND job_id = ?";
        params.push(job_id);
      }
      if (status) {
        sql += " AND status = ?";
        params.push(status);
      }
    }
    sql += " ORDER BY id DESC";
    if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
      sql += " LIMIT ?";
      params.push(Number(limit));
    }
    const [rows] = await connection.query(sql, params);
    return rows;
  } finally {
    connection.release();
  }
}

async function insertMarketDailyJob(payload = {}) {
  const connection = await getDbConnection();
  try {
    const fields = [];
    const placeholders = [];
    const params = [];

    Object.entries(payload || {}).forEach(([key, value]) => {
      if (value === undefined) return;
      fields.push(key);
      placeholders.push("?");
      if (key === "errors_json" || key === "params_json") {
        params.push(typeof value === "string" ? value : JSON.stringify(value));
      } else {
        params.push(value);
      }
    });

    if (!fields.length) {
      return { ok: false, error: "Nessun campo da inserire" };
    }

    const sql = `INSERT INTO market_daily_jobs (${fields.join(", ")}) VALUES (${placeholders.join(", ")})`;
    const [result] = await connection.query(sql, params);
    return { insertId: result.insertId, affectedRows: result.affectedRows };
  } finally {
    connection.release();
  }
}

async function updateMarketDailyJob(id, payload = {}) {
  const connection = await getDbConnection();
  try {
    const fields = [];
    const params = [];

    Object.entries(payload || {}).forEach(([key, value]) => {
      if (value === undefined) return;
      if (key === "id") return;
      fields.push(`${key} = ?`);
      if (key === "errors_json" || key === "params_json") {
        params.push(typeof value === "string" ? value : JSON.stringify(value));
      } else {
        params.push(value);
      }
    });

    if (!fields.length) {
      return { ok: false, updated: 0, error: "Nessun campo da aggiornare" };
    }

    params.push(id);
    const sql = `UPDATE market_daily_jobs SET ${fields.join(", ")} WHERE id = ?`;
    const [result] = await connection.query(sql, params);
    return { affectedRows: result.affectedRows };
  } finally {
    connection.release();
  }
}

async function deleteMarketDailyJob(id) {
  const connection = await getDbConnection();
  try {
    const [result] = await connection.query("DELETE FROM market_daily_jobs WHERE id = ?", [id]);
    return { affectedRows: result.affectedRows };
  } finally {
    connection.release();
  }
}

// -------------------------
// ticker_scan_jobs CRUD
// -------------------------
async function getTickerScanJobsHistory({ id = null, job_id = null, status = null, limit = 50 } = {}) {
  const connection = await getDbConnection();
  try {
    let sql = "SELECT * FROM ticker_scan_jobs WHERE 1=1";
    const params = [];
    if (id !== null && id !== undefined) {
      sql += " AND id = ?";
      params.push(id);
    } else {
      if (job_id) {
        sql += " AND job_id = ?";
        params.push(job_id);
      }
      if (status) {
        sql += " AND status = ?";
        params.push(status);
      }
    }
    sql += " ORDER BY id DESC";
    if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
      sql += " LIMIT ?";
      params.push(Number(limit));
    }
    const [rows] = await connection.query(sql, params);
    return rows;
  } finally {
    connection.release();
  }
}

async function insertTickerScanJob(payload = {}) {
  const connection = await getDbConnection();
  try {
    const fields = [];
    const placeholders = [];
    const params = [];

    Object.entries(payload || {}).forEach(([key, value]) => {
      if (value === undefined) return;
      fields.push(key);
      placeholders.push("?");
      if (key === "errors_json" || key === "params_json") {
        params.push(typeof value === "string" ? value : JSON.stringify(value));
      } else {
        params.push(value);
      }
    });

    if (!fields.length) {
      return { ok: false, error: "Nessun campo da inserire" };
    }

    const sql = `INSERT INTO ticker_scan_jobs (${fields.join(", ")}) VALUES (${placeholders.join(", ")})`;
    const [result] = await connection.query(sql, params);
    return { insertId: result.insertId, affectedRows: result.affectedRows };
  } finally {
    connection.release();
  }
}

async function updateTickerScanJob(id, payload = {}) {
  const connection = await getDbConnection();
  try {
    const fields = [];
    const params = [];

    Object.entries(payload || {}).forEach(([key, value]) => {
      if (value === undefined) return;
      if (key === "id") return;
      fields.push(`${key} = ?`);
      if (key === "errors_json" || key === "params_json") {
        params.push(typeof value === "string" ? value : JSON.stringify(value));
      } else {
        params.push(value);
      }
    });

    if (!fields.length) {
      return { ok: false, updated: 0, error: "Nessun campo da aggiornare" };
    }

    params.push(id);
    const sql = `UPDATE ticker_scan_jobs SET ${fields.join(", ")} WHERE id = ?`;
    const [result] = await connection.query(sql, params);
    return { affectedRows: result.affectedRows };
  } finally {
    connection.release();
  }
}

async function deleteTickerScanJob(id) {
  const connection = await getDbConnection();
  try {
    const [result] = await connection.query("DELETE FROM ticker_scan_jobs WHERE id = ?", [id]);
    return { affectedRows: result.affectedRows };
  } finally {
    connection.release();
  }
}

module.exports = {
  insertOrUpdateFundamentalsBulk,
  touchFundamentalsBulk,
  getAllFundamentals,
  getFundamentalsBySymbol,
  deleteFundamentalsBySymbol,
  updateFundamentalsMomentumBulk,
  insertOrUpdateFundamentalsHistoryBulk,
  getFundamentalsHistory,
  getFundamentalsHistoryByDate,
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
  getUserDailyScoreJobs,
  insertUserDailyScoreJob,
  updateUserDailyScoreJob,
  deleteUserDailyScoreJob,
  getMarketDailyJobs,
  insertMarketDailyJob,
  updateMarketDailyJob,
  deleteMarketDailyJob,
  getTickerScanJobsHistory,
  insertTickerScanJob,
  updateTickerScanJob,
  deleteTickerScanJob,
  copyDefaultUserFilters,
  deleteUserFiltersByPipe,
  getFundamentalsHistoryRecords,
  insertFundamentalsHistoryRecord,
  updateFundamentalsHistoryRecord,
  deleteFundamentalsHistoryRecord,
  getMarketDaily,
  getMarketDailyLatest,
  insertMarketDailyRecord,
  insertMarketDailyBulk,
  updateMarketDailyRecord,
  deleteMarketDailyRecord,
  getScoresDaily,
  getScoresDailyByUserPipeDate,
  getScoresDailyWithFundamentalsByUserPipeDate,
  insertScoresDailyRecord,
  updateScoresDailyRecord,
  deleteScoresDailyRecord,
  getScoresDailyCountsByDate,
  getScoringModels,
  insertScoringModel,
  updateScoringModel,
  deleteScoringModel,
};
