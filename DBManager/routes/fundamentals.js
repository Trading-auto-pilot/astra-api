// /route/fundamentals.js

const express = require("express");
const cache = require("../../shared/cache");
const router = express.Router();

module.exports = (dbManager) => {

  /**
   * GET /fundamentals/history?symbol=XYZ&days=70
   * Restituisce gli snapshot storici (default ultimi 70 giorni).
   */
  router.get("/history", async (req, res) => {
    const { symbol } = req.query;
    const days = req.query.days ? Number(req.query.days) : 70;
    try {
      const rows = await dbManager.getFundamentalsHistory({
        symbol: symbol ? String(symbol).toUpperCase() : null,
        limitDays: Number.isFinite(days) ? days : 70,
      });
      return res.json(rows);
    } catch (err) {
      console.error("[GET /fundamentals/history] Errore:", err.message);
      return res.status(500).json({
        error: "Errore durante la lettura della cronologia fundamentals",
        module: "[GET /fundamentals/history]",
      });
    }
  });

  // CRUD per fundamentals_history (SCD2)
  router.get("/history/records", async (req, res) => {
    const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : null;
    try {
      const rows = await dbManager.getFundamentalsHistoryRecords({ symbol });
      return res.json({ ok: true, data: rows });
    } catch (err) {
      console.error("[GET /fundamentals/history/records] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore lettura fundamentals_history" });
    }
  });

  router.post("/history/records", async (req, res) => {
    const body = req.body || {};
    try {
      const result = await dbManager.insertFundamentalsHistoryRecord(body);
      if (result.ok === false) return res.status(400).json(result);
      return res.json(result);
    } catch (err) {
      console.error("[POST /fundamentals/history/records] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore inserimento fundamentals_history" });
    }
  });

  router.put("/history/records/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
    try {
      const result = await dbManager.updateFundamentalsHistoryRecord(id, req.body || {});
      if (result.ok === false && result.error) return res.status(400).json(result);
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[PUT /fundamentals/history/records/:id] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento fundamentals_history" });
    }
  });

  router.delete("/history/records/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
    try {
      const result = await dbManager.deleteFundamentalsHistoryRecord(id);
      if (!result.affectedRows) return res.status(404).json({ ok: false, error: "Record non trovato" });
      return res.json({ ok: true });
    } catch (err) {
      console.error("[DELETE /fundamentals/history/records/:id] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore cancellazione fundamentals_history" });
    }
  });

  // CRUD market_daily
  router.get("/market-daily", async (req, res) => {
    const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : null;
    const trade_date = req.query.trade_date ?? req.query.tradeDate ?? null;
    try {
      const rows = await dbManager.getMarketDaily({ symbol, trade_date });
      return res.json({ ok: true, data: rows });
    } catch (err) {
      console.error("[GET /fundamentals/market-daily] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore lettura market_daily" });
    }
  });

  router.post("/market-daily", async (req, res) => {
    try {
      const result = await dbManager.insertMarketDailyRecord(req.body || {});
      if (result.ok === false && result.error) return res.status(400).json(result);
      return res.json(result);
    } catch (err) {
      console.error("[POST /fundamentals/market-daily] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore inserimento market_daily" });
    }
  });

  router.put("/market-daily/:symbol/:tradeDate", async (req, res) => {
    const symbol = req.params.symbol ? String(req.params.symbol).toUpperCase() : null;
    const tradeDate = req.params.tradeDate;
    if (!symbol || !tradeDate) return res.status(400).json({ ok: false, error: "symbol e trade_date obbligatori" });
    try {
      const result = await dbManager.updateMarketDailyRecord(symbol, tradeDate, req.body || {});
      if (result.ok === false && result.error) return res.status(400).json(result);
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[PUT /fundamentals/market-daily/:symbol/:tradeDate] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento market_daily" });
    }
  });

  router.delete("/market-daily/:symbol/:tradeDate", async (req, res) => {
    const symbol = req.params.symbol ? String(req.params.symbol).toUpperCase() : null;
    const tradeDate = req.params.tradeDate;
    if (!symbol || !tradeDate) return res.status(400).json({ ok: false, error: "symbol e trade_date obbligatori" });
    try {
      const result = await dbManager.deleteMarketDailyRecord(symbol, tradeDate);
      if (!result.affectedRows) return res.status(404).json({ ok: false, error: "Record non trovato" });
      return res.json({ ok: true });
    } catch (err) {
      console.error("[DELETE /fundamentals/market-daily/:symbol/:tradeDate] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore cancellazione market_daily" });
    }
  });

  // CRUD scores_daily
  router.get("/scores-daily", async (req, res) => {
    const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : null;
    const score_date = req.query.score_date ?? req.query.scoreDate ?? null;
    const user_id = req.query.user_id !== undefined ? Number(req.query.user_id) : undefined;
    const pipe_id = req.query.pipe_id !== undefined ? Number(req.query.pipe_id) : undefined;
    try {
      const rows = await dbManager.getScoresDaily({ symbol, score_date, user_id, pipe_id });
      return res.json({ ok: true, data: rows });
    } catch (err) {
      console.error("[GET /fundamentals/scores-daily] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore lettura scores_daily" });
    }
  });

  router.post("/scores-daily", async (req, res) => {
    try {
      const result = await dbManager.insertScoresDailyRecord(req.body || {});
      if (result.ok === false && result.error) return res.status(400).json(result);
      return res.json(result);
    } catch (err) {
      console.error("[POST /fundamentals/scores-daily] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore inserimento scores_daily" });
    }
  });

  router.put("/scores-daily/:symbol/:scoreDate/:userId/:pipeId", async (req, res) => {
    const symbol = req.params.symbol ? String(req.params.symbol).toUpperCase() : null;
    const scoreDate = req.params.scoreDate;
    const userId = Number(req.params.userId);
    const pipeId = Number(req.params.pipeId);
    if (!symbol || !scoreDate || !Number.isFinite(userId) || !Number.isFinite(pipeId))
      return res.status(400).json({ ok: false, error: "symbol, score_date, user_id, pipe_id obbligatori" });
    try {
      const result = await dbManager.updateScoresDailyRecord(symbol, scoreDate, { ...req.body, user_id: userId, pipe_id: pipeId });
      if (result.ok === false && result.error) return res.status(400).json(result);
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[PUT /fundamentals/scores-daily/:symbol/:scoreDate/:userId/:pipeId] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento scores_daily" });
    }
  });

  router.delete("/scores-daily/:symbol/:scoreDate/:userId/:pipeId", async (req, res) => {
    const symbol = req.params.symbol ? String(req.params.symbol).toUpperCase() : null;
    const scoreDate = req.params.scoreDate;
    const userId = Number(req.params.userId);
    const pipeId = Number(req.params.pipeId);
    if (!symbol || !scoreDate || !Number.isFinite(userId) || !Number.isFinite(pipeId))
      return res.status(400).json({ ok: false, error: "symbol, score_date, user_id, pipe_id obbligatori" });
    try {
      const result = await dbManager.deleteScoresDailyRecord(symbol, scoreDate, userId, pipeId);
      if (!result.affectedRows) return res.status(404).json({ ok: false, error: "Record non trovato" });
      return res.json({ ok: true });
    } catch (err) {
      console.error("[DELETE /fundamentals/scores-daily/:symbol/:scoreDate/:userId/:pipeId] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore cancellazione scores_daily" });
    }
  });

  // CRUD scoring_models
  router.get("/scoring-models", async (req, res) => {
    const name = req.query.name ? String(req.query.name) : null;
    try {
      const rows = await dbManager.getScoringModels({ name });
      return res.json({ ok: true, data: rows });
    } catch (err) {
      console.error("[GET /fundamentals/scoring-models] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore lettura scoring_models" });
    }
  });

  router.post("/scoring-models", async (req, res) => {
    try {
      const result = await dbManager.insertScoringModel(req.body || {});
      if (result.ok === false && result.error) return res.status(400).json(result);
      return res.json(result);
    } catch (err) {
      console.error("[POST /fundamentals/scoring-models] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore inserimento scoring_model" });
    }
  });

  router.put("/scoring-models/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
    try {
      const result = await dbManager.updateScoringModel(id, req.body || {});
      if (result.ok === false && result.error) return res.status(400).json(result);
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[PUT /fundamentals/scoring-models/:id] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento scoring_model" });
    }
  });

  router.delete("/scoring-models/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id non valido" });
    try {
      const result = await dbManager.deleteScoringModel(id);
      if (!result.affectedRows) return res.status(404).json({ ok: false, error: "Record non trovato" });
      return res.json({ ok: true });
    } catch (err) {
      console.error("[DELETE /fundamentals/scoring-models/:id] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore cancellazione scoring_model" });
    }
  });

  /**
   * POST /fundamentals/history
   * Body: { records: [ { symbol, as_of_date, ... } ] }
   */
  router.post("/history", async (req, res) => {
    const records = req.body?.records || req.body?.results || req.body;
    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({
        ok: false,
        error: "Formato input non valido: serve { records: [...] }",
      });
    }
    try {
      const result = await dbManager.insertOrUpdateFundamentalsHistoryBulk(records);
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[POST /fundamentals/history] Errore:", err.message);
      return res.status(500).json({
        ok: false,
        error: "Errore durante la scrittura della cronologia fundamentals",
        module: "[POST /fundamentals/history]",
      });
    }
  });

  /**
   * GET /fundamentals/user-filters/:userId
   */
  router.get("/user-filters/:userId", async (req, res) => {
    const userId = Number(req.params.userId);
    const pipeId =
      req.query.pipe_id !== undefined
        ? Number(req.query.pipe_id)
        : req.query.pipeId !== undefined
        ? Number(req.query.pipeId)
        : null;
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ ok: false, error: "userId non valido" });
    }
    try {
      const rows = await dbManager.getUserFilters(userId, Number.isFinite(pipeId) ? pipeId : null);
      return res.json({ ok: true, data: rows });
    } catch (err) {
      console.error("[GET /fundamentals/user-filters/:userId] Errore:", err.message);
      return res.status(500).json({ ok: false, error: "Errore lettura user_filters" });
    }
  });

  /**
   * POST /fundamentals/user-filters
   * Body: { user_id, filter_name, value, comparator, enabled }
   */
  router.post("/user-filters", async (req, res) => {
    const { user_id, filter_name, value, comparator, enabled, pipe_id = null, pipeId = null } = req.body || {};
    const userId = Number(user_id);
    const valNum = Number(value);
    if (!Number.isFinite(userId) || !filter_name || !Number.isFinite(valNum)) {
      return res.status(400).json({ ok: false, error: "Parametri mancanti o non validi" });
    }
    try {
      const result = await dbManager.upsertUserFilter({
        userId,
        filterName: String(filter_name),
        value: valNum,
        comparator: comparator === "LT" ? "LT" : "GT",
        enabled: enabled !== undefined ? Boolean(enabled) : true,
        pipeId: Number.isFinite(Number(pipe_id ?? pipeId)) ? Number(pipe_id ?? pipeId) : null,
      });
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[POST /fundamentals/user-filters] Errore:", err.message);
      return res.status(500).json({ ok: false, error: "Errore salvataggio user_filters" });
    }
  });

  /**
   * PUT /fundamentals/user-filters/:userId/:filterName
   * Body: { value?, comparator?, enabled? }
   */
  router.put("/user-filters/:userId/:filterName", async (req, res) => {
    const userId = Number(req.params.userId);
    const filterName = req.params.filterName;
    const { value, comparator, enabled, pipe_id = null, pipeId = null } = req.body || {};
    const valNum = value !== undefined ? Number(value) : null;
    if (!Number.isFinite(userId) || !filterName) {
      return res.status(400).json({ ok: false, error: "Parametri mancanti" });
    }
    if (valNum !== null && !Number.isFinite(valNum)) {
      return res.status(400).json({ ok: false, error: "Value non valido" });
    }
    try {
      const result = await dbManager.upsertUserFilter({
        userId,
        filterName,
        value: valNum !== null ? valNum : 0,
        comparator: comparator === "LT" ? "LT" : "GT",
        enabled: enabled !== undefined ? Boolean(enabled) : true,
        pipeId: Number.isFinite(Number(pipe_id ?? pipeId)) ? Number(pipe_id ?? pipeId) : null,
      });
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[PUT /fundamentals/user-filters/:userId/:filterName] Errore:", err.message);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento user_filters" });
    }
  });

  /**
   * DELETE /fundamentals/user-filters/:userId/:filterName
   */
  router.delete("/user-filters/:userId/:filterName", async (req, res) => {
    const userId = Number(req.params.userId);
    const filterName = req.params.filterName;
    const pipeId =
      req.query.pipe_id !== undefined
        ? Number(req.query.pipe_id)
        : req.query.pipeId !== undefined
        ? Number(req.query.pipeId)
        : null;
    if (!Number.isFinite(userId) || !filterName) {
      return res.status(400).json({ ok: false, error: "Parametri mancanti" });
    }
    try {
      const result = await dbManager.deleteUserFilter({
        userId,
        filterName,
        pipeId: Number.isFinite(Number(pipeId)) ? Number(pipeId) : null,
      });
      if (!result.affectedRows) {
        return res.status(404).json({ ok: false, error: "Filtro non trovato" });
      }
      return res.json({ ok: true });
    } catch (err) {
      console.error("[DELETE /fundamentals/user-filters/:userId/:filterName] Errore:", err.message);
      return res.status(500).json({ ok: false, error: "Errore cancellazione user_filters" });
    }
  });

  /**
   * CRUD user_fundamentals
   */
  router.get("/user-fundamentals/:userId", async (req, res) => {
    const userId = Number(req.params.userId);
    const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : null;
    if (!Number.isFinite(userId)) return res.status(400).json({ ok: false, error: "userId non valido" });
    try {
      const rows = await dbManager.getUserFundamentals({ userId, symbol });
      return res.json({ ok: true, data: rows });
    } catch (err) {
      console.error("[GET /fundamentals/user-fundamentals/:userId] Errore:", err.message);
      return res.status(500).json({ ok: false, error: "Errore lettura user_fundamentals" });
    }
  });

  router.post("/user-fundamentals", async (req, res) => {
    const body = req.body || {};
    const userId = Number(body.user_id);
    const symbol = body.symbol ? String(body.symbol).toUpperCase() : null;
    if (!Number.isFinite(userId) || !symbol) {
      return res.status(400).json({ ok: false, error: "user_id e symbol sono obbligatori" });
    }
    try {
      const result = await dbManager.upsertUserFundamental({ userId, symbol, ...body });
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[POST /fundamentals/user-fundamentals] Errore:", err.message);
      return res.status(500).json({ ok: false, error: "Errore salvataggio user_fundamentals" });
    }
  });

  router.put("/user-fundamentals/:userId/:symbol", async (req, res) => {
    const userId = Number(req.params.userId);
    const symbol = req.params.symbol ? String(req.params.symbol).toUpperCase() : null;
    if (!Number.isFinite(userId) || !symbol) {
      return res.status(400).json({ ok: false, error: "user_id e symbol sono obbligatori" });
    }
    try {
      const result = await dbManager.upsertUserFundamental({ userId, symbol, ...req.body });
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[PUT /fundamentals/user-fundamentals/:userId/:symbol] Errore:", err.message);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento user_fundamentals" });
    }
  });

  router.delete("/user-fundamentals/:userId/:symbol", async (req, res) => {
    const userId = Number(req.params.userId);
    const symbol = req.params.symbol ? String(req.params.symbol).toUpperCase() : null;
    if (!Number.isFinite(userId) || !symbol) {
      return res.status(400).json({ ok: false, error: "user_id e symbol sono obbligatori" });
    }
    try {
      const result = await dbManager.deleteUserFundamental({ userId, symbol });
      if (!result.affectedRows) {
        return res.status(404).json({ ok: false, error: "Record non trovato" });
      }
      return res.json({ ok: true });
    } catch (err) {
      console.error("[DELETE /fundamentals/user-fundamentals/:userId/:symbol] Errore:", err.message);
      return res.status(500).json({ ok: false, error: "Errore cancellazione user_fundamentals" });
    }
  });

  // GET vista v_user_fundamentals per utente
  router.get("/user-fundamentals-view/:userId", async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) return res.status(400).json({ ok: false, error: "userId non valido" });
    try {
      const rows = await dbManager.getUserFundamentalsView({ userId });
      return res.json({ ok: true, data: rows });
    } catch (err) {
      console.error("[GET /fundamentals/user-fundamentals-view/:userId] Errore:", err);
      return res.status(500).json({
        ok: false,
        error: err?.message || "Errore lettura v_user_fundamentals",
        detail: err?.stack,
      });
    }
  });

  // CRUD user_order_by
  router.get("/user-order/:userId", async (req, res) => {
    const userId = Number(req.params.userId);
    const pipeId =
      req.query.pipe_id !== undefined
        ? Number(req.query.pipe_id)
        : req.query.pipeId !== undefined
        ? Number(req.query.pipeId)
        : null;
    if (!Number.isFinite(userId)) return res.status(400).json({ ok: false, error: "userId non valido" });
    try {
      const rows = await dbManager.getUserOrderBy(userId, Number.isFinite(pipeId) ? pipeId : null);
      return res.json({ ok: true, data: rows });
    } catch (err) {
      console.error("[GET /fundamentals/user-order/:userId] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore lettura user_order_by" });
    }
  });

  router.post("/user-order", async (req, res) => {
    const { user_id, order_field, direction, order_id, pipe_id = null, pipeId = null } = req.body || {};
    if (!Number.isFinite(Number(user_id)) || !order_field) {
      return res.status(400).json({ ok: false, error: "user_id e order_field obbligatori" });
    }
    const pipeVal = Number.isFinite(Number(pipe_id ?? pipeId)) ? Number(pipe_id ?? pipeId) : null;
    const dir = String(direction || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
    try {
      const result = await dbManager.insertUserOrderBy({
        userId: Number(user_id),
        order_field,
        direction: dir,
        order_id: Number.isFinite(Number(order_id)) ? Number(order_id) : 1,
        pipe_id: pipeVal,
      });
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[POST /fundamentals/user-order] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore inserimento user_order_by" });
    }
  });

  router.put("/user-order/:id", async (req, res) => {
    const id = Number(req.params.id);
    const { user_id, order_field, direction, order_id, pipe_id = null, pipeId = null } = req.body || {};
    if (!Number.isFinite(id) || !Number.isFinite(Number(user_id)) || !order_field) {
      return res.status(400).json({ ok: false, error: "id, user_id e order_field obbligatori" });
    }
    const pipeVal = Number.isFinite(Number(pipe_id ?? pipeId)) ? Number(pipe_id ?? pipeId) : null;
    const dir = String(direction || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
    try {
      const result = await dbManager.updateUserOrderBy({
        id,
        userId: Number(user_id),
        order_field,
        direction: dir,
        order_id: Number.isFinite(Number(order_id)) ? Number(order_id) : 1,
        pipe_id: pipeVal,
      });
      if (!result.affectedRows) return res.status(404).json({ ok: false, error: "Record non trovato" });
      return res.json({ ok: true });
    } catch (err) {
      console.error("[PUT /fundamentals/user-order/:id] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento user_order_by" });
    }
  });

  router.delete("/user-order/:id/:userId", async (req, res) => {
    const id = Number(req.params.id);
    const userId = Number(req.params.userId);
    const pipeId =
      req.query.pipe_id !== undefined
        ? Number(req.query.pipe_id)
        : req.query.pipeId !== undefined
        ? Number(req.query.pipeId)
        : null;
    if (!Number.isFinite(id) || !Number.isFinite(userId)) {
      return res.status(400).json({ ok: false, error: "id e userId obbligatori" });
    }
    try {
      const result = await dbManager.deleteUserOrderBy({
        id,
        userId,
        pipeId: Number.isFinite(pipeId) ? pipeId : null,
      });
      if (!result.affectedRows) return res.status(404).json({ ok: false, error: "Record non trovato" });
      return res.json({ ok: true });
    } catch (err) {
      console.error("[DELETE /fundamentals/user-order/:id/:userId] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore cancellazione user_order_by" });
    }
  });

 
  /**
   * GET /fundamentals
   * Restituisce tutta la tabella fundamentals (o una lista filtrata in futuro).
   * Cache: fundamentals:all
   */
  router.get("/", async (_req, res) => {
    const cacheKey = "fundamentals:all";

    try {
      let cached = await cache.get(cacheKey);
      if (cached) return res.json(cached);

      const rows = await dbManager.getAllFundamentals();

      // salva in cache
      await cache.set(cacheKey, rows);

      return res.json(rows);

    } catch (err) {
      console.error("[GET /fundamentals] Errore:", err.message);
      return res.status(500).json({
        error: "Errore durante la lettura dei fundamentals",
        module: "[GET /fundamentals]"
      });
    }
  });



  /**
   * GET /fundamentals/:symbol
   * Restituisce 1 solo ticker
   * Cache: fundamentals:symbol:<SYM>
   */
  router.get("/:symbol", async (req, res) => {
    const { symbol } = req.params;

    const cacheKey = `fundamentals:symbol:${symbol}`;

    try {
      let cached = await cache.get(cacheKey);
      if (cached) return res.json(cached);

      const row = await dbManager.getFundamentalsBySymbol(symbol);
      if (!row) {
        return res.status(404).json({
          error: `Fundamentals non trovati per ${symbol}`,
        });
      }

      await cache.set(cacheKey, row);

      return res.json(row);

    } catch (err) {
      console.error(`[GET /fundamentals/${symbol}] Errore:`, err.message);
      return res.status(500).json({
        error: "Errore durante la lettura dei fundamentals",
        module: `[GET /fundamentals/${symbol}]`
      });
    }
  });


