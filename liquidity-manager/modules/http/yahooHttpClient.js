"use strict";

const https = require("https");
const http = require("http");
const { getConfigNumber } = require("../../../shared/loadSettings");

const DEFAULT_TIMEOUT_MS = getConfigNumber("YAHOO_TIMEOUT_MS", 8000);

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Connection: "keep-alive",
  Referer: "https://finance.yahoo.com/",
};

function toLowerCaseHeaders(headers = {}) {
  const out = {};
  Object.entries(headers || {}).forEach(([k, v]) => {
    out[String(k).toLowerCase()] = v;
  });
  return out;
}

function parseRetryAfterSec(value) {
  if (value == null) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return n;
  const when = new Date(String(raw)).getTime();
  if (!Number.isFinite(when)) return null;
  return Math.max(0, Math.round((when - Date.now()) / 1000));
}

async function yahooGet(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const startMs = Date.now();
  return new Promise((resolve, reject) => {
    const client = String(url).startsWith("https:") ? https : http;
    const req = client.get(
      url,
      {
        timeout: timeoutMs,
        headers: DEFAULT_HEADERS,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const latencyMs = Date.now() - startMs;
          const headers = toLowerCaseHeaders(res.headers || {});
          const statusCode = Number(res.statusCode || 0);
          if (statusCode >= 400) {
            const err = new Error(`HTTP ${statusCode}`);
            err.code = "HTTP_ERROR";
            err.statusCode = statusCode;
            err.details = {
              url,
              statusCode,
              latencyMs,
              payloadBytes: Buffer.byteLength(body || "", "utf8"),
              retryAfterSec: parseRetryAfterSec(headers["retry-after"]),
              headers: {
                "retry-after": headers["retry-after"] || null,
                "x-request-id": headers["x-request-id"] || null,
              },
            };
            return reject(err);
          }
          resolve({
            body,
            statusCode,
            headers,
            latencyMs,
            payloadBytes: Buffer.byteLength(body || "", "utf8"),
          });
        });
      }
    );

    req.on("timeout", () => {
      const err = new Error(`Timeout after ${timeoutMs}ms`);
      err.code = "TIMEOUT";
      err.details = { url, timeoutMs };
      req.destroy(err);
    });
    req.on("error", (err) => {
      if (!err.code) err.code = "NETWORK_ERROR";
      if (!err.details) err.details = { url };
      reject(err);
    });
  });
}

module.exports = {
  yahooGet,
};
