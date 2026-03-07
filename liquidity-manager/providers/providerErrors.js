"use strict";

function createProviderError(code, message, details) {
  const err = new Error(message);
  err.code = code || "PROVIDER_ERROR";
  if (details !== undefined) err.details = details;
  return err;
}

function summarizeError(err) {
  if (!err) return { code: "UNKNOWN", message: "Unknown error" };
  return {
    code: err.code || "UNKNOWN",
    message: err.message || String(err),
    details: err.details,
  };
}

module.exports = {
  createProviderError,
  summarizeError,
};

