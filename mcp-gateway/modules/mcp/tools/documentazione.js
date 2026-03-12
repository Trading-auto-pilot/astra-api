"use strict";

const { traefikFetch } = require("./_http");

const DOCS_API_BASE_URL = String(process.env.DOCS_API_BASE_URL || "").trim().replace(/\/+$/, "");
const DOCS_API_PATH_PREFIX = (process.env.DOCS_API_PATH_PREFIX || "/help-api/api/docs").replace(/\/+$/, "");
const DOCS_API_READ_TIMEOUT_MS = Number(process.env.DOCS_API_READ_TIMEOUT_MS || 15000);
const DOCS_API_WRITE_TIMEOUT_MS = Number(process.env.DOCS_API_WRITE_TIMEOUT_MS || 180000);

const ACTIONS = new Set([
  "list_pages",
  "create_page",
  "delete_page",
  "list_paragraphs",
  "add_paragraph",
  "update_paragraph",
  "delete_paragraph",
]);

function docsPath(path) {
  const suffix = String(path || "").startsWith("/") ? path : `/${path}`;
  return `${DOCS_API_PATH_PREFIX}${suffix}`;
}

function docsUrl(path) {
  const suffix = String(path || "").startsWith("/") ? path : `/${path}`;
  return `${DOCS_API_BASE_URL}${suffix}`;
}

async function directFetch(path, method = "GET", body = null, timeoutMs = 10000) {
  const url = docsUrl(path);
  const headers = { "Content-Type": "application/json" };

  const init = {
    method,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (body !== null && (method === "POST" || method === "PUT")) {
    init.body = JSON.stringify(body);
  }

  const resp = await fetch(url, init);
  if (!resp.ok) {
    throw new Error(`${resp.status} ${resp.statusText} — ${url}`);
  }

  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) return resp.json();

  const raw = await resp.text();
  try {
    return JSON.parse(raw);
  } catch {
    return { ok: true, raw };
  }
}

async function docsFetch(path, method = "GET", body = null, timeoutMs = 10000) {
  if (DOCS_API_BASE_URL) {
    return directFetch(path, method, body, timeoutMs);
  }
  return traefikFetch(docsPath(path), method, body, timeoutMs);
}

