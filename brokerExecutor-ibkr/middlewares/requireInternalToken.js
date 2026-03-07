"use strict";

const { verifyInternalToken } = require("../../shared/internalAuth");

function requireInternalToken({ logger }) {
  return async function internalTokenMiddleware(req, res, next) {
    const token = req.headers["x-internal-token"] || req.headers["X-Internal-Token"];
    if (!token || typeof token !== "string") {
      return res.status(403).json({ ok: false, error: "Internal token missing" });
    }

    const verifyOptions = {
      issuer: process.env.INTERNAL_JWT_ISSUER || "astraai-internal",
      publicKey: process.env.INTERNAL_JWT_PUBLIC_KEY,
    };

    const audience = process.env.INTERNAL_JWT_AUDIENCE || "";
    if (audience.trim()) verifyOptions.audience = audience.trim();

    const scope = process.env.INTERNAL_JWT_SCOPE || "";
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
