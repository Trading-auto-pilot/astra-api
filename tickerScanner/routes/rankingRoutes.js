"use strict";

const axios = require("axios");
const { Router } = require("express");
const { createDatahubAdapter } = require("../../shared/datahubAdapter");
const { createRankingDailyService } = require("../lib/rankingDailyService");
const { getSetting } = require("../../shared/loadSettings");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const safeStringify = (val) => {
  if (val === undefined) return "";
  if (typeof val === "string") return val;
  try { return JSON.stringify(val); } catch { return String(val); }
};

/**
 * buildRankingRouter — routes for daily ranking snapshots
 * Mounts at /fundamentals
 *
 *   POST /fundamentals/ranking/daily
 *   GET  /fundamentals/ranking/daily?score_date=YYYY-MM-DD
 */
module.exports = function buildRankingRouter({ logger }) {
  const router = Router();

  const dbmanagerUrl = (process.env.DATAHUB_URL || process.env.DBMANAGER_URL || "http://datahub:3000").replace(/\/+$/, "");
  const datahubAxios = createDatahubAdapter(axios.create({ baseURL: dbmanagerUrl, timeout: 30000 }));

  const rankingSvc = createRankingDailyService({ logger, datahubAxios });

  // POST /fundamentals/ranking/daily
  // Body: { score_date, mode?, limits?, filters? }
  router.post("/ranking/daily", async (req, res) => {
    const fn = "ranking.POST:/ranking/daily";
    try {
      const { mode, limits, filters } = req.body || {};
      const score_date = req.body?.score_date || new Date().toISOString().slice(0, 10);
      logger.info(`${fn} score_date=${score_date} mode=${mode || "normal"}`);

      if (!DATE_RE.test(score_date)) {
        return res.status(400).json({ ok: false, error: "score_date non valida (YYYY-MM-DD)" });
      }

      const effectiveMode = mode === "force" ? "force" : "normal";

      // Legge min_intraday_vol da settings e lo usa come default per min_dollar_vol
      // se non già fornito esplicitamente nella request
      const effectiveFilters = filters && typeof filters === "object" ? { ...filters } : {};
      if (effectiveFilters.min_dollar_vol == null) {
        try {
          const minVol = getSetting("min_intraday_vol");
          if (minVol != null) {
            const minVolNum = Number(minVol);
            if (Number.isFinite(minVolNum) && minVolNum > 0) {
              effectiveFilters.min_dollar_vol = minVolNum;
              logger.info(`${fn} filtro liquidità da settings: min_dollar_vol=${minVolNum}`);
            }
          }
        } catch {
          // settings non ancora caricati — filtro disabilitato
        }
      }

      const result = await rankingSvc.buildDailyRankingSnapshot({
        scoreDate:  score_date,
        mode:       effectiveMode,
        limits:     limits  && typeof limits  === "object" ? limits  : {},
        filters:    effectiveFilters,
      });

      return res.json(result);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore building ranking snapshot" });
    }
  });

  // GET /fundamentals/ranking/daily?score_date=YYYY-MM-DD
  router.get("/ranking/daily", async (req, res) => {
    const fn = "ranking.GET:/ranking/daily";
    try {
      const { score_date } = req.query;

      if (!score_date || !DATE_RE.test(score_date)) {
        return res.status(400).json({ ok: false, error: "score_date obbligatoria (YYYY-MM-DD)" });
      }

      const data = await rankingSvc.getRanking(score_date);
      res.set("Cache-Control", "no-store");
      return res.json(data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura ranking" });
    }
  });

  return router;
};
