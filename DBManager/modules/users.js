"use strict";

const { getDbConnection } = require("./core");
const createLogger = require("../../shared/logger");

const MICROSERVICE = "DBManager";
const MODULE_NAME = "users";
const MODULE_VERSION = "1.0";

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || "info");

async function getUserPipes(userId) {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query("SELECT * FROM user_pipes WHERE user_id = ? ORDER BY id", [userId]);
    return rows;
  } finally {
    conn.release();
  }
}

async function getUserPipeById({ id, userId }) {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query("SELECT * FROM user_pipes WHERE id = ? AND user_id = ?", [id, userId]);
    return rows[0] || null;
  } finally {
    conn.release();
  }
}

async function createUserPipe({ userId, name, description = null, enabled = 1 }) {
  const conn = await getDbConnection();
  try {
    const [res] = await conn.query(
      "INSERT INTO user_pipes (user_id, name, description, enabled) VALUES (?, ?, ?, ?)",
      [userId, name, description, enabled ? 1 : 0]
    );
    logger.info(`[createUserPipe] id=${res.insertId}`);
    return { insertId: res.insertId, affectedRows: res.affectedRows };
  } finally {
    conn.release();
  }
}

async function updateUserPipe({ id, userId, name, description = null, enabled = 1 }) {
  const conn = await getDbConnection();
  try {
    const [res] = await conn.query(
      "UPDATE user_pipes SET name = ?, description = ?, enabled = ?, updated_at = NOW() WHERE id = ? AND user_id = ?",
      [name, description, enabled ? 1 : 0, id, userId]
    );
    return { affectedRows: res.affectedRows };
  } finally {
    conn.release();
  }
}

async function deleteUserPipe({ id, userId }) {
  const conn = await getDbConnection();
  try {
    const [res] = await conn.query("DELETE FROM user_pipes WHERE id = ? AND user_id = ?", [id, userId]);
    return { affectedRows: res.affectedRows };
  } finally {
    conn.release();
  }
}

module.exports = {
  getUserPipes,
  getUserPipeById,
  createUserPipe,
  updateUserPipe,
  deleteUserPipe,
};
