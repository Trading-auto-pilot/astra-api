"use strict";

function round(value, precision = 2) {
  const f = 10 ** precision;
  return Math.round(value * f) / f;
}

function timeoutError(timeoutMs, name) {
  const err = new Error(`Component ${name} timed out after ${timeoutMs}ms`);
  err.code = "TIMEOUT";
  err.details = { timeoutMs, name };
  return err;
}

function withTimeout(promise, timeoutMs, name) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(timeoutError(timeoutMs, name)), timeoutMs)
    ),
  ]);
}

function classifyErrorStatus(err) {
  const code = String(err?.code || "").toUpperCase();
  if (
    code === "CONFIG_MISSING" ||
    code === "CONFIG_DISABLED" ||
    code === "NO_DATA" ||
    code === "NOT_AVAILABLE"
  ) {
    return "MISSING";
  }
  return "ERROR";
}

async function runComponent({
  name,
  weight,
  fetchFn,
  normalizeFn,
  logger,
  timeoutMs = Number(process.env.LIQ_PROVIDER_TIMEOUT_MS) || 5000,
}) {
  const startedAt = new Date().toISOString();
  try {
    const fetched = await withTimeout(Promise.resolve().then(() => fetchFn()), timeoutMs, name);
    const normalizedPayload = await Promise.resolve().then(() => normalizeFn(fetched));
    const normalized = Number(normalizedPayload?.normalized);
    const status = Number.isFinite(normalized) ? "OK" : "MISSING";
    const out = {
      weight,
      status,
      raw:
        normalizedPayload?.raw == null
          ? null
          : Number.isFinite(Number(normalizedPayload.raw))
            ? Number(normalizedPayload.raw)
            : normalizedPayload.raw,
      normalized: Number.isFinite(normalized) ? round(normalized, 2) : null,
      timestamp: normalizedPayload?.timestamp || startedAt,
      source: normalizedPayload?.source || "unknown",
      details: normalizedPayload?.details,
      note: normalizedPayload?.note,
      error: null,
    };
    if (status !== "OK") {
      out.error = {
        code: "NORMALIZATION_MISSING",
        message: normalizedPayload?.note || `Component ${name} has no normalized value`,
      };
      logger?.warn?.(`component=${name} status=${status} reason=${out.error.message}`);
    }
    return out;
  } catch (err) {
    const status = classifyErrorStatus(err);
    logger?.warn?.(
      `component=${name} status=${status} code=${err?.code || "UNKNOWN"} message=${err?.message || String(err)}`
    );
    logger?.debug?.(err?.stack || String(err));
    return {
      weight,
      status,
      raw: null,
      normalized: null,
      timestamp: startedAt,
      source: "missing",
      error: {
        code: err?.code || "UNKNOWN",
        message: err?.message || String(err),
        details: err?.details,
      },
    };
  }
}

module.exports = {
  runComponent,
  classifyErrorStatus,
};

