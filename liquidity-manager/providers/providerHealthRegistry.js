"use strict";

const registry = new Map();

function getEntry(name) {
  if (!registry.has(name)) {
    registry.set(name, {
      name,
      lastStatus: "UNKNOWN",
      lastSuccessTimestamp: null,
      lastError: null,
      lastCheckedAt: null,
    });
  }
  return registry.get(name);
}

function markSuccess(name, info = {}) {
  const entry = getEntry(name);
  entry.lastStatus = "OK";
  entry.lastCheckedAt = new Date().toISOString();
  entry.lastSuccessTimestamp = info.timestamp || entry.lastCheckedAt;
  entry.lastError = null;
  return entry;
}

function markFailure(name, error) {
  const entry = getEntry(name);
  entry.lastStatus = error?.code === "CONFIG_MISSING" || error?.code === "CONFIG_DISABLED" ? "MISSING" : "ERROR";
  entry.lastCheckedAt = new Date().toISOString();
  entry.lastError = {
    code: error?.code || "UNKNOWN",
    message: error?.message || String(error),
    details: error?.details,
  };
  return entry;
}

function getStatus(name) {
  return { ...getEntry(name) };
}

function getAllStatuses() {
  return Array.from(registry.values()).map((it) => ({ ...it }));
}

module.exports = {
  markSuccess,
  markFailure,
  getStatus,
  getAllStatuses,
};

