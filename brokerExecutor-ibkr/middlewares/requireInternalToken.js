"use strict";

const { verifyInternalToken } = require("../../shared/internalAuth");
const { getConfigString } = require("../../shared/loadSettings");

function requireInternalToken({ logger }) {
  return async function internalTokenMiddleware(req, res, next) {
    const token = req.headers["x-internal-token"] || req.headers["X-Internal-Token"];
    if (!token || typeof token !== "string") {
      return res.status(403).json({ ok: false, error: "Internal token missing" });
    }

    const verifyOptions = {
      issuer: getConfigString(["INTERNAL_JWT_ISSUER", "INTERNAL_JWT_ISS"], "astraai-internal"),
      publicKey: getConfigString("INTERNAL_JWT_PUBLIC_KEY", ""),
    };

    const audience = getConfigString("INTERNAL_JWT_AUDIENCE", "");
    if (audience.trim()) verifyOptions.audience = audience.trim();

    const scope = getConfigString("INTERNAL_JWT_SCOPE", "");
    if (scope.trim()) verifyOptions.scope = scope.trim();

    try {
      req.internalAuth = await verifyInternalToken(token, verifyOptions);
      return next();
    } catch (err) {
      logger?.warning?.(
        `[requireInternalToken] Invalid internal token: ${err?.message || String(err)}`
      );
      return res.status(403).json({ ok: false, error: "Invalid internal token" });
    }
  };
}

module.exports = { requireInternalToken };
