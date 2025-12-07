"use strict";

const { minimatch } = require("minimatch");

module.exports = function buildAuthorization({ logger, userClient }) {

  /**
   * Verifica se un soggetto (user o apiKey) può chiamare path/metodo.
   */
  async function authorize({ subjectType, subjectId, method, path }) {
    logger.trace(`[authorization] START check: ${subjectType}:${subjectId} → ${method} ${path}`);

    try {
      // 1) Recupero permessi dal DBManager
      logger.trace(`[authorization] Fetching permissions for ${subjectType}:${subjectId}`);
      const perms = await userClient.listUserPermissions(subjectId);

      if (!Array.isArray(perms) || perms.length === 0) {
        logger.trace(`[authorization] No permissions found → DENY`);
        return { allowed: false, reason: "No permissions found" };
      }

      logger.trace(`[authorization] ${perms.length} permission(s) loaded from DB:`);

      perms.forEach((p, idx) => {
        logger.trace(
          `  [perm ${idx}] code=${p.permission_code} allowed=${p.is_allowed} pattern="${p.resource_pattern}" method=${p.http_method}`
        );
      });

      // 2) ADMIN_ALL → bypass
      const isAdmin = perms.some(
        (p) => p.permission_code === "ADMIN_ALL" && p.is_allowed
      );

      if (isAdmin) {
        logger.trace(`[authorization] ADMIN_ALL detected → ALLOW`);
        return { allowed: true, reason: "ADMIN_ALL" };
      }

      logger.trace(`[authorization] No ADMIN privilege → checking granular permissions...`);

      // 3) Verifica permessi granulari
      for (const p of perms) {
        if (!p.is_allowed) {
          logger.trace(`[authorization] Skipped perm "${p.permission_code}" → not allowed`);
          continue;
        }

        const methodOk = p.http_method === "ANY" || p.http_method === method;
        if (!methodOk) {
          logger.trace(
            `[authorization] Method mismatch: needed ${p.http_method}, got ${method}`
          );
          continue;
        }

        const pattern = p.resource_pattern || "";
        if (!pattern) {
          logger.trace(
            `[authorization] Skipped perm "${p.permission_code}" → no resource_pattern`
          );
          continue;
        }

        const pathOk = minimatch(path, pattern, { nocase: true });

        logger.trace(
          `[authorization] Testing pattern "${pattern}" against path "${path}" → ${pathOk}`
        );

        if (pathOk) {
          logger.trace(
            `[authorization] MATCH! perm="${p.permission_code}" → ALLOW`
          );
          return {
            allowed: true,
            reason: `Matched pattern ${pattern}`,
          };
        }
      }

      logger.trace(`[authorization] No permission matched → DENY`);
      return { allowed: false, reason: "No matching permission" };

    } catch (err) {
      logger.error(`[authorization] ERROR: ${err.message}`);
      return { allowed: false, reason: "Authorization error" };
    }
  }

  return { authorize };
};
