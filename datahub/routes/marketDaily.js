// routes/marketDaily.js
"use strict";

/**
 * Custom route for market_daily bulk operations
 * Mounted at /api/custom/marketDaily
 */
module.exports = function({ logger, schemaReader }) {
  const express = require('express');
  const router = express.Router();

  /**
   * POST /api/custom/marketDaily/bulk
   * Bulk upsert market_daily records
   *
   * Body: Array of market_daily records with fields:
   *   - symbol (string, required)
   *   - trade_date (date, required)
   *   - open, high, low, close, adj_close, vwap, change, change_percent (decimal, optional)
   *   - volume (bigint, optional)
   *   - source (string, optional)
   *
   * Returns: { ok: true, total: number, affectedRows: number }
   */
  router.post('/bulk', async (req, res) => {
    const fn = '[POST /api/custom/marketDaily/bulk]';

    try {
      const rows = req.body;

      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({
          ok: false,
          error: 'Body must be a non-empty array of market_daily records'
        });
      }

      logger?.debug?.(`${fn} Upserting ${rows.length} market_daily records`);

      // Build bulk INSERT ... ON DUPLICATE KEY UPDATE query
      const fields = [
        'symbol', 'trade_date', 'open', 'high', 'low', 'close',
        'adj_close', 'vwap', 'change', 'change_percent', 'volume', 'source'
      ];

      // Prepare values
      const values = [];
      const placeholders = [];

      for (const row of rows) {
        const rowValues = fields.map(field => {
          const val = row[field];
          if (val === undefined || val === null) return null;
          return val;
        });
        values.push(...rowValues);
        placeholders.push(`(${fields.map(() => '?').join(', ')})`);
      }

      // Build SQL - escape 'change' as it's a reserved keyword
      const escapedFields = fields.map(f => f === 'change' ? '`change`' : f);
      const sql = `
        INSERT INTO market_daily (${escapedFields.join(', ')})
        VALUES ${placeholders.join(', ')}
        ON DUPLICATE KEY UPDATE
          open = VALUES(open),
          high = VALUES(high),
          low = VALUES(low),
          close = VALUES(close),
          adj_close = VALUES(adj_close),
          vwap = VALUES(vwap),
          \`change\` = VALUES(\`change\`),
          change_percent = VALUES(change_percent),
          volume = VALUES(volume),
          source = VALUES(source),
          updated_at = CURRENT_TIMESTAMP
      `;

      const [result] = await schemaReader.query(sql, values);

      logger?.debug?.(`${fn} Bulk upsert complete: ${result.affectedRows} affected`);

      return res.json({
        ok: true,
        total: rows.length,
        affectedRows: result.affectedRows || 0
      });

    } catch (err) {
      logger?.error?.(`${fn} Error: ${err?.message || String(err)}`);
      logger?.error?.(`${fn} Stack: ${err?.stack}`);
      return res.status(500).json({
        ok: false,
        error: err?.message || 'Bulk upsert failed'
      });
    }
  });

  return router;
};
