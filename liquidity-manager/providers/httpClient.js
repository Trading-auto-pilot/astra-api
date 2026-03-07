"use strict";

const https = require("https");
const http = require("http");

const DEFAULT_TIMEOUT_MS = Number(process.env.LIQUIDITY_HTTP_TIMEOUT_MS) || 10000;

function requestRawDetailed(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const client = url.startsWith("https:") ? https : http;
    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const latencyMs = Date.now() - startedAt;
        if (res.statusCode >= 400) {
          const err = new Error(`HTTP ${res.statusCode} for ${url}`);
          err.code = "HTTP_ERROR";
          err.statusCode = res.statusCode;
          err.details = {
            url,
            statusCode: res.statusCode,
            latencyMs,
            payloadBytes: Buffer.byteLength(body || "", "utf8"),
          };
          return reject(err);
        }
        resolve({
          body,
          statusCode: res.statusCode,
          headers: res.headers,
          latencyMs,
          payloadBytes: Buffer.byteLength(body || "", "utf8"),
        });
      });
    });
    req.on("timeout", () => {
      const err = new Error(`Timeout after ${timeoutMs}ms`);
      err.code = "TIMEOUT";
      err.details = { timeoutMs, url };
      req.destroy(err);
    });
    req.on("error", reject);
  });
}

function requestRaw(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return requestRawDetailed(url, timeoutMs).then((res) => res.body);
}

function parseCsv(csv) {
  const lines = String(csv || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const parts = line.split(",");
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (parts[idx] || "").trim();
    });
    return row;
  });
}

module.exports = {
  requestRaw,
  requestRawDetailed,
  parseCsv,
};
