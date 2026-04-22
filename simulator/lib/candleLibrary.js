"use strict";

// ---------------------------------------------------------------------------
// candleLibrary.js — persistent library of custom candle JSON files
//
// Uploaded files are stored in $SIM_DATA_DIR/candle-uploads/
// Metadata (description, notes, ticker, tf, counts) is stored in SQLite.
// ---------------------------------------------------------------------------

const fs   = require("fs");
const path = require("path");
const { getDb, getDataDir } = require("./db");
const { normalizeCandle } = require("./candleFetcher");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _parseAndValidate(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error("Il file deve contenere un array JSON di candele");
  }
  if (data.length === 0) {
    throw new Error("Il file è vuoto (array con 0 candele)");
  }
  // Normalize to verify basic structure
  const normalized = data.map(normalizeCandle).filter(Boolean);
  if (normalized.length === 0) {
    throw new Error("Nessuna candela valida trovata nel file");
  }
  // Sort by timestamp to find date range
  normalized.sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
  return {
    candles: normalized,
    count: normalized.length,
    dateFrom: normalized[0].t,
    dateTo:   normalized[normalized.length - 1].t,
  };
}

function getUploadDir() {
  const uploadDir = path.join(getDataDir(), "candle-uploads");
  try { fs.mkdirSync(uploadDir, { recursive: true }); } catch (_) {}
  return uploadDir;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all candle files in the library.
 * @returns {object[]}
 */
function listFiles() {
  const db = getDb();
  return db.prepare("SELECT * FROM candle_files ORDER BY created_at DESC").all();
}

/**
 * Get a single candle file record by id.
 * @param {number} id
 * @returns {object|null}
 */
function getFile(id) {
  const db = getDb();
  return db.prepare("SELECT * FROM candle_files WHERE id = ?").get(Number(id)) ?? null;
}

/**
 * Save an uploaded file to disk, validate it, and insert a record in the DB.
 *
 * @param {object} opts
 *   - tmpPath      {string}  temporary path from multer
 *   - originalName {string}  original filename from the upload
 *   - description  {string}  required
 *   - notes        {string}  optional
 *   - ticker       {string}  optional
 *   - tf           {string}  optional
 * @returns {object}  the inserted DB record
 * @throws  if the file is not valid JSON or missing required fields
 */
function saveFile({ tmpPath, originalName, description, notes, ticker, tf }) {
  if (!description || !String(description).trim()) {
    throw new Error("description è obbligatorio");
  }

  // Validate and parse
  const { count, dateFrom, dateTo } = _parseAndValidate(tmpPath);

  const sizeBytes = fs.statSync(tmpPath).size;

  // Build a unique filename: timestamp + original name (sanitized)
  const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storedName = `${Date.now()}_${safe}`;
  const storedPath = path.join(getUploadDir(), storedName);

  // Move tmp file to permanent location (use copy+delete to handle cross-device moves)
  try {
    fs.renameSync(tmpPath, storedPath);
  } catch (renameErr) {
    if (renameErr.code === "EXDEV") {
      fs.copyFileSync(tmpPath, storedPath);
      fs.unlinkSync(tmpPath);
    } else {
      throw renameErr;
    }
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO candle_files (filename, stored_path, ticker, tf, description, notes, candle_count, date_from, date_to, size_bytes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    originalName,
    storedPath,
    ticker ? String(ticker).toUpperCase() : null,
    tf    ? String(tf) : null,
    String(description).trim(),
    notes ? String(notes).trim() : null,
    count,
    dateFrom,
    dateTo,
    sizeBytes
  );

  return getFile(result.lastInsertRowid);
}

/**
 * Delete a candle file record and remove the file from disk.
 * @param {number} id
 * @returns {boolean}  true if found and deleted
 */
function deleteFile(id) {
  const db = getDb();
  const row = getFile(id);
  if (!row) return false;

  // Remove physical file (non-fatal if already gone)
  try { fs.unlinkSync(row.stored_path); } catch (_) {}

  db.prepare("DELETE FROM candle_files WHERE id = ?").run(Number(id));
  return true;
}

/**
 * Read and return the normalized candle array from a library file.
 * @param {number} id
 * @returns {object[]}  normalized candles { t, o, h, l, c, v }
 * @throws  if file not found in DB or on disk
 */
function readCandles(id) {
  const row = getFile(id);
  if (!row) throw new Error(`Candle file id=${id} not found`);
  const { candles } = _parseAndValidate(row.stored_path);
  return candles;
}

module.exports = { listFiles, getFile, saveFile, deleteFile, readCandles, getUploadDir };
