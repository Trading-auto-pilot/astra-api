"use strict";

let josePromise = null;
const loadJose = async () => {
  if (!josePromise) josePromise = import("jose");
  return josePromise;
};

const DEFAULT_ISSUER = "astraai-internal";
const DEFAULT_ALG = "EdDSA";

const pemCache = new Map();

const normalizePem = (value) => {
  if (!value || typeof value !== "string") return null;
  if (value.includes("BEGIN")) {
    return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
  }
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (decoded.includes("BEGIN")) {
      return decoded.includes("\\n") ? decoded.replace(/\\n/g, "\n") : decoded;
    }
  } catch {
    // ignore base64 decode errors
  }
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
};

const readPrivateKey = async (pem, alg) => {
  const { importPKCS8 } = await loadJose();
  const key = normalizePem(pem);
  if (!key) return null;
  const cacheKey = `priv:${alg}:${key}`;
  if (pemCache.has(cacheKey)) return pemCache.get(cacheKey);
  const imported = await importPKCS8(key, alg);
  pemCache.set(cacheKey, imported);
  return imported;
};

const readPublicKey = async (pem, alg) => {
  const { importSPKI } = await loadJose();
  const key = normalizePem(pem);
  if (!key) return null;
  const cacheKey = `pub:${alg}:${key}`;
  if (pemCache.has(cacheKey)) return pemCache.get(cacheKey);
  const imported = await importSPKI(key, alg);
  pemCache.set(cacheKey, imported);
  return imported;
};

const normalizeScopes = (scp) => {
  if (!scp) return [];
  if (Array.isArray(scp)) return scp.map((s) => String(s).trim()).filter(Boolean);
  return String(scp)
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
};

async function signInternalToken(payload = {}, options = {}) {
  const { SignJWT } = await loadJose();
  const alg = options.alg || DEFAULT_ALG;
  const issuer = options.issuer || DEFAULT_ISSUER;
  const audience = options.audience || options.aud || undefined;
  const ttlSeconds = Number.isFinite(options.ttlSeconds)
    ? options.ttlSeconds
    : 60;
  const scope = options.scope;

  const privateKeyPem =
    options.privateKey || process.env.INTERNAL_JWT_PRIVATE_KEY;
  if (!privateKeyPem) {
    throw new Error("INTERNAL_JWT_PRIVATE_KEY missing");
  }

  const privateKey = await readPrivateKey(privateKeyPem, alg);
  if (!privateKey) throw new Error("Invalid INTERNAL_JWT_PRIVATE_KEY");

  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload };
  if (scope && !body.scp && !body.scope) {
    body.scp = scope;
  }

  const jwt = await new SignJWT(body)
    .setProtectedHeader({ alg, typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .setIssuer(issuer)
    .setAudience(audience)
    .sign(privateKey);

  return jwt;
}

async function verifyInternalToken(token, options = {}) {
  const { jwtVerify } = await loadJose();
  if (!token || typeof token !== "string") {
    throw new Error("Missing token");
  }
  const alg = options.alg || DEFAULT_ALG;
  const issuer = options.issuer || DEFAULT_ISSUER;
  const audience = options.audience || options.aud || undefined;
  const requiredScope = options.scope;

  const publicKeyPem =
    options.publicKey || process.env.INTERNAL_JWT_PUBLIC_KEY;
  if (!publicKeyPem) {
    throw new Error("INTERNAL_JWT_PUBLIC_KEY missing");
  }

  const publicKey = await readPublicKey(publicKeyPem, alg);
  if (!publicKey) throw new Error("Invalid INTERNAL_JWT_PUBLIC_KEY");

  const { payload } = await jwtVerify(token, publicKey, {
    issuer,
    audience,
  });

  if (requiredScope) {
    const required = normalizeScopes(requiredScope);
    const tokenScopes = normalizeScopes(payload.scp || payload.scope);
    const ok = required.every((s) => tokenScopes.includes(s));
    if (!ok) throw new Error("Missing scope");
  }

  return payload;
}

module.exports = {
  signInternalToken,
  verifyInternalToken,
};
