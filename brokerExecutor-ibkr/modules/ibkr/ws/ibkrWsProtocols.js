"use strict";

const SUBSCRIBE_LIVE_ORDERS = "sor+{}";
const UNSUBSCRIBE_LIVE_ORDERS = "uor+{}";

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function decodeWsMessage(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "");
  const trimmed = text.trim();
  if (!trimmed) return { topic: "unknown", payload: null, raw: text };

  if (trimmed.startsWith("sor+")) {
    const suffix = trimmed.slice(4).trim();
    const payload = suffix ? safeParseJson(suffix) ?? suffix : {};
    return { topic: "sor", payload, raw: text };
  }
  if (trimmed.startsWith("uor+")) {
    const suffix = trimmed.slice(4).trim();
    const payload = suffix ? safeParseJson(suffix) ?? suffix : {};
    return { topic: "uor", payload, raw: text };
  }

  const parsed = safeParseJson(trimmed);
  if (parsed != null) {
    const topic = String(parsed.topic || parsed.channel || parsed.name || "json").toLowerCase();
    return { topic, payload: parsed, raw: text };
  }

  return { topic: "text", payload: trimmed, raw: text };
}

module.exports = {
  SUBSCRIBE_LIVE_ORDERS,
  UNSUBSCRIBE_LIVE_ORDERS,
  decodeWsMessage,
};