router.put("/bulk", async (req, res) => {
  const results = req.body?.results;
  if (!Array.isArray(results) || !results.length) {
    return res.status(400).json({
      ok: false,
      error: "Serve { results: [ { symbol, momentum }, ... ] }",
    });
  }

  try {
    const out = await dbManager.updateFundamentalsMomentumBulk(results);
    // invalidiamo eventuale cache per simboli singoli
    for (const r of results) {
      if (r.symbol) {
        await cache.del(`fundamentals:symbol:${r.symbol}`);
      }
    }
    return res.json({ ok: true, ...out });
  } catch (err) {
    console.error("[POST /fundamentals/momentum/bulk] Errore:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Errore durante aggiornamento momentum",
    });
  }
});


  /**
   * POST /fundamentals/bulk
   * Inserisce/aggiorna più ticker
   * Invalida la cache globale e quella per simbolo
   */
  router.post("/bulk", async (req, res) => {
    const records = req.body?.results;

    if (!Array.isArray(records)) {
      return res.status(400).json({
        error: "Formato input non valido: serve { records: [...] }"
      });
    }

    try {
      const result = await dbManager.insertOrUpdateFundamentalsBulk(records);

      // 🔥 invalidazione cache globale
      await cache.del("fundamentals:all");

      // 🔥 invalidazione cache per ogni simbolo aggiornato
      for (const r of records) {
        const key = `fundamentals:symbol:${r.symbol}`;
        await cache.del(key);
      }

      return res.json({ ok: true, ...result });

    } catch (err) {
      console.error("[POST /fundamentals/bulk] Errore:", err.message);
      return res.status(500).json({
        error: "Errore durante la scrittura dei fundamentals",
        module: "[POST /fundamentals/bulk]"
      });
    }
  });

  /**
   * DELETE /fundamentals/:symbol
   * Cancella un ticker dalla tabella fundamentals
   * e invalida la cache relativa.
   */
  router.delete("/:symbol", async (req, res) => {
    const { symbol } = req.params;

    try {
      const result = await dbManager.deleteFundamentalsBySymbol(symbol);

      if (!result.affectedRows) {
        return res.status(404).json({
          error: `Fundamentals non trovati per ${symbol}`,
          module: "[DELETE /fundamentals/:symbol]"
        });
      }

      // invalida cache globale e per simbolo
      await cache.del("fundamentals:all");
      await cache.del(`fundamentals:symbol:${symbol}`);

      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[DELETE /fundamentals/:symbol] Errore:", err.message);
      return res.status(500).json({
        error: "Errore durante la cancellazione dei fundamentals",
        module: "[DELETE /fundamentals/:symbol]"
      });
    }
  });


  return router;
};
