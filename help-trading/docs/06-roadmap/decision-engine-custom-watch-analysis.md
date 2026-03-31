---
sidebar_position: 2
title: Decision Engine — Custom Watch & Allocation Analysis
---

# Decision Engine — Custom Watch & Allocation Analysis

> **Microservizio:** `decision-engine` (porta 3018)  
> **Data:** Marzo 2026  
> **Versione documento:** 1.0  

---

## Indice

1. [Contesto e obiettivo](#1-contesto-e-obiettivo)
2. [Architettura del flusso custom watch](#2-architettura-del-flusso-custom-watch)
3. [Flusso allocation a due fasi](#3-flusso-allocation-a-due-fasi)
4. [Strutture dati Redis](#4-strutture-dati-redis)
5. [API — Endpoint](#5-api--endpoint)
6. [Modulo: custom-watch-manager.js](#6-modulo-custom-watch-managerjs)
7. [Modulo: allocation-checker.js](#7-modulo-allocation-checkerjs)
8. [Modifiche a decision-engine.js](#8-modifiche-a-decision-enginejs)
9. [Modifiche a live-manager.js](#9-modifiche-a-live-managerjs)
10. [Guardrail e priorità](#10-guardrail-e-priorità)
11. [Audit trail e sicurezza](#11-audit-trail-e-sicurezza)
12. [Riepilogo file modificati/creati](#12-riepilogo-file-modificaticreati)

---

## 1. Contesto e obiettivo

Il sistema esistente gestisce il monitoraggio live dei ticker tramite il loop asincrono dello spot-finder (`POST /spot-finder/:pipeId`), che calcola automaticamente livelli di supporto/resistenza e li inserisce nel ciclo di controllo del market data handler.

### Problema

Un utente che calcola manualmente i livelli via `GET /spot-finder` (modalità singolo ticker) non ha modo di:

- Modificare i livelli calcolati (entry, SL, TP) con valori custom
- Sottomettere il ticker al sistema di monitoraggio live con quei livelli
- Specificare quanta capitale investire
- Ricevere un feedback dettagliato sui vincoli imposti dal capital-manager **prima** di confermare

### Obiettivo

Aggiungere due funzionalità ortogonali che si compongono:

1. **Custom watch** — l'utente sceglie ticker e livelli, il sistema monitora e ordina rispettando tutti i guardrail esistenti (FOMC, earnings, risk regime, IBKR paper-check, ecc.)
2. **Allocation interattiva** — flusso a due fasi (quote-check → commit) che espone i vincoli del capital-manager all'utente e permette override esplicito delle soft violations

---

## 2. Architettura del flusso custom watch

### Flusso principale

```
GET /spot-finder?ticker=AAPL
        │
        ▼
  Utente modifica livelli nel frontend
  (entry, SL, TP custom)
        │
        ▼
POST /spot-finder/custom-watch/:pipeId
  │  body: { ticker, levels, activeMode, allocation }
  │
  ├─► Salva payload in Redis
  │     key: custom-watch:{pipeId}:{userId}:{ticker}
  │     TTL: 7 giorni
  │
  ├─► Se live attivo per questo pipeId:
  │     • aggiunge ticker a liveState.tickers
  │     • subscribe a market-data-service
  │     • inietta entry in snapshot Redis del pipe
  │
  └─► Risposta con stato live e livelli confermati

        │
        ▼ (market data snapshot arriva)

market data handler (live-manager.js)
  │
  ├─► Rileva isCustomWatch = true
  ├─► Usa entryLimit/stopLoss dal payload custom
  ├─► Bypassa ricalcolo trendOk/flagOk
  │     (l'utente ha già validato il setup)
  │
  └─► Tutti gli altri guardrail si applicano normalmente:
        FOMC proximity, earnings, dividend,
        risk regime, IBKR paper-check,
        capital-manager reserve, opening volatility block
```

### Struttura dello snapshot entry iniettato

Il ticker custom viene iniettato nello snapshot Redis del pipe con una struttura compatibile con quella prodotta dallo spot-finder, in modo che il market handler non necessiti di modifiche al routing principale:

```javascript
{
  ticker: "AAPL",
  exchange: "NASDAQ",
  currentPrice: null,
  isCustomWatch: true,          // flag discriminante
  activeMode: "retracement",    // "retracement" | "breakout"
  levels: {
    retracement: {
      entryLimit: 182.50,
      stopLoss: 179.00,
      takeProfit1: 188.00,
      takeProfit2: 195.00,
      actionable: true,
      rule: { custom: true }
    },
    breakout: null
  },
  signal: {
    pattern: {
      trendOk: true,            // override: utente ha già approvato
      flagOk: true,
      breakoutOk: false,
      pullbackOk: true,
      breakoutEntry: {
        breakLevel: null,
        buffer: 0,
        volumeThreshold: null,  // no volume check su livelli custom
        volumeOk: true
      }
    }
  },
  allocation: {
    amount: 5200,
    reservationId: "res_abc123",
    overrideConfirmed: false,
    source: "system_suggestion",
    checkedAt: "2026-03-27T10:00:00Z"
  }
}
```

---

## 3. Flusso allocation a due fasi

### Fase 1 — Quote check (consultivo, non prenota)

```
POST /spot-finder/allocation/quote-check
  body: { ticker, proposedAmount, entryLimit, pipeId }

        │
        ▼
  capital-manager /allocation/quote
        │
        ▼
  Aggregazione violations con severity:
  ┌─────────────────────────────────────────────┐
  │  HARD — non superabile                       │
  │    • CAPITAL_MANAGER_REJECT                  │
  │    • MAX_SINGLE_POSITION (limite assoluto)   │
  │    • INSUFFICIENT_FUNDS                      │
  ├─────────────────────────────────────────────┤
  │  SOFT — override possibile con conferma      │
  │    • SECTOR_CONCENTRATION                    │
  │    • DAILY_DRAWDOWN_BUFFER                   │
  │    • EXCEEDS_MAX_INVESTABLE (se buffer)      │
  └─────────────────────────────────────────────┘
        │
        ▼
  Risposta dettagliata all'utente:
    • decision.approved / suggestedAmount
    • violations[] con severity + canOverride
    • overridable: true/false
    • overrideWarning: stringa human-readable
```

### Fase 2 — Commit (prenota e attiva)

```
POST /spot-finder/custom-watch/:pipeId
  body: {
    ticker, levels, activeMode,
    allocation: {
      proposedAmount,
      acceptedAmount,       // può differire da proposed
      source,               // "system_suggestion" | "user_override"
      overrideConfirmed,    // true se l'utente ha ignorato soft violations
      overriddenViolations, // lista codici ignorati (audit)
      quoteCheckDone        // true se fase 1 già eseguita
    }
  }

        │
        ▼
  Se quoteCheckDone = false:
    ri-esegue quote-check implicito sull'acceptedAmount
    se hard violations → 422 con dettaglio
        │
        ▼
  executeAllocationReserve()
    • ri-valida hard limits sull'importo finale
    • chiama /allocation/reserve con overrideConfirmed
    • salva reservationId nel payload Redis
        │
        ▼
  saveCustomWatch() — salva in Redis con TTL 7gg
        │
        ▼
  Se live attivo → subscribe market data + inietta snapshot
```

### Scelta dell'utente — albero decisionale

```
quote-check response
        │
        ├── violations = [] → approved = true
        │     → utente procede con proposedAmount
        │
        ├── solo SOFT violations → overridable = true
        │     → utente sceglie:
        │         A) usa suggestedAmount (overrideConfirmed: false)
        │         B) impone proposedAmount (overrideConfirmed: true)
        │              + overriddenViolations: ["SECTOR_CONCENTRATION"]
        │
        └── almeno una HARD violation → overridable = false
              → utente deve usare suggestedAmount (o inferiore)
              → sistema blocca comunque al momento della reserve
```

---

## 4. Strutture dati Redis

### Chiave principale custom watch

```
custom-watch:{pipeId}:{userId}:{ticker}
TTL: 604800 secondi (7 giorni)
```

```json
{
  "ticker": "AAPL",
  "pipeId": 1,
  "userId": 42,
  "exchange": "NASDAQ",
  "createdAt": "2026-03-27T10:00:00Z",
  "activeMode": "retracement",
  "levels": {
    "retracement": {
      "entryLimit": 182.50,
      "stopLoss": 179.00,
      "takeProfit1": 188.00,
      "takeProfit2": 195.00
    },
    "breakout": {
      "entryLimit": 186.00,
      "stopLoss": 182.00,
      "takeProfit1": 192.00,
      "takeProfit2": 200.00
    }
  },
  "originalLevels": {
    "retracement": { "entryLimit": 182.00, "..." : "..." }
  },
  "allocation": {
    "amount": 5200,
    "reservationId": "res_abc123",
    "overrideConfirmed": false,
    "overriddenViolations": [],
    "source": "system_suggestion",
    "checkedAt": "2026-03-27T10:00:00Z"
  }
}
```

### Chiave lista ticker per pipe/user

```
custom-watch-list:{pipeId}:{userId}
TTL: 604800 secondi (7 giorni)
```

```json
{
  "tickers": ["AAPL", "MSFT", "NVDA"]
}
```

> **Nota:** se il bus espone `bus.key()`, le chiavi vengono prefissate con l'ambiente (`PAPER.custom-watch:...`, `PROD.custom-watch:...`) per isolare gli ambienti su istanze Redis condivise.

---

## 5. API — Endpoint

### `POST /spot-finder/allocation/quote-check`

Fase consultiva. Non prenota capitale.

**Request body:**

```json
{
  "ticker": "AAPL",
  "exchange": "NASDAQ",
  "proposedAmount": 8000,
  "entryLimit": 182.50,
  "pipeId": 1
}
```

**Response — approvato:**

```json
{
  "ok": true,
  "ticker": "AAPL",
  "proposedAmount": 8000,
  "decision": {
    "approved": true,
    "suggestedAmount": 8000,
    "maxInvestable": 10000,
    "quantity": { "proposed": 43, "suggested": 43 }
  },
  "violations": [],
  "overridable": false,
  "overrideWarning": null
}
```

**Response — con violations:**

```json
{
  "ok": true,
  "ticker": "AAPL",
  "proposedAmount": 8000,
  "decision": {
    "approved": false,
    "suggestedAmount": 5200,
    "maxInvestable": 5200,
    "quantity": { "proposed": 43, "suggested": 28 }
  },
  "violations": [
    {
      "code": "MAX_SINGLE_POSITION",
      "severity": "hard",
      "message": "L'importo supera il limite massimo per singola posizione ($6.000)",
      "limit": 6000,
      "proposed": 8000,
      "canOverride": false
    },
    {
      "code": "SECTOR_CONCENTRATION",
      "severity": "soft",
      "message": "Tech già al 34% del portafoglio, questo trade porta al 38% (limite consigliato 35%)",
      "limit": 0.35,
      "current": 0.34,
      "projected": 0.38,
      "canOverride": true
    }
  ],
  "overridable": true,
  "overrideWarning": "Puoi procedere con $5.200 ignorando: Tech già al 34% del portafoglio..."
}
```

---

### `POST /spot-finder/custom-watch/:pipeId`

Salva i livelli custom e attiva il monitoraggio live. Esegue la reserve del capitale.

**Request body:**

```json
{
  "ticker": "AAPL",
  "exchange": "NASDAQ",
  "levels": {
    "retracement": {
      "entryLimit": 182.50,
      "stopLoss": 179.00,
      "takeProfit1": 188.00,
      "takeProfit2": 195.00
    },
    "breakout": {
      "entryLimit": 186.00,
      "stopLoss": 182.00,
      "takeProfit1": 192.00,
      "takeProfit2": 200.00
    }
  },
  "activeMode": "retracement",
  "originalLevels": { "..." : "..." },
  "allocation": {
    "proposedAmount": 8000,
    "acceptedAmount": 5200,
    "source": "system_suggestion",
    "overrideConfirmed": false,
    "overriddenViolations": [],
    "quoteCheckDone": true
  }
}
```

**Response — successo:**

```json
{
  "ok": true,
  "ticker": "AAPL",
  "pipeId": 1,
  "activeMode": "retracement",
  "liveActive": true,
  "subscribed": true,
  "levels": { "..." : "..." },
  "allocation": {
    "amount": 5200,
    "reservationId": "res_abc123"
  },
  "message": "Ticker aggiunto al monitoraggio live"
}
```

**Response — hard violation al momento della reserve (422):**

```json
{
  "ok": false,
  "error": "Hard violations sull'importo finale",
  "violations": [
    {
      "code": "MAX_SINGLE_POSITION",
      "severity": "hard",
      "message": "...",
      "canOverride": false
    }
  ]
}
```

---

### `GET /spot-finder/custom-watch/:pipeId`

Lista di tutti i ticker monitorati con livelli custom per il pipe/user.

**Response:**

```json
{
  "ok": true,
  "pipeId": 1,
  "count": 2,
  "liveActive": true,
  "entries": [
    {
      "ticker": "AAPL",
      "activeMode": "retracement",
      "createdAt": "2026-03-27T10:00:00Z",
      "levels": { "..." : "..." },
      "allocation": { "amount": 5200, "reservationId": "res_abc123" }
    }
  ]
}
```

---

### `DELETE /spot-finder/custom-watch/:pipeId/:ticker`

Rimuove il ticker dal monitoraggio. Rilascia la reservation sul capital-manager se ancora attiva.

**Response:**

```json
{
  "ok": true,
  "ticker": "AAPL",
  "removed": true,
  "reservationReleased": true
}
```

> **Importante:** il `DELETE` deve chiamare `/allocation/release` sul capital-manager se esiste un `reservationId` valido nel payload Redis. Un ticker rimosso prima che il prezzo venga raggiunto lascerebbe il capitale bloccato inutilmente.

---

## 6. Modulo: custom-watch-manager.js

File: `decision-engine/modules/custom-watch-manager.js`

```javascript
"use strict";

const CUSTOM_WATCH_TTL = 60 * 60 * 24 * 7; // 7 giorni

const buildCustomWatchKey = (bus, pipeId, userId, ticker) =>
  bus?.key?.("custom-watch", pipeId, userId, ticker)
  ?? `custom-watch:${pipeId}:${userId}:${ticker}`;

const buildCustomWatchListKey = (bus, pipeId, userId) =>
  bus?.key?.("custom-watch-list", pipeId, userId)
  ?? `custom-watch-list:${pipeId}:${userId}`;

async function saveCustomWatch(bus, {
  pipeId, userId, ticker, exchange,
  levels, activeMode, originalLevels, allocation
}, logger) {
  if (!bus || typeof bus.set !== "function") throw new Error("redis not available");

  const key = buildCustomWatchKey(bus, pipeId, userId, ticker);
  const listKey = buildCustomWatchListKey(bus, pipeId, userId);

  const payload = {
    ticker, pipeId, userId,
    exchange: exchange || null,
    createdAt: new Date().toISOString(),
    activeMode: activeMode || "retracement",
    levels,
    originalLevels: originalLevels || null,
    allocation: allocation || null,
  };

  await bus.set(key, payload, { EX: CUSTOM_WATCH_TTL });

  const listPayload = await bus.get(listKey) || { tickers: [] };
  if (!listPayload.tickers.includes(ticker)) {
    listPayload.tickers.push(ticker);
  }
  await bus.set(listKey, listPayload, { EX: CUSTOM_WATCH_TTL });

  logger?.info?.(
    `[custom-watch] saved ticker=${ticker} pipeId=${pipeId} ` +
    `userId=${userId} mode=${payload.activeMode}`
  );
  return payload;
}

async function getCustomWatch(bus, pipeId, userId, ticker) {
  if (!bus || typeof bus.get !== "function") return null;
  return await bus.get(buildCustomWatchKey(bus, pipeId, userId, ticker));
}

async function listCustomWatches(bus, pipeId, userId) {
  if (!bus || typeof bus.get !== "function") return [];
  const listKey = buildCustomWatchListKey(bus, pipeId, userId);
  const listPayload = await bus.get(listKey);
  if (!listPayload?.tickers?.length) return [];

  const results = [];
  for (const ticker of listPayload.tickers) {
    const entry = await getCustomWatch(bus, pipeId, userId, ticker);
    if (entry) results.push(entry);
  }
  return results;
}

async function deleteCustomWatch(bus, pipeId, userId, ticker, logger) {
  if (!bus) throw new Error("redis not available");

  await bus.del(buildCustomWatchKey(bus, pipeId, userId, ticker));

  const listKey = buildCustomWatchListKey(bus, pipeId, userId);
  const listPayload = await bus.get(listKey);
  if (listPayload?.tickers) {
    listPayload.tickers = listPayload.tickers.filter(t => t !== ticker);
    await bus.set(listKey, listPayload, { EX: CUSTOM_WATCH_TTL });
  }

  logger?.info?.(`[custom-watch] deleted ticker=${ticker} pipeId=${pipeId} userId=${userId}`);
}

module.exports = {
  saveCustomWatch,
  getCustomWatch,
  listCustomWatches,
  deleteCustomWatch,
  buildCustomWatchKey,
};
```

---

## 7. Modulo: allocation-checker.js

File: `decision-engine/modules/allocation-checker.js`

```javascript
"use strict";

const { httpPostJson } = require("./live-manager");
const { asNumber } = require("./helpers");

async function runAllocationQuoteCheck({
  capitalManagerUrl,
  userId,
  ticker,
  proposedAmount,
  entryLimit,
  logger,
}) {
  if (!capitalManagerUrl) {
    return _buildUncheckedResponse(proposedAmount, ticker);
  }

  const cmUrl = capitalManagerUrl.replace(/\/+$/, "");
  const violations = [];
  let maxInvestable = proposedAmount;
  let quoteData = null;

  try {
    const quoteResp = await httpPostJson(
      `${cmUrl}/allocation/quote`,
      {
        userId,
        symbol: ticker,
        market: "US",
        proposedAmount,
        clientRequestId: `quote-check-${Date.now()}`,
      },
      8000
    );

    if (quoteResp.status >= 200 && quoteResp.status < 300 && quoteResp.data?.ok) {
      quoteData = quoteResp.data;
      maxInvestable = asNumber(quoteData.decision?.maxInvestable, proposedAmount);

      if (Array.isArray(quoteData.violations)) {
        violations.push(...quoteData.violations);
      }
    } else {
      maxInvestable = asNumber(quoteResp.data?.decision?.maxInvestable, 0);
      violations.push({
        code: "CAPITAL_MANAGER_REJECT",
        severity: "hard",
        message: quoteResp.data?.message || "Il capital manager ha rifiutato la richiesta",
        canOverride: false,
      });
    }
  } catch (err) {
    logger?.warning?.(`[quote-check] capital-manager unreachable: ${err?.message}`);
    violations.push({
      code: "CAPITAL_MANAGER_UNAVAILABLE",
      severity: "soft",
      message: "Capital manager non raggiungibile, i limiti non sono stati verificati",
      canOverride: true,
    });
    return _buildUncheckedResponse(proposedAmount, ticker, violations);
  }

  if (proposedAmount > maxInvestable && maxInvestable >= 0) {
    const isHard = maxInvestable === 0 ||
      (quoteData?.hardLimit && proposedAmount > quoteData.hardLimit);
    violations.push({
      code: "EXCEEDS_MAX_INVESTABLE",
      severity: isHard ? "hard" : "soft",
      message: `Importo proposto $${proposedAmount} supera il massimo investibile $${maxInvestable}`,
      limit: maxInvestable,
      proposed: proposedAmount,
      canOverride: !isHard,
    });
  }

  const suggestedAmount = Math.min(proposedAmount, maxInvestable);
  const quantityProposed = entryLimit > 0 ? Math.floor(proposedAmount / entryLimit) : null;
  const quantitySuggested = entryLimit > 0 ? Math.floor(suggestedAmount / entryLimit) : null;

  const hasHardViolation = violations.some(v => v.severity === "hard");
  const hasSoftOnly = violations.length > 0 && !hasHardViolation;
  const approved = violations.length === 0;
  const overridable = hasSoftOnly;

  return {
    ok: true,
    ticker,
    proposedAmount,
    decision: {
      approved,
      suggestedAmount: approved ? proposedAmount : suggestedAmount,
      maxInvestable,
      quantity: { proposed: quantityProposed, suggested: quantitySuggested },
    },
    violations,
    overridable,
    overrideWarning: overridable
      ? `Puoi procedere con $${suggestedAmount} ignorando: ` +
        violations.filter(v => v.severity === "soft").map(v => v.message).join("; ")
      : hasHardViolation
        ? "Ci sono vincoli non superabili. Usa l'importo suggerito."
        : null,
    rawQuote: quoteData,
  };
}

async function executeAllocationReserve({
  capitalManagerUrl,
  userId,
  ticker,
  amount,
  overrideConfirmed,
  overriddenViolations,
  correlationId,
  logger,
}) {
  if (!capitalManagerUrl) {
    return { ok: true, reservationId: null, unchecked: true };
  }

  const cmUrl = capitalManagerUrl.replace(/\/+$/, "");

  // Ri-valida hard limits sull'importo finale prima di prenotare
  const recheck = await runAllocationQuoteCheck({
    capitalManagerUrl,
    userId,
    ticker,
    proposedAmount: amount,
    logger,
  });

  const hardViolations = (recheck.violations || []).filter(v => v.severity === "hard");
  if (hardViolations.length > 0) {
    return {
      ok: false,
      error: "Hard violations sull'importo finale",
      violations: hardViolations,
    };
  }

  try {
    const reserveResp = await httpPostJson(
      `${cmUrl}/allocation/reserve`,
      {
        userId,
        symbol: ticker,
        market: "US",
        currency: "USD",
        amount,
        clientRequestId: correlationId,
        overrideConfirmed: overrideConfirmed || false,
        overriddenViolations: overriddenViolations || [],
      },
      8000
    );

    if (reserveResp.status >= 200 && reserveResp.status < 300 && reserveResp.data?.ok) {
      logger?.info?.(
        `[allocation] reserved ticker=${ticker} amount=${amount} ` +
        `reservationId=${reserveResp.data.reservationId}`
      );
      return {
        ok: true,
        reservationId: reserveResp.data.reservationId,
        amount,
      };
    }

    return {
      ok: false,
      error: reserveResp.data?.message || "Prenotazione fallita",
    };
  } catch (err) {
    logger?.warning?.(`[allocation] reserve error: ${err?.message}`);
    return { ok: false, error: err?.message };
  }
}

function _buildUncheckedResponse(proposedAmount, ticker, violations = []) {
  return {
    ok: true,
    ticker,
    proposedAmount,
    decision: {
      approved: true,
      suggestedAmount: proposedAmount,
      maxInvestable: proposedAmount,
      quantity: { proposed: null, suggested: null },
    },
    violations,
    overridable: violations.length > 0,
    overrideWarning: null,
    unchecked: true,
  };
}

module.exports = { runAllocationQuoteCheck, executeAllocationReserve };
```

---

## 8. Modifiche a decision-engine.js

### Nuovi import nel `buildDecisionEngineRouter`

```javascript
const {
  saveCustomWatch,
  getCustomWatch,
  listCustomWatches,
  deleteCustomWatch,
} = require("./custom-watch-manager");

const {
  runAllocationQuoteCheck,
  executeAllocationReserve,
} = require("./allocation-checker");
```

### Route `POST /allocation/quote-check`

```javascript
router.post("/allocation/quote-check", async (req, res) => {
  const userId = await resolveUserId(req);
  if (!userId) return res.status(401).json({ ok: false, error: "userId not available" });

  const { ticker, exchange, proposedAmount, entryLimit, pipeId } = req.body || {};

  if (!ticker || !Number.isFinite(Number(proposedAmount)) || proposedAmount <= 0) {
    return res.status(400).json({
      ok: false,
      error: "ticker e proposedAmount sono obbligatori",
    });
  }

  try {
    const result = await runAllocationQuoteCheck({
      capitalManagerUrl,
      userId,
      ticker: String(ticker).trim().toUpperCase(),
      proposedAmount: Number(proposedAmount),
      entryLimit: Number.isFinite(Number(entryLimit)) ? Number(entryLimit) : null,
      authHeaders: pickAuthHeaders(req),
      logger,
    });
    return res.json(result);
  } catch (err) {
    logger?.error?.(`[quote-check] error: ${err?.message}`);
    return res.status(502).json({ ok: false, error: err?.message || String(err) });
  }
});
```

### Route `POST /custom-watch/:pipeId`

```javascript
router.post("/custom-watch/:pipeId", async (req, res) => {
  const pipeId = Number(String(req.params.pipeId || "").trim());
  if (!Number.isFinite(pipeId)) {
    return res.status(400).json({ ok: false, error: "pipeId must be a number" });
  }
  const userId = await resolveUserId(req);
  if (!userId) return res.status(401).json({ ok: false, error: "userId not available" });

  const { ticker, exchange, levels, activeMode, originalLevels } = req.body || {};
  if (!ticker || typeof ticker !== "string") {
    return res.status(400).json({ ok: false, error: "ticker is required" });
  }

  const mode = activeMode || "retracement";
  const levelBlock = levels?.[mode];
  if (!levelBlock?.entryLimit || !levelBlock?.stopLoss) {
    return res.status(400).json({
      ok: false,
      error: "levels.entryLimit e levels.stopLoss sono obbligatori",
    });
  }

  const b = bus();
  if (!b) return res.status(503).json({ ok: false, error: "redis not available" });

  const tickerUpper = String(ticker).trim().toUpperCase();

  // --- Gestione allocation ---
  const allocationInput = req.body?.allocation || {};
  const proposedAmount = asNumber(allocationInput.proposedAmount, null);
  const acceptedAmount = asNumber(allocationInput.acceptedAmount, null);
  const overrideConfirmed = Boolean(allocationInput.overrideConfirmed);
  const overriddenViolations = Array.isArray(allocationInput.overriddenViolations)
    ? allocationInput.overriddenViolations : [];
  const finalAmount = acceptedAmount ?? proposedAmount ?? null;

  let reservationId = null;

  try {
    if (Number.isFinite(finalAmount) && finalAmount > 0) {
      if (!allocationInput.quoteCheckDone) {
        const quoteResult = await runAllocationQuoteCheck({
          capitalManagerUrl, userId,
          ticker: tickerUpper,
          proposedAmount: finalAmount,
          entryLimit: levelBlock?.entryLimit,
          logger,
        });
        const hardViolations = quoteResult.violations.filter(v => v.severity === "hard");
        if (hardViolations.length > 0 && !overrideConfirmed) {
          return res.status(422).json({
            ok: false,
            error: "Importo non approvabile: hard violations presenti",
            quoteResult,
          });
        }
      }

      const reserveResult = await executeAllocationReserve({
        capitalManagerUrl, userId,
        ticker: tickerUpper,
        amount: finalAmount,
        overrideConfirmed,
        overriddenViolations,
        correlationId: `custom-watch-${Date.now()}`,
        logger,
      });

      if (!reserveResult.ok) {
        return res.status(422).json({
          ok: false,
          error: reserveResult.error,
          violations: reserveResult.violations,
        });
      }
      reservationId = reserveResult.reservationId;
    }

    const saved = await saveCustomWatch(b, {
      pipeId, userId, ticker: tickerUpper,
      exchange: exchange || null,
      levels, activeMode: mode, originalLevels,
      allocation: finalAmount ? {
        amount: finalAmount,
        reservationId,
        overrideConfirmed,
        overriddenViolations,
        source: allocationInput.source || "user",
        checkedAt: new Date().toISOString(),
      } : null,
    }, logger);

    // Inject nello stato live se attivo
    if (liveState.active && liveState.pipeId === pipeId) {
      liveState.tickers.add(tickerUpper);
      if (exchange) liveState.exchangeByTicker.set(tickerUpper, String(exchange).trim());

      const headers = pickAuthHeaders(req);
      try {
        await axios.post(
          `${marketdataserviceUrl}/subscriptions`,
          { tickers: [tickerUpper] },
          { headers, timeout: C.SUBSCRIPTION_TIMEOUT_MS }
        );
      } catch (subErr) {
        logger?.warning?.(`[custom-watch] subscribe failed: ${subErr?.message}`);
      }

      if (liveState.asOfDate) {
        const { updateSnapshotResult } = require("./job-manager");
        const snapshotEntry = _buildSnapshotEntryFromCustomLevels({
          ticker: tickerUpper, exchange, levels, activeMode: mode, pipeId, userId,
          allocation: saved.allocation,
        });
        await updateSnapshotResult(b, pipeId, userId, liveState.asOfDate, snapshotEntry, logger);
      }
    }

    return res.json({
      ok: true,
      ticker: tickerUpper,
      pipeId,
      activeMode: mode,
      liveActive: liveState.active && liveState.pipeId === pipeId,
      subscribed: liveState.active && liveState.pipeId === pipeId,
      levels: saved.levels,
      allocation: saved.allocation,
      message: liveState.active && liveState.pipeId === pipeId
        ? "Ticker aggiunto al monitoraggio live"
        : "Ticker salvato — attiva il live su questo pipeId per iniziare il monitoraggio",
    });
  } catch (err) {
    logger?.error?.(`[custom-watch] save error: ${err?.message}`);
    return res.status(502).json({ ok: false, error: err?.message || String(err) });
  }
});
```

### Route `GET /custom-watch/:pipeId`

```javascript
router.get("/custom-watch/:pipeId", async (req, res) => {
  const pipeId = Number(String(req.params.pipeId || "").trim());
  if (!Number.isFinite(pipeId)) {
    return res.status(400).json({ ok: false, error: "pipeId must be a number" });
  }
  const userId = await resolveUserId(req);
  if (!userId) return res.status(401).json({ ok: false, error: "userId not available" });

  try {
    const entries = await listCustomWatches(bus(), pipeId, userId);
    return res.json({
      ok: true,
      pipeId,
      count: entries.length,
      entries,
      liveActive: liveState.active && liveState.pipeId === pipeId,
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err?.message || String(err) });
  }
});
```

### Route `DELETE /custom-watch/:pipeId/:ticker`

```javascript
router.delete("/custom-watch/:pipeId/:ticker", async (req, res) => {
  const pipeId = Number(String(req.params.pipeId || "").trim());
  const ticker = String(req.params.ticker || "").trim().toUpperCase();
  if (!Number.isFinite(pipeId) || !ticker) {
    return res.status(400).json({ ok: false, error: "pipeId e ticker sono obbligatori" });
  }
  const userId = await resolveUserId(req);
  if (!userId) return res.status(401).json({ ok: false, error: "userId not available" });

  try {
    const entry = await getCustomWatch(bus(), pipeId, userId, ticker);

    // Rilascia la reservation se presente
    let reservationReleased = false;
    if (entry?.allocation?.reservationId && capitalManagerUrl) {
      try {
        const cmUrl = capitalManagerUrl.replace(/\/+$/, "");
        await httpPostJson(
          `${cmUrl}/allocation/release`,
          {
            reservationId: entry.allocation.reservationId,
            userId,
            reason: "custom_watch_deleted",
          },
          5000
        );
        reservationReleased = true;
      } catch (releaseErr) {
        logger?.warning?.(`[custom-watch] release failed: ${releaseErr?.message}`);
      }
    }

    await deleteCustomWatch(bus(), pipeId, userId, ticker, logger);
    liveState.tickers.delete(ticker);

    return res.json({ ok: true, ticker, removed: true, reservationReleased });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err?.message || String(err) });
  }
});
```

### Helper privato `_buildSnapshotEntryFromCustomLevels`

```javascript
function _buildSnapshotEntryFromCustomLevels({
  ticker, exchange, levels, activeMode, pipeId, userId, allocation
}) {
  const retLevels = levels?.retracement || null;
  const brkLevels = levels?.breakout || null;

  return {
    ticker,
    exchange: exchange || null,
    currentPrice: null,
    isCustomWatch: true,
    activeMode,
    levels: {
      retracement: retLevels ? {
        ...retLevels,
        actionable: true,
        reason: null,
        rule: { custom: true },
      } : null,
      breakout: brkLevels ? {
        ...brkLevels,
        actionable: true,
        reason: null,
        rule: { custom: true },
      } : null,
    },
    signal: {
      pattern: {
        trendOk: true,
        flagOk: true,
        breakoutOk: activeMode === "breakout",
        pullbackOk: activeMode === "retracement",
        breakLevel: brkLevels?.entryLimit || null,
        breakoutEntry: {
          breakLevel: brkLevels?.entryLimit || null,
          buffer: 0,
          volumeThreshold: null,
          volumeOk: true,
        },
      },
    },
    allocation: allocation || null,
    fullResult: null,
  };
}
```

---

## 9. Modifiche a live-manager.js

### In `updateSnapshotFlagsFromLive` — blocco isCustomWatch

Aggiungere **prima** della logica standard di flag, dopo il recupero di `current`:

```javascript
// --- Gestione ticker custom watch ---
if (current?.isCustomWatch) {
  const mode = current.activeMode || "retracement";
  const levelBlock = mode === "retracement"
    ? current.levels?.retracement
    : current.levels?.breakout;
  const entryLimit = asNumber(levelBlock?.entryLimit, null);

  // Check prezzo vs livello
  const priceOk = mode === "retracement"
    ? (Number.isFinite(price) && Number.isFinite(entryLimit) && price <= entryLimit)
    : (Number.isFinite(price) && Number.isFinite(entryLimit) && price > entryLimit);

  if (!priceOk) {
    logger?.trace?.(
      `[live][custom-watch] price not at level ticker=${ticker} ` +
      `price=${price} entryLimit=${entryLimit} mode=${mode}`
    );
    // Aggiorna lastTouchAt ma non triggera ordine
    next.lastTouchAt = new Date().toISOString();
    // ... scrittura su Redis e return true
    return true;
  }

  // Prezzo raggiunto: usa importo pre-approvato, salta capital-manager
  if (current?.allocation?.amount > 0) {
    dollars = current.allocation.amount;
    reservationId = current.allocation.reservationId || null;
    logger?.info?.(
      `[live][custom-watch] using pre-approved amount=${dollars} ` +
      `ticker=${ticker} reservationId=${reservationId || "none"}`
    );
  }

  // Forza i flag per by-passare il check trendOk/flagOk
  // (mantenendo tutti gli altri guardrail invariati)
  Object.assign(current, {
    signal: {
      pattern: {
        trendOk: true,
        flagOk: true,
        breakoutOk: mode === "breakout",
        pullbackOk: mode === "retracement",
        breakLevel: current.levels?.breakout?.entryLimit || null,
        breakoutEntry: {
          breakLevel: current.levels?.breakout?.entryLimit || null,
          buffer: 0,
          volumeThreshold: null,
          volumeOk: true,
        },
      },
    },
  });
  // Continua con il resto della funzione normalmente
  // (FOMC, earnings, dividend, risk regime, IBKR paper-check si applicano tutti)
}
```

---

## 10. Guardrail e priorità

### Cosa viene byppassato per i ticker custom watch

| Controllo | Standard | Custom watch |
|-----------|----------|--------------|
| `trendOk` (EMA20 > EMA50) | Calcolato dallo spot-finder | **Byppassato** — l'utente ha già validato |
| `flagOk` (pattern flag) | Calcolato da `detectTrendFlagBreakout` | **Byppassato** — l'utente ha già validato |
| `breakoutOk` / `pullbackOk` | Calcolato su price vs breakLevel | **Calcolato** su price vs entryLimit custom |
| Volume check | Sì (volumeThreshold da ATR) | **No** (nessun check volume) |

### Cosa rimane invariato (tutti i guardrail attivi)

| Guardrail | Note |
|-----------|------|
| Risk regime (RISK_ON check) | Attivo — se non RISK_ON, ordine bloccato |
| Earnings proximity | Attivo — se earnings entro blockDays, ordine bloccato |
| FOMC proximity | Attivo — se FOMC entro blockDays, ordine bloccato |
| Macro event proximity (CPI/NFP) | Attivo — se evento entro blockDays, ordine bloccato |
| Dividend ex-date proximity | Attivo — se ex-date entro blockDays, ordine bloccato |
| Opening volatility block (BREAKOUT) | Attivo — se entro 25 min dall'apertura |
| Candle range check (BREAKOUT) | Attivo — se range > flagAtrK * ATR |
| IBKR paper-account check | Attivo — blocco totale se non account DU |
| Capital-manager quote | **Già eseguito in fase 1** — non ri-eseguito |
| Capital-manager reserve | **Già eseguito in fase 2** — `reservationId` usato |
| Capital-manager release | Eseguito dopo ordine (o su DELETE) |

---

## 11. Audit trail e sicurezza

### Tracciabilità delle override

Ogni soft violation ignorata dall'utente viene salvata nel payload Redis con il codice della violation:

```json
"allocation": {
  "overrideConfirmed": true,
  "overriddenViolations": ["SECTOR_CONCENTRATION", "DAILY_DRAWDOWN_BUFFER"],
  "checkedAt": "2026-03-27T10:00:00Z"
}
```

Questo permette di ricostruire a posteriori perché un certo importo è stato usato anche contro il suggerimento del sistema.

### Hard violations — fail-closed

Le hard violations non sono mai bypassabili, neanche con `overrideConfirmed: true`. La `executeAllocationReserve` ri-valida sempre i hard limits sull'importo finale prima di procedere con la reserve, indipendentemente da cosa ha detto la fase 1.

### Capital bloccato su delete

Il `DELETE /custom-watch/:pipeId/:ticker` chiama `/allocation/release` sul capital-manager se c'è un `reservationId` attivo. In caso di errore nella release, il sistema logga un warning ma non blocca il delete — la reconciliazione del capitale è responsabilità del capital-manager tramite TTL o job di cleanup.

---

## 12. Riepilogo file modificati/creati

| File | Tipo | Modifiche |
|------|------|-----------|
| `decision-engine/modules/custom-watch-manager.js` | **Nuovo** | CRUD Redis per custom watch entries |
| `decision-engine/modules/allocation-checker.js` | **Nuovo** | Quote-check e reserve verso capital-manager |
| `decision-engine/modules/decision-engine.js` | **Modificato** | 4 nuove route + helper privato `_buildSnapshotEntryFromCustomLevels` |
| `decision-engine/modules/live-manager.js` | **Modificato** | Blocco `isCustomWatch` in `updateSnapshotFlagsFromLive` |
| `decision-engine/server.js` | **Nessuna modifica** | Le route sono montate su `/spot-finder` tramite il router esistente |

### Endpoint aggiunti al router `/spot-finder`

```
POST   /spot-finder/allocation/quote-check
POST   /spot-finder/custom-watch/:pipeId
GET    /spot-finder/custom-watch/:pipeId
DELETE /spot-finder/custom-watch/:pipeId/:ticker
```

---

*Documento generato dalla sessione di design del 27 marzo 2026.*
