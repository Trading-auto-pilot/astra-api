"use strict";

// ---------------------------------------------------------------------------
// parse-state-machine.js
// Legge il log del decision-engine e produce:
//   1. La sequenza di transizioni di stato per ogni ticker (stdout)
//   2. Un diagramma Mermaid stateDiagram-v2 con la storia reale (file .md)
//
// Usa SOLO le righe ">> symref:..." che sono l'unica fonte di verita.
//
// Formato riga:
//   >> symref:AEM:2026-04-04:hash trend=OK flag=KO breakout=KO pullback=KO retracement=KO price=193.85 breakLevel=203.36
//
// Uso:
//   node parse-state-machine.js [path-to-log]
// ---------------------------------------------------------------------------

const fs   = require("fs");
const path = require("path");

const logPath = process.argv[2] || path.join(__dirname, "Logs", "decision-engin.log");
const lines   = fs.readFileSync(logPath, "utf-8").split("\n");

// ---------------------------------------------------------------------------
// Regex
// ---------------------------------------------------------------------------

// Timestamp dal prefisso log
const TS_RE = /^\[([^\]]+)\]/;

// Riga >> symref con stato
const SYMREF_RE = />> symref:(\w+):([^:]+):[a-f0-9]+ trend=(OK|KO) flag=(OK|KO) breakout=(OK|KO) pullback=(OK|KO) retracement=(OK|KO) price=(\S+) breakLevel=(\S+)/;

// Riga BREAKOUT/PULLBACK/RETRACEMENT AREA (ordine inviato)
const ORDER_RE = /\[live\] (BREAKOUT AREA|PULLBACK AREA|RETRACEMENT AREA) ticker=(\S+)/;

// ---------------------------------------------------------------------------
// Macchina a stati: ricava lo stato composito dai flag booleani
// ---------------------------------------------------------------------------
function stateLabel(flags) {
  if (!flags)                  return "INACTIVE";
  const { trend, flag, breakout, pullback, retracement } = flags;
  if (trend === "KO")          return "NO_TREND";
  if (flag  === "KO")          return "TREND_OK";
  if (breakout === "OK")       return "BREAKOUT_ZONE";
  if (pullback === "OK")       return "PULLBACK_ZONE";
  if (retracement === "OK")    return "RETRACEMENT_ZONE";
  return "FLAG_READY";
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const stateByTicker = new Map(); // ticker → { trend, flag, breakout, pullback, retracement }
const history       = new Map(); // ticker → [ { ts, from, to, price, breakLevel, changed } ]

for (const line of lines) {
  const tsMatch = line.match(TS_RE);
  const ts = tsMatch ? tsMatch[1] : "?";

  // Ordine inviato
  const orderMatch = line.match(ORDER_RE);
  if (orderMatch) {
    const ticker = orderMatch[2];
    const area   = orderMatch[1];
    if (!history.has(ticker)) history.set(ticker, []);
    history.get(ticker).push({
      ts, from: stateLabel(stateByTicker.get(ticker)),
      to: "ORDER_SENT", event: `🟢 ${area}`, price: "-", breakLevel: "-",
    });
    continue;
  }

  // Riga >> symref con stato
  const m = line.match(SYMREF_RE);
  if (!m) continue;

  const ticker     = m[1];
  const nextFlags  = { trend: m[3], flag: m[4], breakout: m[5], pullback: m[6], retracement: m[7] };
  const price      = m[8];
  const breakLevel = m[9];

  const prevFlags  = stateByTicker.get(ticker) || null;
  const prevLabel  = stateLabel(prevFlags);
  const nextLabel  = stateLabel(nextFlags);

  if (!history.has(ticker)) history.set(ticker, []);

  if (prevLabel !== nextLabel) {
    const changed = [];
    if (prevFlags) {
      for (const k of ["trend","flag","breakout","pullback","retracement"]) {
        if (prevFlags[k] !== nextFlags[k]) changed.push(`${k}: ${prevFlags[k]}→${nextFlags[k]}`);
      }
    }
    history.get(ticker).push({
      ts, from: prevLabel, to: nextLabel,
      event: changed.length ? changed.join(", ") : "init",
      price, breakLevel,
    });
  }

  stateByTicker.set(ticker, nextFlags);
}

// ---------------------------------------------------------------------------
// Output 1: console
// ---------------------------------------------------------------------------

console.log("\n══════════════════════════════════════════════════");
console.log("  STATE MACHINE — TRANSIZIONI PER TICKER");
console.log("══════════════════════════════════════════════════\n");

for (const [ticker, entries] of history.entries()) {
  if (!entries.length) continue;
  console.log(`▶ ${ticker}`);
  console.log("  " + "─".repeat(72));
  for (const e of entries) {
    const arrow = e.to === "ORDER_SENT" ? "  ══►  " : "  →   ";
    console.log(`  [${e.ts}]  ${e.from.padEnd(18)}${arrow}${e.to}`);
    if (e.event && e.event !== "init") console.log(`            ↳ ${e.event}  price=${e.price} breakLevel=${e.breakLevel}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Output 2: Mermaid markdown
// ---------------------------------------------------------------------------

let mermaid = `# Decision Engine — State Machine

## Schema stati

\`\`\`mermaid
stateDiagram-v2
    [*] --> INACTIVE

    INACTIVE --> NO_TREND : prima snapshot ricevuta
    NO_TREND --> TREND_OK : trendOk=true
    TREND_OK --> NO_TREND : trendOk=false
    TREND_OK --> FLAG_READY : flagOk=true
    FLAG_READY --> TREND_OK : flagOk=false
    FLAG_READY --> BREAKOUT_ZONE : price > breakLevel+buffer
    FLAG_READY --> RETRACEMENT_ZONE : price ≤ retracementLimit
    BREAKOUT_ZONE --> PULLBACK_ZONE : price pullback dopo breakout
    BREAKOUT_ZONE --> FLAG_READY : price rientra nel flag
    BREAKOUT_ZONE --> ORDER_SENT : actionableBreakout
    PULLBACK_ZONE --> ORDER_SENT : actionablePullback
    RETRACEMENT_ZONE --> ORDER_SENT : actionableRetracement
    ORDER_SENT --> FLAG_READY : reset dopo ordine

    note right of FLAG_READY
        trendOk=true
        flagOk=true
        In attesa di trigger
    end note
    note right of ORDER_SENT
        Ordine inviato a
        broker-executor
    end note
\`\`\`

## Transizioni reali dal log

`;

for (const [ticker, entries] of history.entries()) {
  if (!entries.length) continue;
  mermaid += `### ${ticker}\n\n`;
  mermaid += `| Timestamp | Da | A | Evento | Price | BreakLevel |\n`;
  mermaid += `|---|---|---|---|---|---|\n`;
  for (const e of entries) {
    mermaid += `| ${e.ts} | \`${e.from}\` | \`${e.to}\` | ${e.event.replace(/\|/g,"\\|")} | ${e.price} | ${e.breakLevel} |\n`;
  }
  mermaid += "\n";
}

const outPath = path.join(__dirname, "Logs", "state-machine.md");
fs.writeFileSync(outPath, mermaid);
console.log(`📄 Mermaid diagram → ${outPath}\n`);
