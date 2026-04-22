"use strict";

// ---------------------------------------------------------------------------
// db.js — SQLite database initialization for the candle library
//
// Database path: $SIM_DATA_DIR/sim-library.db  (default: /data/sim-library.db)
// Table: candle_files — metadata for uploaded custom candle JSON files
// ---------------------------------------------------------------------------

const Database = require("better-sqlite3");
const path = require("path");
const fs   = require("fs");
const { getConfigString } = require("../../shared/loadSettings");

let _db = null;
let _dbPath = null;

const DDL = `
CREATE TABLE IF NOT EXISTS candle_files (
  id           INTEGER      PRIMARY KEY AUTOINCREMENT,
  filename     VARCHAR(255) NOT NULL,
  stored_path  VARCHAR(512) NOT NULL UNIQUE,
  ticker       VARCHAR(20),
  tf           VARCHAR(20),
  description  VARCHAR(500) NOT NULL DEFAULT '',
  notes        VARCHAR(2000)         DEFAULT '',
  candle_count INTEGER               DEFAULT 0,
  date_from    DATETIME,
  date_to      DATETIME,
  size_bytes   INTEGER               DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT (datetime('now'))
);
`;

function getDb() {
  if (_db) return _db;
  _dbPath = getDbPath();
  _db = new Database(_dbPath);
  _db.pragma("journal_mode = WAL");
  _db.exec(DDL);
  return _db;
}

function getDataDir() {
  const dataDir = getConfigString("SIM_DATA_DIR", "/data");
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch (_) {}
  return dataDir;
}

function getDbPath() {
  return path.join(getDataDir(), "sim-library.db");
}

module.exports = { getDb, getDataDir, getDbPath };
