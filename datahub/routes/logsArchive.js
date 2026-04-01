"use strict";

/**
 * logsArchive — archiviazione e ripristino dei log su file .ndjson.gz
 *
 * Endpoints esposti sotto /api/custom/logsArchive/
 *
 *   POST /archive          — archivia i log più vecchi di N mesi, li comprime e li elimina dal DB
 *   GET  /list             — elenca i file .ndjson.gz nella cartella archivio
 *   POST /restore/:filename — decomprime un archivio e reimporta i record nel DB
 */

const fs   = require("fs");
const path = require("path");
const zlib = require("zlib");
const readline = require("readline");

const BATCH_SIZE = 500;

/** Converte un valore in stringa MySQL datetime (YYYY-MM-DD HH:MM:SS) */
function toMysqlDatetime(val) {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d)) return null;
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** Scrive dati nel gzip stream rispettando il backpressure */
function writeWithBackpressure(gzip, data) {
  return new Promise((resolve, reject) => {
    const ok = gzip.write(data, (err) => { if (err) reject(err); });
    if (ok) return resolve();
    gzip.once("drain", resolve);
    gzip.once("error", reject);
  });
}

/** Assicura che la cartella archivio esista */
function ensureArchiveDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Restituisce un filepath non in conflitto con file esistenti.
 * Se "logs_2024-03.ndjson.gz" esiste già, prova "logs_2024-03_1.ndjson.gz",
 * poi "_2", ecc.
 */
function resolveArchiveFilepath(dir, ym) {
  const base = path.join(dir, `logs_${ym}.ndjson.gz`);
  if (!fs.existsSync(base)) return base;
  let i = 1;
  while (true) {
    const candidate = path.join(dir, `logs_${ym}_${i}.ndjson.gz`);
    if (!fs.existsSync(candidate)) return candidate;
    i++;
  }
}

