"use strict";

const axios = require("axios");
const { Router } = require("express");
const { createDatahubAdapter } = require("../../shared/datahubAdapter");
const { createFetchUserId, normalizeRecordForFilters, normalizeUserFilters, applyUserFilters, normalizeUserOrder, applyUserOrder } = require("../lib/filterEngine");
const { createFetchApiKeyId, createFetchUserWeights } = require("../lib/weightsConfig");
const { decorate, safeNum, computeMomentumLongScore, computeGrowthProbability, computeVolumeScore, computeMomentumShortScore, normalizeShortRisk } = require("../lib/scoreDecorator");

const safeStringify = (val) => {
  if (val === undefined) return "";
  if (typeof val === "string") return val;
  try { return JSON.stringify(val); } catch { return String(val); }
};

module.exports = function buildUserDataRouter({ logger, getService }) {
  const router = Router();
  const dbmanagerUrl = (process.env.DATAHUB_URL || process.env.DBMANAGER_URL || "http://datahub:3000").replace(/\/+$/, "");
  const authServiceUrl = (process.env.AUTHSERVICE_URL || "http://authservice:3015").replace(/\/+$/, "");

  const datahubAxios = createDatahubAdapter(axios.create({ baseURL: dbmanagerUrl, timeout: 8000 }));
  const fetchApiKeyId = createFetchApiKeyId({ axios, dbmanagerUrl, logger });
  const fetchUserId = createFetchUserId({ axios, authServiceUrl, logger, fetchApiKeyId });
  const fetchUserWeights = createFetchUserWeights({ axios, authServiceUrl, logger });

  // ---- user-order CRUD ----

  const getUserOrder = async (req, res) => {
    const fn = "userData.GET:/user-order";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const pipeId = req.params.pipeId ?? req.query.pipe_id ?? req.query.pipeId;
      const url = `${dbmanagerUrl}/fundamentals/user-order/${userId}${pipeId ? `?pipeId=${encodeURIComponent(pipeId)}` : ""}`;
      const resp = await axios.get(url, { timeout: 6000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(err?.response?.status || 500).json({ ok: false, error: err?.response?.data || "Errore lettura user_order_by" });
    }
  };

  router.get("/user-order", getUserOrder);
  router.get("/user-order/:pipeId", getUserOrder);

  const postUserOrder = async (req, res) => {
    const fn = "userData.POST:/user-order";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const pipeId = req.params.pipeId ?? req.body?.pipe_id ?? req.body?.pipeId ?? req.query?.pipe_id ?? req.query?.pipeId;
      const body = { ...req.body, user_id: userId, ...(pipeId !== undefined ? { pipe_id: pipeId } : {}) };
      const resp = await axios.post(`${dbmanagerUrl}/fundamentals/user-order`, body, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore salvataggio user_order_by" });
    }
  };

  router.post("/user-order", postUserOrder);
  router.post("/user-order/:pipeId", postUserOrder);

  // PUT /user-order/pipe/:pipeId - bulk update orders for a pipe
  router.put("/user-order/pipe/:pipeId", async (req, res) => {
    const fn = "userData.PUT:/user-order/pipe/:pipeId";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const pipeIdVal = req.params.pipeId ?? req.body?.pipe_id ?? req.body?.pipeId ?? req.query?.pipe_id ?? req.query?.pipeId;
      const orders = Array.isArray(req.body?.orders) ? req.body.orders : [];
      const results = [];
      for (const o of orders) {
        const targetId = o?.id;
        const url = targetId
          ? `${dbmanagerUrl}/fundamentals/user-order/${encodeURIComponent(targetId)}${pipeIdVal ? `?pipeId=${encodeURIComponent(pipeIdVal)}` : ""}`
          : `${dbmanagerUrl}/fundamentals/user-order`;
        const body = { ...o, user_id: userId, ...(pipeIdVal !== undefined ? { pipe_id: pipeIdVal } : {}) };
        const resp = await axios({ url, method: targetId ? "put" : "post", data: body, timeout: 8000 }).catch((err) => {
          logger.error(`${fn} single order error ${safeStringify(err?.response?.data || err?.message || err)}`);
          return { data: { ok: false, error: err?.message || "errore ordine" } };
        });
        results.push(resp?.data ?? { ok: false, order: o });
      }
      return res.json({ ok: true, results });
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento user_order_by" });
    }
  });

  const putUserOrder = async (req, res) => {
    const fn = "userData.PUT:/user-order/:id";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = req.params.id;
      const pipeIdVal = req.params.pipeId ?? req.body?.pipe_id ?? req.body?.pipeId ?? req.query?.pipe_id ?? req.query?.pipeId;
      if (Array.isArray(req.body?.orders)) {
        const orders = req.body.orders;
        const pipeIdForOrders = pipeIdVal !== undefined ? pipeIdVal : id;
        const results = [];
        for (const o of orders) {
          const targetId = o?.id;
          const url = targetId
            ? `${dbmanagerUrl}/fundamentals/user-order/${targetId}${pipeIdForOrders ? `?pipeId=${encodeURIComponent(pipeIdForOrders)}` : ""}`
            : `${dbmanagerUrl}/fundamentals/user-order`;
          const orderField = o?.order_field || o?.field || o?.orderField || o?.name;
          if (!orderField) { results.push({ ok: false, error: "order_field mancante" }); continue; }
          const body = { ...o, order_field: orderField, user_id: userId, ...(pipeIdForOrders !== undefined ? { pipe_id: pipeIdForOrders } : {}) };
          const resp = await axios({ url, method: targetId ? "put" : "post", data: body, timeout: 8000 }).catch((err) => {
            logger.error(`${fn} single order error ${safeStringify(err?.response?.data || err?.message || err)}`);
            return { data: { ok: false, error: err?.message || "errore ordine" } };
          });
          results.push(resp?.data ?? { ok: false, order: o });
        }
        return res.json({ ok: true, results });
      }
      const body = { ...req.body, user_id: userId, ...(pipeIdVal !== undefined ? { pipe_id: pipeIdVal } : {}) };
      const pipeQuery = pipeIdVal ? `?pipeId=${encodeURIComponent(pipeIdVal)}` : "";
      const resp = await axios.put(`${dbmanagerUrl}/fundamentals/user-order/${id}${pipeQuery}`, body, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento user_order_by" });
    }
  };

  router.put("/user-order/:id", putUserOrder);
  router.put("/user-order/:id/:pipeId", putUserOrder);

  const deleteUserOrder = async (req, res) => {
    const fn = "userData.DELETE:/user-order/:id";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const id = req.params.id;
      const rawPipe = req.params.pipeId ?? req.query.pipe_id ?? req.query.pipeId ?? req.body?.pipe_id ?? req.body?.pipeId;
      const pipeQuery = rawPipe ? `?pipeId=${encodeURIComponent(rawPipe)}` : "";
      const resp = await axios.delete(`${dbmanagerUrl}/fundamentals/user-order/${id}/${userId}${pipeQuery}`, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore cancellazione user_order_by" });
    }
  };

  router.delete("/user-order/:id", deleteUserOrder);
  router.delete("/user-order/:id/:pipeId", deleteUserOrder);

  // ---- user-filters CRUD ----

  router.get("/user-filters/:pipeId", async (req, res) => {
    const fn = "userData.GET:/user-filters/:pipeId";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const pipeId = req.params.pipeId ?? req.query.pipe_id ?? req.query.pipeId;
      const resp = await axios.get(
        `${dbmanagerUrl}/fundamentals/user-filters/${userId}${pipeId ? `?pipeId=${encodeURIComponent(pipeId)}` : ""}`,
        { timeout: 6000 }
      );
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura user_filters" });
    }
  });

  router.post("/user-filters", async (req, res) => {
    const fn = "userData.POST:/user-filters";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const pipeId = req.body?.pipe_id ?? req.body?.pipeId ?? req.query?.pipe_id ?? req.query?.pipeId;
      const body = { ...req.body, user_id: userId, ...(pipeId !== undefined ? { pipe_id: pipeId } : {}) };
      const resp = await axios.post(`${dbmanagerUrl}/fundamentals/user-filters`, body, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore salvataggio user_filters" });
    }
  });

  // PUT /user-filters/:pipeId - bulk upsert filters for a pipe
  router.put("/user-filters/:pipeId", async (req, res) => {
    const fn = "userData.PUT:/user-filters/:pipeId";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const pipeId = req.params.pipeId ?? req.body?.pipe_id ?? req.body?.pipeId ?? req.query?.pipe_id ?? req.query?.pipeId;
      const filters = Array.isArray(req.body?.filters) ? req.body.filters : [];
      const incomingNames = new Set(
        filters.map((f) => f?.filter_name || f?.filterName || f?.name).filter((n) => typeof n === "string" && n.length > 0)
      );
      // Delete filters no longer present
      try {
        const pipeQuery = pipeId ? `?pipeId=${encodeURIComponent(pipeId)}` : "";
        const listResp = await axios.get(`${dbmanagerUrl}/fundamentals/user-filters/${userId}${pipeQuery}`, { timeout: 8000 });
        const existingRows = Array.isArray(listResp.data?.data) ? listResp.data.data : Array.isArray(listResp.data) ? listResp.data : [];
        const toDelete = existingRows.map((r) => r?.filter_name || r?.filterName || r?.name).filter((n) => n && !incomingNames.has(n));
        for (const name of toDelete) {
          await axios.delete(`${dbmanagerUrl}/fundamentals/user-filters/${userId}/${encodeURIComponent(name)}${pipeQuery}`, { timeout: 8000 }).catch((err) => {
            logger.warning(`${fn} delete filter failed ${safeStringify({ filter: name, error: err?.message })}`);
          });
        }
      } catch (err) {
        logger.warning(`${fn} fetch existing filters failed ${safeStringify(err?.message)}`);
      }
      const results = [];
      const pipeQuery = pipeId ? `?pipeId=${encodeURIComponent(pipeId)}` : "";
      for (const f of filters) {
        const filterName = f?.filter_name || f?.filterName || f?.name;
        if (!filterName) continue;
        const url = `${dbmanagerUrl}/fundamentals/user-filters/${userId}/${encodeURIComponent(filterName)}${pipeQuery}`;
        const resp = await axios.put(url, { ...f, user_id: userId, pipe_id: pipeId }, { timeout: 8000 }).catch((err) => {
          logger.error(`${fn} single error ${safeStringify(err?.response?.data || err?.message || err)}`);
          return { data: { ok: false, error: err?.message || "errore singolo filtro" } };
        });
        results.push(resp?.data ?? { ok: false, filter: filterName });
      }
      return res.json({ ok: true, results });
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento user_filters" });
    }
  });

  router.put("/user-filters/:filterName/:pipeId", async (req, res) => {
    const fn = "userData.PUT:/user-filters/:filterName/:pipeId";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const filterName = req.params.filterName;
      const pipeIdVal = req.params.pipeId ?? req.body?.pipe_id ?? req.body?.pipeId ?? req.query?.pipe_id ?? req.query?.pipeId;
      const pipeQuery = pipeIdVal ? `?pipeId=${encodeURIComponent(pipeIdVal)}` : "";
      const body = { ...req.body, user_id: userId, ...(pipeIdVal !== undefined ? { pipe_id: pipeIdVal } : {}) };
      const resp = await axios.put(`${dbmanagerUrl}/fundamentals/user-filters/${userId}/${encodeURIComponent(filterName)}${pipeQuery}`, body, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento user_filters" });
    }
  });

  router.delete("/user-filters/:filterName/:pipeId", async (req, res) => {
    const fn = "userData.DELETE:/user-filters/:filterName/:pipeId";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const filterName = req.params.filterName;
      const rawPipe = req.params.pipeId ?? req.query.pipe_id ?? req.query.pipeId ?? req.body?.pipe_id ?? req.body?.pipeId;
      const pipeQuery = rawPipe ? `?pipeId=${encodeURIComponent(rawPipe)}` : "";
      const resp = await axios.delete(`${dbmanagerUrl}/fundamentals/user-filters/${userId}/${encodeURIComponent(filterName)}${pipeQuery}`, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore cancellazione user_filters" });
    }
  });

  // ---- user pipes CRUD ----

  // Virtual pipe injected at position 0: reads tickers from AST_RANKING_DAILY
  const RANKING_DAILY_VIRTUAL_PIPE = { id: 0, name: "Ranking Daily", description: "Ticker da AST_RANKING_DAILY (sistema)", enabled: 1 };

  async function handleGetPipes(req, res) {
    const fn = "userData.GET:/users/pipes";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const resp = await datahubAxios.get(`/api/table/user_pipes?user_id=${userId}&limit=100`);
      const payload = resp.data || {};
      const rows = Array.isArray(payload.data) ? payload.data : [];
      const allPipes = [RANKING_DAILY_VIRTUAL_PIPE, ...rows];
      return res.json({ ...payload, data: allPipes, count: allPipes.length, total: allPipes.length });
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(err?.response?.status || 500).json({ ok: false, error: "Errore lettura pipes" });
    }
  }

  async function handleGetPipeById(req, res) {
    const fn = "userData.GET:/users/pipes/:id";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const resp = await axios.get(`${dbmanagerUrl}/users/${userId}/pipes/${req.params.id}`, { timeout: 6000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(err?.response?.status || 500).json({ ok: false, error: "Errore lettura pipe" });
    }
  }

  async function handleCreatePipe(req, res) {
    const fn = "userData.POST:/users/pipes";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const resp = await axios.post(`${dbmanagerUrl}/users/${userId}/pipes`, { ...req.body, user_id: userId }, { timeout: 8000 });
      const payload = resp.data || {};
      const pipeId = Number(payload?.insertId ?? payload?.data?.insertId ?? payload?.id ?? payload?.data?.id);
      logger.info(`${fn} pipe creata ${safeStringify({ userId, pipeId })}`);
      if (pipeId) {
        // Best-effort: create score_weights row for new pipe
        await axios.post(`${dbmanagerUrl}/auth/users/${userId}/score-weights/${encodeURIComponent(pipeId)}`, {}, { timeout: 5000 }).catch((err) => {
          logger.warning(`${fn} add score_weights failed ${safeStringify(err?.response?.data || err?.message || err)}`);
        });
        // Best-effort: copy default filters (user_id=0, pipe_id=0) for new user/pipe
        await axios.post(`${dbmanagerUrl}/auth/users/${userId}/filters/${encodeURIComponent(pipeId)}`, {}, { timeout: 8000 }).catch((err) => {
          logger.warning(`${fn} copy default filters failed ${safeStringify(err?.response?.data || err?.message || err)}`);
        });
      } else {
        logger.warning(`${fn} pipeId non determinato, salto setup pesi/filtri ${safeStringify({ response: payload })}`);
      }
      return res.json(payload);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(err?.response?.status || 500).json({ ok: false, error: "Errore creazione pipe" });
    }
  }

  async function handleUpdatePipe(req, res) {
    const fn = "userData.PUT:/users/pipes/:id";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const resp = await axios.put(`${dbmanagerUrl}/users/${userId}/pipes/${req.params.id}`, { ...req.body, user_id: userId }, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(err?.response?.status || 500).json({ ok: false, error: "Errore aggiornamento pipe" });
    }
  }

  async function handleDeletePipe(req, res) {
    const fn = "userData.DELETE:/users/pipes/:id";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const resp = await axios.delete(`${dbmanagerUrl}/users/${userId}/pipes/${req.params.id}`, { timeout: 8000 });
      const payload = resp.data || {};
      const pipeIdNum = Number(req.params.id);
      if (Number.isFinite(pipeIdNum)) {
        // Best-effort cleanup: score_weights, filters, order_by
        await axios.delete(`${dbmanagerUrl}/auth/users/${userId}/score-weights/${pipeIdNum}`, { timeout: 5000 }).catch((err) => {
          logger.warning(`${fn} cleanup score_weights failed ${safeStringify(err?.message)}`);
        });
        await axios.delete(`${dbmanagerUrl}/auth/users/${userId}/filters/${encodeURIComponent(pipeIdNum)}`, { timeout: 6000 }).catch((err) => {
          logger.warning(`${fn} cleanup filters failed ${safeStringify(err?.message)}`);
        });
        try {
          const orderResp = await axios.get(`${dbmanagerUrl}/fundamentals/user-order/${encodeURIComponent(pipeIdNum)}`, { timeout: 6000 });
          const orders = Array.isArray(orderResp?.data?.data) ? orderResp.data.data : Array.isArray(orderResp?.data) ? orderResp.data : [];
          for (const o of orders) {
            if (!o?.id) continue;
            await axios.delete(`${dbmanagerUrl}/fundamentals/user-order/${o.id}?pipeId=${encodeURIComponent(pipeIdNum)}`, { timeout: 5000 }).catch((err) => {
              logger.warning(`${fn} cleanup order failed ${safeStringify({ id: o.id, error: err?.message })}`);
            });
          }
        } catch (err) {
          logger.warning(`${fn} cleanup order fetch failed ${safeStringify(err?.message)}`);
        }
      }
      return res.json(payload);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(err?.response?.status || 500).json({ ok: false, error: "Errore cancellazione pipe" });
    }
  }

  router.get("/users/pipes", handleGetPipes);
  router.get("/users/pipes/:id", handleGetPipeById);
  router.post("/users/pipes", handleCreatePipe);
  router.put("/users/pipes/:id", handleUpdatePipe);
  router.delete("/users/pipes/:id", handleDeletePipe);
  // Compat: path with userId param (ignored — userId comes from token)
  router.get("/users/:userId/pipes", handleGetPipes);
  router.get("/users/:userId/pipes/:id", handleGetPipeById);
  router.post("/users/:userId/pipes", handleCreatePipe);
  router.put("/users/:userId/pipes/:id", handleUpdatePipe);
  router.delete("/users/:userId/pipes/:id", handleDeletePipe);

  // ---- user-fundamentals-view ----

  router.get("/user-fundamentals-view", async (req, res) => {
    const fn = "userData.GET:/user-fundamentals-view";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const resp = await axios.get(`${dbmanagerUrl}/fundamentals/user-fundamentals-view/${userId}`, { timeout: 8000, transformResponse: (r) => r });
      const parsed = (() => { try { return typeof resp.data === "string" ? JSON.parse(resp.data) : resp.data; } catch { return resp.data; } })();
      return res.status(resp.status || 200).json(parsed);
    } catch (err) {
      const errorStr = err?.response?.data ? safeStringify(err.response.data) : safeStringify(err?.message || String(err));
      logger.error(`${fn} error ${errorStr}`);
      return res.status(500).json({ ok: false, error: errorStr || "Errore lettura user_fundamentals" });
    }
  });

  router.get("/user-fundamentals-view/:pipeId", async (req, res) => {
    const fn = "userData.GET:/user-fundamentals-view/:pipeId";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const pipeId = req.params.pipeId;
      if (!pipeId) return res.status(400).json({ ok: false, error: "pipeId mancante" });
      const rawDate = req.query.date || req.query.asOfDate || req.query.scoreDate || null;
      const asOfDate = rawDate ? String(rawDate).slice(0, 10) : new Date().toISOString().slice(0, 10);

      const [filtersResp, orderResp, fundamentalsResp] = await Promise.all([
        axios.get(`${dbmanagerUrl}/fundamentals/user-filters/${userId}?pipeId=${encodeURIComponent(pipeId)}`, { timeout: 6000 }),
        axios.get(`${dbmanagerUrl}/fundamentals/user-order/${userId}?pipeId=${encodeURIComponent(pipeId)}`, { timeout: 6000 }),
        axios.get(
          `${dbmanagerUrl}/fundamentals/scores-daily/by-user?user_id=${encodeURIComponent(userId)}&pipe_id=${encodeURIComponent(pipeId)}&score_date=${encodeURIComponent(asOfDate)}`,
          { timeout: 8000, transformResponse: (r) => r }
        ),
      ]);

      const fundamentalsPayload = (() => { try { return typeof fundamentalsResp.data === "string" ? JSON.parse(fundamentalsResp.data) : fundamentalsResp.data; } catch { return fundamentalsResp.data; } })();
      const fundamentalsList = Array.isArray(fundamentalsPayload?.data) ? fundamentalsPayload.data : Array.isArray(fundamentalsPayload) ? fundamentalsPayload : [];
      const normalizedList = fundamentalsList.map(normalizeRecordForFilters);
      const filters = normalizeUserFilters(filtersResp?.data?.data || filtersResp?.data || []);
      const orders = normalizeUserOrder(orderResp?.data?.data || orderResp?.data || []);
      const filtered = applyUserFilters(normalizedList, filters);
      const ordered = applyUserOrder(filtered, orders);
      const appliedFilters = filters.filter((f) => f?.enabled);

      const meta = { pipeId, asOfDate, total: fundamentalsList.length, filtered: ordered.length, appliedFilters: appliedFilters.length, appliedOrder: orders.length, filters: appliedFilters, order: orders };
      if (fundamentalsPayload && typeof fundamentalsPayload === "object" && !Array.isArray(fundamentalsPayload)) {
        return res.json({ ...fundamentalsPayload, data: ordered, meta: { ...(fundamentalsPayload.meta || {}), ...meta } });
      }
      return res.json({ ok: true, data: ordered, meta });
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(err?.response?.status || 500).json({ ok: false, error: "Errore pipeline fundamentals" });
    }
  });

  // ---- user score-weights ----

  router.get("/user/score-weights/:pipeId", async (req, res) => {
    const fn = "userData.GET:/user/score-weights/:pipeId";
    try {
      const userId = await fetchUserId(req);
      const pipeId = Number(req.params.pipeId);
      if (!userId || !Number.isFinite(pipeId)) return res.status(401).json({ ok: false, error: "User o pipe non identificato" });
      const url = `${dbmanagerUrl}/auth/users/${userId}/score-weights/${encodeURIComponent(pipeId)}`;
      logger.info(`${fn} proxying ${safeStringify({ url, userId, pipeId })}`);
      const resp = await axios.get(url, { timeout: 6000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(err?.response?.status || 500).json({ ok: false, error: err?.response?.data || "Errore lettura score_weights" });
    }
  });

  router.put("/user/score-weights/:pipeId", async (req, res) => {
    const fn = "userData.PUT:/user/score-weights/:pipeId";
    try {
      const userId = await fetchUserId(req);
      const pipeId = Number(req.params.pipeId);
      if (!userId || !Number.isFinite(pipeId)) return res.status(401).json({ ok: false, error: "User o pipe non identificato" });
      const body = { ...req.body, user_id: userId, pipe_id: pipeId, pipeId };
      const url = `${dbmanagerUrl}/auth/users/${userId}/score-weights/${encodeURIComponent(pipeId)}`;
      logger.info(`${fn} proxying ${safeStringify({ url, userId, pipeId })}`);
      const resp = await axios.put(url, body, { timeout: 8000 });
      return res.json(resp.data);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(err?.response?.status || 500).json({ ok: false, error: err?.response?.data || "Errore aggiornamento score_weights" });
    }
  });

  // ---- recalculate-user ----

  router.post("/recalculate-user", async (req, res) => {
    const fn = "userData.POST:/recalculate-user";
    try {
      const userId = await fetchUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
      const weights = await fetchUserWeights(req.headers.authorization);
      const service = getService();
      const data = await service.fundamentalService.getAll();
      if (!Array.isArray(data)) return res.status(500).json({ ok: false, error: "Dati fundamentals non validi" });
      let saved = 0;
      for (const row of data) {
        const decorated = decorate(row, weights);
        let momentumObj = null;
        try { if (row?.momentum_json) momentumObj = typeof row.momentum_json === "string" ? JSON.parse(row.momentum_json) : row.momentum_json; } catch { momentumObj = null; }
        const momentumShortScore = decorated?.momentum_short_score ?? row?.momentum_short_score ?? momentumObj?.components?.momentumShort?.score ?? null;
        const doubleTopScore = momentumObj?.components?.doubleTop?.score ?? momentumObj?.doubleTopScore ?? momentumObj?.doubleTop?.score ?? null;
        const payload = {
          user_id: userId,
          symbol: row.symbol,
          valuation_score: decorated?.valuation_score ?? row?.valuation_score ?? null,
          quality_score: decorated?.quality_score ?? row?.quality_score ?? null,
          risk_score: decorated?.risk_score ?? row?.risk_score ?? null,
          momentum_score: decorated?.momentum_score ?? row?.momentum_score ?? null,
          momentum_short_score: momentumShortScore,
          grow_score: decorated?.growth_probability ?? row?.growth_probability ?? null,
          double_top_score: doubleTopScore ?? null,
        };
        await axios.post(`${dbmanagerUrl}/fundamentals/user-fundamentals`, payload, { timeout: 8000 });
        saved += 1;
      }
      return res.json({ ok: true, saved });
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
      return res.status(500).json({ ok: false, error: "Errore ricalcolo user fundamentals" });
    }
  });

  // ---- fundamentals data routes (catch-all last) ----

  // GET /fundamentals -> all symbols
  router.get("/", async (req, res) => {
    const fn = "userData.GET:/";
    try {
      const weights = await fetchUserWeights(req.headers.authorization);
      const service = getService();
      const data = await service.fundamentalService.getAll();
      const decorated = Array.isArray(data) ? data.map((row) => decorate(row, weights)) : data;
      return res.json(decorated);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.message || err)}`);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /fundamentals/lastCandel -> recalculate momentum for given candles
  router.post("/lastCandel", async (req, res) => {
    const fn = "userData.POST:/lastCandel";
    const items = Array.isArray(req.body) ? req.body : req.body?.items;
    if (!Array.isArray(items)) return res.status(400).json({ ok: false, error: "Body must be an array or have items array" });
    try {
      const weights = await fetchUserWeights(req.headers.authorization);
      const service = getService();
      const results = await service.recalcMomentumForLastCandles(items);
      const decorated = Array.isArray(results)
        ? results.map((r) => {
            const { marketScore, marketRiskScore, shortRiskScore } = normalizeShortRisk({ risk_score: r?.risk_score ?? null }, r?.momentum, weights);
            const momentumScore = computeMomentumLongScore(r?.momentum, weights) ?? safeNum(r?.momentum?.score ?? r?.momentum_score);
            const growthProbability = computeGrowthProbability({ risk_score: r?.risk_score ?? null, momentum_score: momentumScore }, r?.momentum, weights);
            const volumeScore = computeVolumeScore(r?.momentum, weights);
            const momentumShortScore = computeMomentumShortScore(r?.momentum, weights);
            return {
              ...r,
              market_score: marketScore,
              market_risk_score: marketRiskScore,
              short_risk_score: shortRiskScore,
              growth_probability: growthProbability,
              volume_score: volumeScore,
              momentum_score: momentumScore ?? r?.momentum_score ?? null,
              momentum_short_score: momentumShortScore ?? r?.momentum_short_score ?? null,
            };
          })
        : results;
      return res.json({ ok: true, count: Array.isArray(decorated) ? decorated.length : 0, results: decorated });
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.message || err)}`);
      return res.status(500).json({ ok: false, error: err?.message || "Internal server error" });
    }
  });

  // GET /fundamentals/:symbol -> single symbol (MUST be last - catch-all)
  router.get("/:symbol", async (req, res) => {
    const fn = "userData.GET:/:symbol";
    const { symbol } = req.params;
    try {
      if (!symbol) return res.status(400).json({ error: "symbol is required" });
      const weights = await fetchUserWeights(req.headers.authorization);
      const service = getService();
      const data = await service.fundamentalService.getOne(symbol);
      if (!data || (Array.isArray(data) && data.length === 0)) return res.status(404).json({ error: "Not found" });
      const decorated = Array.isArray(data) ? data.map((row) => decorate(row, weights)) : decorate(data, weights);
      return res.json(decorated);
    } catch (err) {
      logger.error(`${fn} error ${safeStringify(err?.message || err)}`);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
};