module.exports = {
  name: "documentazione",
  description:
    "Gestisce la documentazione roadmap di help-trading tramite API: list/create/delete pagine e list/add/update/delete paragrafi.",

  inputSchema: {
    action: {
      type: "string",
      description:
        "Azione da eseguire: list_pages, create_page, delete_page, list_paragraphs, add_paragraph, update_paragraph, delete_paragraph",
      required: true,
    },
    slug: {
      type: "string",
      description: "Slug pagina roadmap (richiesto per delete_page e azioni paragrafi).",
      required: false,
    },
    title: {
      type: "string",
      description: "Titolo pagina/paragrafo (richiesto per create_page, add_paragraph, opzionale per update_paragraph).",
      required: false,
    },
    description: {
      type: "string",
      description: "Descrizione pagina (richiesta per create_page).",
      required: false,
    },
    content: {
      type: "string",
      description: "Contenuto markdown del paragrafo (richiesto per add_paragraph, opzionale per update_paragraph).",
      required: false,
    },
    number: {
      type: "number",
      description: "Numero paragrafo (richiesto per update_paragraph e delete_paragraph).",
      required: false,
    },
  },

  validate(input) {
    const action = String(input?.action || "").trim();
    if (!action) return "action is required";
    if (!ACTIONS.has(action)) {
      return `invalid action "${action}". Allowed: ${Array.from(ACTIONS).join(", ")}`;
    }

    const slug = input?.slug;
    const title = input?.title;
    const description = input?.description;
    const content = input?.content;
    const number = input?.number;

    if (action === "create_page") {
      if (!title || typeof title !== "string" || !title.trim()) return "title is required for create_page";
      if (!description || typeof description !== "string" || !description.trim()) {
        return "description is required for create_page";
      }
      if (!slug || typeof slug !== "string" || !slug.trim()) return "slug is required for create_page";
    }

    if (action === "delete_page" || action === "list_paragraphs" || action === "add_paragraph") {
      if (!slug || typeof slug !== "string" || !slug.trim()) return "slug is required";
    }

    if (action === "add_paragraph") {
      if (!title || typeof title !== "string" || !title.trim()) return "title is required for add_paragraph";
      if (!content || typeof content !== "string" || !content.trim()) return "content is required for add_paragraph";
    }

    if (action === "update_paragraph" || action === "delete_paragraph") {
      if (!slug || typeof slug !== "string" || !slug.trim()) return "slug is required";
      if (!Number.isInteger(number) || number <= 0) return "number must be a positive integer";
    }

    if (action === "update_paragraph") {
      const hasTitle = typeof title === "string" && title.trim().length > 0;
      const hasContent = typeof content === "string" && content.trim().length > 0;
      if (!hasTitle && !hasContent) {
        return "update_paragraph requires at least one of: title, content";
      }
    }

    return null;
  },

  async handler(ctx, input) {
    const { logger } = ctx;
    const action = String(input.action).trim();

    try {
      if (action === "list_pages") {
        const body = await docsFetch("/roadmap/titles", "GET", null, DOCS_API_READ_TIMEOUT_MS);
        return { ok: true, data: body };
      }

      if (action === "create_page") {
        const body = await docsFetch("/roadmap", "POST", {
          title: String(input.title).trim(),
          description: String(input.description).trim(),
          slug: String(input.slug).trim(),
        }, DOCS_API_WRITE_TIMEOUT_MS);
        return { ok: true, data: body };
      }

      if (action === "delete_page") {
        const body = await docsFetch(
          `/roadmap/${encodeURIComponent(String(input.slug).trim())}`,
          "DELETE",
          null,
          DOCS_API_WRITE_TIMEOUT_MS
        );
        return { ok: true, data: body };
      }

      if (action === "list_paragraphs") {
        const body = await docsFetch(
          `/roadmap/${encodeURIComponent(String(input.slug).trim())}/paragraphs`,
          "GET",
          null,
          DOCS_API_READ_TIMEOUT_MS
        );
        return { ok: true, data: body };
      }

      if (action === "add_paragraph") {
        const body = await docsFetch(
          `/roadmap/${encodeURIComponent(String(input.slug).trim())}/paragraphs`,
          "PUT",
          {
            title: String(input.title).trim(),
            content: String(input.content).trim(),
          },
          DOCS_API_WRITE_TIMEOUT_MS
        );
        return { ok: true, data: body };
      }

      if (action === "update_paragraph") {
        const payload = {};
        if (typeof input.title === "string" && input.title.trim()) payload.title = input.title.trim();
        if (typeof input.content === "string" && input.content.trim()) payload.content = input.content.trim();

        const body = await docsFetch(
          `/roadmap/${encodeURIComponent(String(input.slug).trim())}/paragraphs/${input.number}`,
          "PUT",
          payload,
          DOCS_API_WRITE_TIMEOUT_MS
        );
        return { ok: true, data: body };
      }

      if (action === "delete_paragraph") {
        const body = await docsFetch(
          `/roadmap/${encodeURIComponent(String(input.slug).trim())}/paragraphs/${input.number}`,
          "DELETE",
          null,
          DOCS_API_WRITE_TIMEOUT_MS
        );
        return { ok: true, data: body };
      }

      return {
        ok: false,
        error: { code: "INVALID_ACTION", message: `Action "${action}" is not implemented.` },
      };
    } catch (err) {
      const msg = err?.message || String(err);
      logger?.warning?.(`[mcp/documentazione] action=${action} failed: ${msg}`);
      return {
        ok: false,
        error: {
          code: "FETCH_ERROR",
          message: msg,
        },
      };
    }
  },
};
