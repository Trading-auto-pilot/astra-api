"use strict";

const path = require("path");
const fs = require("fs/promises");

function resolveMicroserviceName({ microserviceName, manifest, serviceRootDir }) {
  if (microserviceName) return microserviceName;
  if (manifest && typeof manifest.service === "string" && manifest.service.trim()) {
    return manifest.service.trim();
  }
  if (process.env.MICROSERVICE_NAME) return process.env.MICROSERVICE_NAME;
  if (serviceRootDir) return path.basename(serviceRootDir);
  return "unknown-service";
}

async function publishEventsManifest({
  bus,
  logger,
  microserviceName,
  serviceRootDir,
  manifestFileName = "events.manifest.json",
  redisKeyPrefix = "EVENTS",
}) {
  if (!bus || typeof bus.set !== "function") {
    logger?.warning?.("[events-manifest] skip: bus.set() not available");
    return { ok: false, reason: "bus.set_not_available" };
  }

  const rootDir = serviceRootDir || process.cwd();
  const manifestPath = path.resolve(rootDir, manifestFileName);

  let manifest;
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    manifest = JSON.parse(raw);
  } catch (err) {
    if (err?.code === "ENOENT") {
      logger?.trace?.(`[events-manifest] file not found: ${manifestPath}`);
      return { ok: false, reason: "manifest_not_found", path: manifestPath };
    }
    logger?.warning?.(
      `[events-manifest] read/parse failed path=${manifestPath} err=${err?.message || String(err)}`
    );
    return { ok: false, reason: "manifest_invalid", path: manifestPath };
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    logger?.warning?.(`[events-manifest] invalid content path=${manifestPath}`);
    return { ok: false, reason: "manifest_invalid_shape", path: manifestPath };
  }

  const microservice = resolveMicroserviceName({
    microserviceName,
    manifest,
    serviceRootDir: rootDir,
  });
  const redisKey = `${redisKeyPrefix}:${microservice}`;
  await bus.set(redisKey, manifest);

  logger?.info?.(
    `[events-manifest] registered key=${redisKey} path=${manifestPath}`
  );

  return { ok: true, key: redisKey, path: manifestPath };
}

module.exports = {
  publishEventsManifest,
};
