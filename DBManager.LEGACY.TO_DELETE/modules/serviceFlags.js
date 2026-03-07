// modules/serviceFlags.js
"use strict";

const { getDbConnection } = require("./core");
const createLogger = require("../../shared/logger");

const MICROSERVICE = "DBManager";
const MODULE_NAME = "serviceFlags";
const MODULE_VERSION = "1.0";

const logger = createLogger(
  MICROSERVICE,
  MODULE_NAME,
  MODULE_VERSION,
  process.env.LOG_LEVEL || "info"
);

async function getAllServiceFlags() {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query("SELECT * FROM service_flags");
    logger.info(`[getAllServiceFlags] rows=${rows.length}`);
    return rows;
  } catch (err) {
    logger.error("[getAllServiceFlags] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function getServiceFlagById(id) {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query("SELECT * FROM service_flags WHERE id = ?", [id]);
    if (!rows.length) return null;
    return rows[0];
  } catch (err) {
    logger.error("[getServiceFlagById] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function createServiceFlag(payload) {
  const conn = await getDbConnection();
  try {
    const { env, microservice, enabled = 1, note = null } = payload || {};
    const [res] = await conn.query(
      `INSERT INTO service_flags (env, microservice, enabled, note)
       VALUES (?, ?, ?, ?)`,
      [env, microservice, enabled ? 1 : 0, note]
    );
    logger.info(`[createServiceFlag] id=${res.insertId}`);
    return { ok: true, id: res.insertId };
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      const dup = new Error("Service flag already exists for env+microservice");
      dup.code = "DUPLICATE";
      throw dup;
    }
    logger.error("[createServiceFlag] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function updateServiceFlag(id, payload) {
  const conn = await getDbConnection();
  try {
    const { env, microservice, enabled, note } = payload || {};
    const [res] = await conn.query(
      `UPDATE service_flags
         SET env = ?, microservice = ?, enabled = ?, note = ?, updated_at = NOW()
       WHERE id = ?`,
      [env, microservice, enabled ? 1 : 0, note ?? null, id]
    );

    logger.info(`[updateServiceFlag] id=${id} affectedRows=${res.affectedRows}`);
    return { ok: true, updated: res.affectedRows };
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      const dup = new Error("Service flag already exists for env+microservice");
      dup.code = "DUPLICATE";
      throw dup;
    }
    logger.error("[updateServiceFlag] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteServiceFlag(id) {
  const conn = await getDbConnection();
  try {
    const [res] = await conn.query("DELETE FROM service_flags WHERE id = ?", [id]);
    logger.info(`[deleteServiceFlag] id=${id} affectedRows=${res.affectedRows}`);
    return { ok: true, deleted: res.affectedRows };
  } catch (err) {
    logger.error("[deleteServiceFlag] Error", err.message || err);
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  getAllServiceFlags,
  getServiceFlagById,
  createServiceFlag,
  updateServiceFlag,
  deleteServiceFlag,
};
