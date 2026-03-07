// modules/alertingRules.js
"use strict";

const { getDbConnection, safe, formatDateForMySQL } = require("./core");
const createLogger = require("../../shared/logger");

const MICROSERVICE = "DBManager";
const MODULE_NAME = "alertingRules";
const MODULE_VERSION = "1.0";

const logger = createLogger(
  MICROSERVICE,
  MODULE_NAME,
  MODULE_VERSION,
  process.env.LOG_LEVEL || "info"
);

const MAX_HASH_LENGTH = 255;

const normalizeHash = (value) => {
  if (value == null) return null;
  const str = String(value);
  if (str.length <= MAX_HASH_LENGTH) return str;
  logger.warning?.(
    `[alertingState] last_hash truncated from ${str.length} to ${MAX_HASH_LENGTH}`
  );
  return str.slice(0, MAX_HASH_LENGTH);
};

const parseJsonField = (value) => {
  if (value == null) return value;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const normalizeRuleRow = (row) => ({
  ...row,
  match_json: (() => {
    const match = parseJsonField(row.match_json);
    if (!match || typeof match !== "object" || Array.isArray(match)) return match;
    const hasEventKey = Boolean(match.event_key || match.eventKey);
    const rawSource = String(match.source || "").toLowerCase().trim();
    const source = rawSource === "events" || rawSource === "logs"
      ? rawSource
      : hasEventKey
        ? "events"
        : "logs";
    return { ...match, source };
  })(),
  actions_json: parseJsonField(row.actions_json),
});

const normalizeDeliveryRow = (row) => ({
  ...row,
  payload_json: parseJsonField(row.payload_json),
  response_json: parseJsonField(row.response_json),
});

async function getAllAlertingRules() {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query("SELECT * FROM alerting_rules ORDER BY id DESC");
    return rows.map(normalizeRuleRow);
  } catch (err) {
    logger.error("[getAllAlertingRules] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function getAlertingRuleById(id) {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query("SELECT * FROM alerting_rules WHERE id = ?", [id]);
    if (!rows.length) return null;
    return normalizeRuleRow(rows[0]);
  } catch (err) {
    logger.error("[getAlertingRuleById] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function createAlertingRule(payload) {
  const conn = await getDbConnection();
  try {
    const {
      name,
      enabled = 1,
      severity = "medium",
      match_json,
      actions_json,
      throttle_seconds = 0,
      max_per_window = 0,
      window_seconds = 0,
      dedup_window_seconds = 0,
      resolution_window_seconds = 0,
    } = payload || {};

    const [res] = await conn.query(
      `INSERT INTO alerting_rules
        (name, enabled, severity, match_json, actions_json, throttle_seconds, max_per_window, window_seconds, dedup_window_seconds, resolution_window_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        safe(name),
        enabled ? 1 : 0,
        safe(severity),
        JSON.stringify(match_json || {}),
        JSON.stringify(actions_json || {}),
        Number(throttle_seconds) || 0,
        Number(max_per_window) || 0,
        Number(window_seconds) || 0,
        Number(dedup_window_seconds) || 0,
        Number(resolution_window_seconds) || 0,
      ]
    );
    logger.info(`[createAlertingRule] id=${res.insertId}`);
    return { ok: true, id: res.insertId };
  } catch (err) {
    logger.error("[createAlertingRule] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function updateAlertingRule(id, payload) {
  const conn = await getDbConnection();
  try {
    const {
      name,
      enabled = 1,
      severity = "medium",
      match_json,
      actions_json,
      throttle_seconds = 0,
      max_per_window = 0,
      window_seconds = 0,
      dedup_window_seconds = 0,
      resolution_window_seconds = 0,
    } = payload || {};

    const [res] = await conn.query(
      `UPDATE alerting_rules
         SET name = ?, enabled = ?, severity = ?, match_json = ?, actions_json = ?,
             throttle_seconds = ?, max_per_window = ?, window_seconds = ?, dedup_window_seconds = ?, resolution_window_seconds = ?,
             updated_at = NOW()
       WHERE id = ?`,
      [
        safe(name),
        enabled ? 1 : 0,
        safe(severity),
        JSON.stringify(match_json || {}),
        JSON.stringify(actions_json || {}),
        Number(throttle_seconds) || 0,
        Number(max_per_window) || 0,
        Number(window_seconds) || 0,
        Number(dedup_window_seconds) || 0,
        Number(resolution_window_seconds) || 0,
        id,
      ]
    );
    logger.info(`[updateAlertingRule] id=${id} affectedRows=${res.affectedRows}`);
    return { ok: true, updated: res.affectedRows };
  } catch (err) {
    logger.error("[updateAlertingRule] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteAlertingRule(id) {
  const conn = await getDbConnection();
  try {
    const [res] = await conn.query("DELETE FROM alerting_rules WHERE id = ?", [id]);
    logger.info(`[deleteAlertingRule] id=${id} affectedRows=${res.affectedRows}`);
    return { ok: true, deleted: res.affectedRows };
  } catch (err) {
    logger.error("[deleteAlertingRule] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function getAllAlertingState() {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query("SELECT * FROM alerting_state ORDER BY id DESC");
    return rows;
  } catch (err) {
    logger.error("[getAllAlertingState] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function getAlertingStateById(id) {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query("SELECT * FROM alerting_state WHERE id = ?", [id]);
    if (!rows.length) return null;
    return rows[0];
  } catch (err) {
    logger.error("[getAlertingStateById] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function createAlertingState(payload) {
  const conn = await getDbConnection();
  try {
    const {
      rule_id,
      last_sent_at = null,
      last_matched_at = null,
      last_hash = null,
      window_start_at = null,
      window_count = 0,
      last_resolved_at = null,
    } = payload || {};
    const [res] = await conn.query(
      `INSERT INTO alerting_state
        (rule_id, last_sent_at, last_matched_at, last_hash, window_start_at, window_count, last_resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        rule_id,
        formatDateForMySQL(last_sent_at),
        formatDateForMySQL(last_matched_at),
        safe(normalizeHash(last_hash)),
        formatDateForMySQL(window_start_at),
        Number(window_count) || 0,
        formatDateForMySQL(last_resolved_at),
      ]
    );
    logger.info(`[createAlertingState] id=${res.insertId}`);
    return { ok: true, id: res.insertId };
  } catch (err) {
    logger.error("[createAlertingState] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function updateAlertingState(id, payload) {
  const conn = await getDbConnection();
  try {
    const {
      rule_id,
      last_sent_at = null,
      last_matched_at = null,
      last_hash = null,
      window_start_at = null,
      window_count = 0,
      last_resolved_at = null,
    } = payload || {};

    const [res] = await conn.query(
      `UPDATE alerting_state
         SET rule_id = ?, last_sent_at = ?, last_matched_at = ?, last_hash = ?,
             window_start_at = ?, window_count = ?, last_resolved_at = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        rule_id,
        formatDateForMySQL(last_sent_at),
        formatDateForMySQL(last_matched_at),
        safe(normalizeHash(last_hash)),
        formatDateForMySQL(window_start_at),
        Number(window_count) || 0,
        formatDateForMySQL(last_resolved_at),
        id,
      ]
    );
    logger.info(`[updateAlertingState] id=${id} affectedRows=${res.affectedRows}`);
    return { ok: true, updated: res.affectedRows };
  } catch (err) {
    logger.error("[updateAlertingState] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteAlertingState(id) {
  const conn = await getDbConnection();
  try {
    const [res] = await conn.query("DELETE FROM alerting_state WHERE id = ?", [id]);
    logger.info(`[deleteAlertingState] id=${id} affectedRows=${res.affectedRows}`);
    return { ok: true, deleted: res.affectedRows };
  } catch (err) {
    logger.error("[deleteAlertingState] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function getAllAlertingDeliveries() {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query("SELECT * FROM alerting_deliveries ORDER BY id DESC");
    return rows.map(normalizeDeliveryRow);
  } catch (err) {
    logger.error("[getAllAlertingDeliveries] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function getAlertingDeliveryById(id) {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query("SELECT * FROM alerting_deliveries WHERE id = ?", [id]);
    if (!rows.length) return null;
    return normalizeDeliveryRow(rows[0]);
  } catch (err) {
    logger.error("[getAlertingDeliveryById] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function createAlertingDelivery(payload) {
  const conn = await getDbConnection();
  try {
    const {
      rule_id,
      provider,
      status,
      message_hash = null,
      payload_json = null,
      response_json = null,
      error_text = null,
    } = payload || {};

    const [res] = await conn.query(
      `INSERT INTO alerting_deliveries
        (rule_id, provider, status, message_hash, payload_json, response_json, error_text)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        rule_id,
        safe(provider),
        safe(status),
        safe(message_hash),
        payload_json ? JSON.stringify(payload_json) : null,
        response_json ? JSON.stringify(response_json) : null,
        safe(error_text),
      ]
    );
    logger.info(`[createAlertingDelivery] id=${res.insertId}`);
    return { ok: true, id: res.insertId };
  } catch (err) {
    logger.error("[createAlertingDelivery] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function updateAlertingDelivery(id, payload) {
  const conn = await getDbConnection();
  try {
    const {
      rule_id,
      provider,
      status,
      message_hash = null,
      payload_json = null,
      response_json = null,
      error_text = null,
    } = payload || {};

    const [res] = await conn.query(
      `UPDATE alerting_deliveries
         SET rule_id = ?, provider = ?, status = ?, message_hash = ?, payload_json = ?, response_json = ?, error_text = ?
       WHERE id = ?`,
      [
        rule_id,
        safe(provider),
        safe(status),
        safe(message_hash),
        payload_json ? JSON.stringify(payload_json) : null,
        response_json ? JSON.stringify(response_json) : null,
        safe(error_text),
        id,
      ]
    );
    logger.info(`[updateAlertingDelivery] id=${id} affectedRows=${res.affectedRows}`);
    return { ok: true, updated: res.affectedRows };
  } catch (err) {
    logger.error("[updateAlertingDelivery] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteAlertingDelivery(id) {
  const conn = await getDbConnection();
  try {
    const [res] = await conn.query("DELETE FROM alerting_deliveries WHERE id = ?", [id]);
    logger.info(`[deleteAlertingDelivery] id=${id} affectedRows=${res.affectedRows}`);
    return { ok: true, deleted: res.affectedRows };
  } catch (err) {
    logger.error("[deleteAlertingDelivery] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  getAllAlertingRules,
  getAlertingRuleById,
  createAlertingRule,
  updateAlertingRule,
  deleteAlertingRule,
  getAllAlertingState,
  getAlertingStateById,
  createAlertingState,
  updateAlertingState,
  deleteAlertingState,
  getAllAlertingDeliveries,
  getAlertingDeliveryById,
  createAlertingDelivery,
  updateAlertingDelivery,
  deleteAlertingDelivery,
};
