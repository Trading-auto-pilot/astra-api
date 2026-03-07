// modules/serviceFlags.js
"use strict";

const axios = require("axios");
const { createDatahubAdapter } = require("../../shared/datahubAdapter");

function createServiceFlagsClient(dbmanagerUrl, logger) {
  const api = createDatahubAdapter(axios.create({
    baseURL: dbmanagerUrl,
    timeout: 8000,
  }));

  const log = logger?.forModule
    ? logger.forModule("serviceFlagsClient")
    : logger;

  return {
    async list() {
      try {
        // createDatahubAdapter automatically converts { ok, data: [...] } to { items: [...] }
        const res = await api.get("/api/table/service_flags");
        return res.data?.items ?? res.data ?? [];
      } catch (err) {
        log?.error?.("[serviceFlags.list] error", err.message || err);
        throw err;
      }
    },

    async get(id) {
      try {
        // createDatahubAdapter automatically extracts data for single record
        const res = await api.get(`/api/table/service_flags/${id}`);
        return res.data ?? null;
      } catch (err) {
        log?.error?.("[serviceFlags.get] error", err.message || err);
        throw err;
      }
    },

    async create(payload) {
      try {
        // createDatahubAdapter handles POST response format
        const res = await api.post("/api/table/service_flags", payload);
        return res.data;
      } catch (err) {
        log?.error?.("[serviceFlags.create] error", err.message || err);
        throw err;
      }
    },

    async update(id, payload) {
      try {
        // createDatahubAdapter handles PUT response format
        const res = await api.put(`/api/table/service_flags/${id}`, payload);
        return res.data;
      } catch (err) {
        log?.error?.("[serviceFlags.update] error", err.message || err);
        throw err;
      }
    },

    async remove(id) {
      try {
        // createDatahubAdapter handles DELETE response format
        const res = await api.delete(`/api/table/service_flags/${id}`);
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