module.exports = function ({ logger, schemaReader }) {
  const express = require("express");
  const router  = express.Router();

  const archiveDir = process.env.LOGS_ARCHIVE_PATH
    ? path.resolve(process.env.LOGS_ARCHIVE_PATH)
    : path.resolve(__dirname, "..", "logs-archive");

  ensureArchiveDir(archiveDir);

  // ───────────────────────────────────────────────────────────────────────────
  // POST /archive
  // Body: { months_to_keep: number }   (default: 6)
  //
  // 1. Calcola la cutoff date = oggi - months_to_keep mesi
  // 2. Esporta i log più vecchi in un file .ndjson.gz
  // 3. Elimina i record esportati dal DB
  // ───────────────────────────────────────────────────────────────────────────
  router.post("/archive", async (req, res) => {
    const monthsToKeep = parseInt(
      req.body?.months_to_keep ?? req.query?.months_to_keep ?? "6",
      10
    );
    if (!Number.isFinite(monthsToKeep) || monthsToKeep < 1) {
      return res.status(400).json({ ok: false, error: "months_to_keep deve essere un intero positivo" });
    }

    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - monthsToKeep);
    const cutoffStr = toMysqlDatetime(cutoff);

    const createdFiles = []; // traccia i file creati per cleanup in caso di errore
    try {
      // Recupera i mesi distinti da archiviare
      const [months] = await schemaReader.query(
        `SELECT DATE_FORMAT(timestamp, '%Y-%m') AS ym, COUNT(*) AS cnt
         FROM logs WHERE timestamp < ?
         GROUP BY ym ORDER BY ym`,
        [cutoffStr]
      );

      if (months.length === 0) {
        return res.json({
          ok: true, archived: 0, deleted: 0,
          message: `Nessun log più vecchio di ${monthsToKeep} mesi`,
          files: [],
        });
      }

      const filesInfo   = [];
      let   totalWritten = 0;

      for (const { ym } of months) {
        const [year, month] = ym.split("-").map(Number);

        // Intervallo del mese: [primo giorno del mese, primo giorno del mese successivo)
        const monthStart = `${ym}-01 00:00:00`;
        const monthEnd   = toMysqlDatetime(new Date(Date.UTC(year, month, 1))); // month è 1-based → corrisponde al mese successivo in UTC

        const filepath = resolveArchiveFilepath(archiveDir, ym);
        const filename = path.basename(filepath);

        const gzip       = zlib.createGzip({ level: 9 });
        const fileStream = fs.createWriteStream(filepath);
        gzip.pipe(fileStream);
        createdFiles.push(filepath);

        const fileFinished = new Promise((resolve, reject) => {
          fileStream.on("finish", resolve);
          fileStream.on("error", reject);
          gzip.on("error", reject);
        });

        let lastId  = 0;
        let written = 0;

        while (true) {
          const [rows] = await schemaReader.query(
            `SELECT * FROM logs
             WHERE timestamp >= ? AND timestamp < ? AND id > ?
             ORDER BY id
             LIMIT ?`,
            [monthStart, monthEnd, lastId, BATCH_SIZE]
          );
          if (rows.length === 0) break;

          for (const row of rows) {
            await writeWithBackpressure(gzip, JSON.stringify(row) + "\n");
          }

          written += rows.length;
          lastId   = rows[rows.length - 1].id;
          if (rows.length < BATCH_SIZE) break;
        }

        gzip.end();
        await fileFinished;

        const { size } = fs.statSync(filepath);
        filesInfo.push({ filename, ym, count: written, sizeBytes: size });
        totalWritten += written;

        logger.info(
          `[logsArchive] month=${ym} written=${written} file=${filename} size=${size}B`
        );
      }

      // Tutti i file scritti con successo — elimina i record archiviati
      const [del] = await schemaReader.query(
        "DELETE FROM logs WHERE timestamp < ?",
        [cutoffStr]
      );

      logger.info(
        `[logsArchive] archived=${totalWritten} deleted=${del.affectedRows} files=${filesInfo.length}`
      );

      return res.json({
        ok:           true,
        archived:     totalWritten,
        deleted:      del.affectedRows,
        files:        filesInfo,
        cutoffDate:   cutoffStr,
        monthsToKeep,
      });

    } catch (err) {
      // Rimuove tutti i file parziali in caso di errore
      for (const fp of createdFiles) {
        try { fs.unlinkSync(fp); } catch (_) {}
      }
      logger.error(`[logsArchive] archive failed: ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /list
  //
  // Restituisce la lista dei file .ndjson.gz nella cartella archivio
  // con nome, dimensione e date di creazione/modifica.
  // ───────────────────────────────────────────────────────────────────────────
  router.get("/list", (_req, res) => {
    try {
      ensureArchiveDir(archiveDir);
      const files = fs.readdirSync(archiveDir)
        .filter(f => f.endsWith(".ndjson.gz"))
        .map(f => {
          const stat = fs.statSync(path.join(archiveDir, f));
          return {
            filename:   f,
            sizeBytes:  stat.size,
            createdAt:  stat.birthtime.toISOString(),
            modifiedAt: stat.mtime.toISOString(),
          };
        })
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

      return res.json({ ok: true, count: files.length, items: files });
    } catch (err) {
      logger.error(`[logsArchive] list failed: ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /restore/:filename
  //
  // Legge e decomprime il file .ndjson.gz indicato,
  // poi reimporta i record nella tabella logs (senza riscrivere gli ID originali).
  // ───────────────────────────────────────────────────────────────────────────
  router.post("/restore/:filename", async (req, res) => {
    const { filename } = req.params;

    // Validazione sicurezza: evita path traversal
    if (
      !filename ||
      !filename.endsWith(".ndjson.gz") ||
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\")
    ) {
      return res.status(400).json({ ok: false, error: "Nome file non valido" });
    }

    const filepath = path.join(archiveDir, filename);
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ ok: false, error: `File non trovato: ${filename}` });
    }

    const RESTORE_COLUMNS = [
      "timestamp", "level", "functionName", "message",
      "jsonDetails", "microservice", "moduleName", "moduleVersion",
    ];

    const flush = async (batch) => {
      if (batch.length === 0) return;
      const placeholders = batch
        .map(() => `(${RESTORE_COLUMNS.map(() => "?").join(",")})`)
        .join(",");
      const values = batch.flatMap(row =>
        RESTORE_COLUMNS.map(col => {
          const val = row[col] ?? null;
          if (col === "jsonDetails" && val !== null && typeof val === "object") {
            return JSON.stringify(val);
          }
          if (col === "timestamp") return toMysqlDatetime(val);
          return val;
        })
      );
      await schemaReader.query(
        `INSERT INTO logs (${RESTORE_COLUMNS.join(",")}) VALUES ${placeholders}`,
        values
      );
    };

    try {
      const rl = readline.createInterface({
        input:     fs.createReadStream(filepath).pipe(zlib.createGunzip()),
        crlfDelay: Infinity,
      });

      let batch    = [];
      let restored = 0;

      for await (const line of rl) {
        if (!line.trim()) continue;
        let row;
        try { row = JSON.parse(line); } catch (_) { continue; }
        batch.push(row);
        if (batch.length >= BATCH_SIZE) {
          await flush(batch);
          restored += batch.length;
          batch = [];
        }
      }

      if (batch.length > 0) {
        await flush(batch);
        restored += batch.length;
      }

      fs.unlinkSync(filepath);
      logger.info(`[logsArchive] restored=${restored} from file=${filename} — file deleted`);
      return res.json({ ok: true, restored, filename });

    } catch (err) {
      logger.error(`[logsArchive] restore failed: ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  return router;
};
