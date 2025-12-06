"use strict";

const minimatch = require("minimatch"); 
// se vuoi usare wildcard tipo /scheduler/*
// installalo se manca: npm install minimatch

module.exports = function buildAuthorization({ logger, userClient }) {

  /**
   * Verifica se un utente/API_KEY è autorizzato a chiamare path/metodo.
   *
   * @param {object} params
   * @param {"user"|"apiKey"} params.subjectType
   * @param {number} params.subjectId
   * @param {string} params.method - es. "GET"
   * @param {string} params.path - es. "/scheduler/jobs"
   *
   * @returns {Promise<{allowed:boolean, reason:string}>}
   */
  async function authorize({ subjectType, subjectId, method, path }) {
    try {
      logger.trace(`[authorization] checking ${subjectType}:${subjectId} ${method} ${path}`);

      // 1) recupero permessi da DBManager
      const perms = await userClient.getPermissionsForSubject(subjectType, subjectId);

      if (!Array.isArray(perms) || perms.length === 0) {
        return { allowed: false, reason: "No permissions found" };
      }

      // 2) ADMIN_ALL → bypass totale
      const isAdmin = perms.some(
        (p) => p.permission_code === "ADMIN_ALL" && p.is_allowed
      );
      if (isAdmin) {
        return { allowed: true, reason: "ADMIN_ALL" };
      }

      // 3) verifica permessi granulari
      for (const p of perms) {
        if (!p.is_allowed) continue;

        // metodo
        const methodOk = p.http_method === "ANY" || p.http_method === method;
        if (!methodOk) continue;

        // pattern
        const pattern = p.resource_pattern || "";
        if (!pattern) continue;

        // matching stile wildcard: /scheduler/* oppure /scheduler/** oppure /scheduler/jobs
        const pathOk = minimatch(path, pattern, { nocase: true });

        if (pathOk) {
          return { allowed: true, reason: `Matched pattern ${pattern}` };
        }
      }

      return { allowed: false, reason: "No matching permission" };

    } catch (err) {
      logger.error("[authorization] error:", err.message);
      return { allowed: false, reason: "Authorization error" };
    }
  }

  return { authorize };
};
