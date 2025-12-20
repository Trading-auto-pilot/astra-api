// modules/serviceFlags.js
"use strict";

const axios = require("axios");

function createServiceFlagsClient(dbmanagerUrl, logger) {
  const api = axios.create({
    baseURL: dbmanagerUrl,
    timeout: 8000,
  });

  const log = logger?.forModule
    ? logger.forModule("serviceFlagsClient")
    : logger;

  return {
    async list() {
      try {
        const res = await api.get("/serviceflags");
        return res.data?.items ?? res.data ?? [];
      } catch (err) {
        log?.error?.("[serviceFlags.list] error", err.message || err);
        throw err;
      }
    },

    async get(id) {
      try {
        const res = await api.get(`/serviceflags/${id}`);
        return res.data?.item ?? res.data ?? null;
      } catch (err) {
        log?.error?.("[serviceFlags.get] error", err.message || err);
        throw err;
      }
    },

    async create(payload) {
      try {
        const res = await api.post("/serviceflags", payload);
        return res.data;
      } catch (err) {
        log?.error?.("[serviceFlags.create] error", err.message || err);
        throw err;
      }
    },

    async update(id, payload) {
      try {
        const res = await api.put(`/serviceflags/${id}`, payload);
        return res.data;
      } catch (err) {
        log?.error?.("[serviceFlags.update] error", err.message || err);
        throw err;
      }
    },

    async remove(id) {
      try {
        const res = await api.delete(`/serviceflags/${id}`);
        return res.data;
      } catch (err) {
        log?.error?.("[serviceFlags.remove] error", err.message || err);
        throw err;
      }
    },
  };
}

module.exports = {
  createServiceFlagsClient,
};
