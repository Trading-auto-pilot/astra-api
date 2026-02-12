"use strict";

// ---------------------------------------------------------------------------
// textResolver – risolve placeholder [[...]] in testi dinamici
//
// Sintassi supportata:
//   [[today]]                     => data odierna YYYY-MM-DD
//   [[today,DD/MM/YYYY]]         => data odierna con formato custom
//   [[today+3]]                  => oggi + 3 giorni
//   [[today-7,DD-MM-YYYY]]       => oggi - 7 giorni formattato
//   [[yesterday]]                => alias today-1
//   [[tomorrow]]                 => alias today+1
//   [[now]]                      => datetime ISO completo
//   [[now,YYYY-MM-DD HH:mm:ss]] => datetime formattato
//   [[lastBusinessDay]]          => ultimo giorno lavorativo (lun-ven)
//   [[lastBusinessDay-5]]        => 5 business day fa
//   [[lastBusinessDay,DD/MM/YYYY]] => con formato custom
//   [[timestamp]]                => unix epoch in secondi
//   [[uuid]]                     => identificativo univoco v4-like
//   [[env:NOME_VAR]]             => valore di process.env.NOME_VAR
//   [[chiave]]                   => valore da vars (se passato)
// ---------------------------------------------------------------------------

const crypto = require("crypto");

const PLACEHOLDER_RE = /\[\[([^\]]+)\]\]/g;
const DATE_BUILTIN_RE = /^(today|now|yesterday|tomorrow|lastBusinessDay)([+-]\d+)?(?:,(.+))?$/;
const ENV_RE = /^env:(.+)$/;

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Formatta una Date nativa secondo un pattern.
 * Token supportati: YYYY, MM, DD, HH, mm, ss.
 * @param {Date} date
 * @param {string} [format='YYYY-MM-DD']
 * @returns {string}
 */
function formatDate(date, format = "YYYY-MM-DD") {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error(`[textResolver] Data non valida: ${date}`);
  }
  const tokens = {
    YYYY: String(date.getFullYear()),
    MM: pad2(date.getMonth() + 1),
    DD: pad2(date.getDate()),
    HH: pad2(date.getHours()),
    mm: pad2(date.getMinutes()),
    ss: pad2(date.getSeconds()),
  };
  let result = format;
  for (const [token, value] of Object.entries(tokens)) {
    result = result.split(token).join(value);
  }
  return result;
}

/**
 * Calcola l'ultimo giorno lavorativo (lun-ven) a partire da una data,
 * poi applica un offset in business day.
 * Offset 0  = ultimo business day <= date
 * Offset -N = N business day indietro
 * Offset +N = N business day avanti
 * @param {Date} date
 * @param {number} offset
 * @returns {Date}
 */
function applyBusinessDayOffset(date, offset) {
  const d = new Date(date.getTime());
  // prima porta al business day piu recente (se weekend arretra)
  const dow = d.getDay(); // 0=dom, 6=sab
  if (dow === 0) d.setDate(d.getDate() - 2);
  else if (dow === 6) d.setDate(d.getDate() - 1);

  if (offset === 0) return d;

  const step = offset > 0 ? 1 : -1;
  let remaining = Math.abs(offset);
  while (remaining > 0) {
    d.setDate(d.getDate() + step);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) remaining--;
  }
  return d;
}

/**
 * Parsa l'espressione interna di un placeholder date built-in.
 * @param {string} expr
 * @returns {{ keyword: string, offset: number, format: string|null } | null}
 */
function parseExpression(expr) {
  const m = DATE_BUILTIN_RE.exec(expr.trim());
  if (!m) return null;

  let keyword = m[1];
  let offset = m[2] ? parseInt(m[2], 10) : 0;
  const format = m[3] && m[3].trim() ? m[3].trim() : null;

  if (keyword === "yesterday") {
    keyword = "today";
    offset += -1;
  } else if (keyword === "tomorrow") {
    keyword = "today";
    offset += 1;
  }

  return { keyword, offset, format };
}

/**
 * Risolve un singolo placeholder.
 * @returns {string|null} valore risolto oppure null se non riconosciuto
 */
function resolvePlaceholder(expr, vars, now) {
  const trimmed = expr.trim();

  // [[timestamp]]
  if (trimmed === "timestamp") {
    return String(Math.floor(now.getTime() / 1000));
  }

  // [[uuid]]
  if (trimmed === "uuid") {
    return crypto.randomUUID();
  }

  // [[env:NOME_VAR]]
  const envMatch = ENV_RE.exec(trimmed);
  if (envMatch) {
    const val = process.env[envMatch[1].trim()];
    return val !== undefined ? val : "";
  }

  // keyword date: today, now, yesterday, tomorrow, lastBusinessDay
  const parsed = parseExpression(trimmed);
  if (parsed) {
    if (parsed.keyword === "lastBusinessDay") {
      const d = applyBusinessDayOffset(now, parsed.offset);
      return formatDate(d, parsed.format || "YYYY-MM-DD");
    }

    const d = new Date(now.getTime());
    if (parsed.offset) d.setDate(d.getDate() + parsed.offset);

    if (parsed.keyword === "now") {
      return parsed.format ? formatDate(d, parsed.format) : d.toISOString();
    }
    // today (include yesterday/tomorrow già normalizzati)
    return formatDate(d, parsed.format || "YYYY-MM-DD");
  }

  // variabili custom
  if (vars && Object.prototype.hasOwnProperty.call(vars, trimmed)) {
    const val = vars[trimmed];
    return val == null ? "" : String(val);
  }

  // non riconosciuto
  return null;
}

/**
 * Risolve tutti i placeholder [[...]] in un testo.
 * @param {string} text        - Testo con placeholder
 * @param {object} [vars={}]   - Variabili custom { chiave: valore }
 * @param {object} [opts={}]   - Opzioni
 * @param {Date}   [opts.now]  - Data corrente iniettabile (per test)
 * @returns {string} Testo con placeholder risolti
 */
function resolveText(text, vars = {}, opts = {}) {
  if (typeof text !== "string") return text;
  if (!text.includes("[[")) return text;

  const now = opts.now instanceof Date ? opts.now : new Date();

  return text.replace(PLACEHOLDER_RE, (match, expr) => {
    const resolved = resolvePlaceholder(expr, vars, now);
    return resolved !== null ? resolved : match;
  });
}

module.exports = { resolveText, formatDate };
