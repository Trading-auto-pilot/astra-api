"use strict";

// ---------------------------------------------------------------------------
// routes/candleLibrary.js — Custom candle file library endpoints
//
// Mounted at /sim/library by server.js.
//
// GET    /sim/library              — list all uploaded files
// GET    /sim/library/:id          — get single file metadata
// GET    /sim/library/:id/candles  — stream candles array from file
// POST   /sim/library/upload       — upload JSON file (multipart/form-data)
//                                    fields: file, description, notes, ticker?, tf?
// DELETE /sim/library/:id          — delete file + remove from disk
// ---------------------------------------------------------------------------

const express = require("express");
const multer  = require("multer");
const os      = require("os");
const library = require("../lib/candleLibrary");

// multer: store to OS tmp first; candleLibrary.saveFile() moves it to permanent location
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
  fileFilter(_req, file, cb) {
    if (file.mimetype === "application/json" || file.originalname.endsWith(".json")) {
      cb(null, true);
    } else {
      cb(new Error("Solo file JSON sono accettati"));
    }
  },
});

function createCandleLibraryRouter({ logger } = {}) {
  const router = express.Router();

  // GET /sim/library — list all files
  router.get("/", (_req, res) => {
    try {
      const files = library.listFiles();
      return res.json({ ok: true, files });
    } catch (err) {
      logger?.warning?.(`[GET /sim/library] ${err?.message}`);
      return res.status(500).json({ ok: false, error: err?.message || "List failed" });
    }
  });

  // GET /sim/library/:id — single file metadata
  router.get("/:id", (req, res) => {
    try {
      const file = library.getFile(Number(req.params.id));
      if (!file) return res.status(404).json({ ok: false, error: "File not found" });
      return res.json({ ok: true, file });
    } catch (err) {
      logger?.warning?.(`[GET /sim/library/:id] ${err?.message}`);
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // GET /sim/library/:id/candles — return candle array (for preview / manual use)
  router.get("/:id/candles", (req, res) => {
    try {
      const candles = library.readCandles(Number(req.params.id));
      return res.json({ ok: true, count: candles.length, candles });
    } catch (err) {
      logger?.warning?.(`[GET /sim/library/:id/candles] ${err?.message}`);
      return res.status(404).json({ ok: false, error: err?.message });
    }
  });

  // POST /sim/library/upload — multipart upload
  router.post(
    "/upload",
    upload.single("file"),
    (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ ok: false, error: "Nessun file ricevuto (campo 'file' mancante)" });
        }

        const { description, notes, ticker, tf } = req.body || {};

        const record = library.saveFile({
          tmpPath:      req.file.path,
          originalName: req.file.originalname,
          description,
          notes,
          ticker,
          tf,
        });

        logger?.info?.(`[sim/library] upload ok id=${record.id} file=${record.filename} candles=${record.candle_count}`);
        return res.status(201).json({ ok: true, file: record });
      } catch (err) {
        // Clean up tmp file if still present
        try { if (req.file?.path) require("fs").unlinkSync(req.file.path); } catch (_) {}
        logger?.warning?.(`[POST /sim/library/upload] ${err?.message}`);
        const status = err?.message?.includes("obbligatorio") || err?.message?.includes("valida") ? 400 : 500;
        return res.status(status).json({ ok: false, error: err?.message || "Upload failed" });
      }
    }
  );

  // DELETE /sim/library/:id
  router.delete("/:id", (req, res) => {
    try {
      const deleted = library.deleteFile(Number(req.params.id));
      if (!deleted) return res.status(404).json({ ok: false, error: "File not found" });
      logger?.info?.(`[sim/library] deleted id=${req.params.id}`);
      return res.json({ ok: true });
    } catch (err) {
      logger?.warning?.(`[DELETE /sim/library/:id] ${err?.message}`);
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  return router;
}

module.exports = createCandleLibraryRouter;
