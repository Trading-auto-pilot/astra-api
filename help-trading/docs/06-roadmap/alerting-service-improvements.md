---
sidebar_position: 4
title: AlertingService — Anti-duplicazione e throttle
---

# AlertingService — Anti-duplicazione e throttle

## Navigazione

1. Architettura del sistema
2. Come funzionano i meccanismi attuali
3. Meccanismo 1 — Deduplicazione per contenuto (`dedup_seconds`)
4. Meccanismo 2 — Throttling a finestra scorrevole
5. Problemi identificati
6. Problema 1 — Dedup disabilitato per default 🔴
7. Problema 2 — Hash include il testo completo del messaggio 🔴
8. Problema 3 — Stato perso al restart con datahub offline 🔴
9. Problema 4 — Nessuna visibilità sugli eventi soppressi 🟡
10. Problema 5 — Race condition in `ensureState()` 🟡
11. Problema 6 — Regex `onEventMessage` può escludere canali validi 🟡

## Architettura del sistema

Il `RuleEngine` si sottoscrive a due pattern Redis al momento dello start:

```
ALERTING_LOGS_PATTERN   = ${ENV}.*.*.logs.*     ← log di sistema da tutti i microservizi
ALERTING_EVENTS_PATTERN = ${ENV}.*.events*      ← eventi business (hook.events)
```

Ogni messaggio in arrivo viene valutato contro tutte le regole attive. Se una regola fa match, entra in `applyRule()` dove si trovano i due meccanismi anti-duplicazione.

La sottoscrizione ai log è condizionale: viene attivata solo se esiste almeno una regola abilitata con `source=logs`. Se non ci sono tali regole, il canale log viene disiscritto dinamicamente via `refreshSubscriptions()`.

## Come funzionano i meccanismi attuali

Il sistema ha due meccanismi distinti valutati in sequenza. Un evento deve superarli entrambi per produrre un alert.

## Meccanismo 1 — Deduplicazione per contenuto (`dedup_seconds`)

```
const hash = this.buildHash(event);

if (dedupSeconds > 0 && lastHash === hash && lastSentAt && now - lastSentAt < dedupSeconds * 1000) {
  await this.updateState(ruleId, { last_matched_at: ..., last_hash: hash });
  return; // scarta — nessun alert, nessuna delivery registrata
}
```

`buildHash()` calcola SHA-256 su 8 campi: `source`, `eventKey`, `eventId`, `level`, `microservice`, `moduleName`, `functionName`, `message`.

Se l'hash del nuovo evento è identico all'ultimo inviato e siamo dentro la finestra `dedup_seconds`, l'evento viene scartato silenziosamente.

Default attuale: `dedup_seconds = 0` → dedup DISABILITATO.

## Meccanismo 2 — Throttling a finestra scorrevole

```
if (!windowStartAt || now - windowStartAt > windowSeconds * 1000) {
  windowStartAt = now;
  windowCount = 0; // reset finestra scaduta
}
if (windowCount >= maxPerWindow) {
  return; // throttle attivo
}
```

Default: max 3 alert ogni 5 minuti per regola.

Il reset della finestra è lazy: avviene solo al momento del prossimo evento, non automaticamente allo scadere del timer.

Entrambi i meccanismi possono essere configurati globalmente via env o per singola regola nel campo `match_json`:

| Parametro | Env globale | Override regola | Default |
| --- | --- | --- | --- |
| `dedup_seconds` | `ALERTING_DEDUP_SECONDS` | `match.dedup_seconds` | `0` (disabilitato) |
| `window_seconds` | `ALERTING_WINDOW_SECONDS` | `match.window_seconds` | `300` (5 min) |
| `max_per_window` | `ALERTING_MAX_PER_WINDOW` | `match.max_per_window` | `3` |

## Problemi identificati

Sei problemi identificati dall'analisi del codice `RuleEngine.js`.

## Problema 1 — Dedup disabilitato per default 🔴

`DEFAULT_DEDUP_SECONDS = 0` fa sì che la condizione `dedupSeconds > 0` sia sempre falsa. L'intero peso anti-duplicazione ricade sul throttle a finestra. Con i default: se arrivano 3 eventi identici in 5 minuti, vengono inviati 3 alert identici prima che il throttle intervenga.

## Problema 2 — Hash include il testo completo del messaggio 🔴

`buildHash()` include `event.message` nel calcolo. Se il messaggio contiene valori variabili (timestamp, ID job, contatori), ogni occorrenza produce un hash diverso e il dedup non funziona mai anche se configurato.

Esempi di messaggi che producono hash sempre diversi:

- `"FMP timeout after 15032ms"` vs `"FMP timeout after 15089ms"` → hash diversi
- `"Job scan_1742649600_abc123 completed"` vs `"Job scan_1742649700_def456 completed"` → hash diversi
- `"cacheManager: 3 symbols failed"` vs `"cacheManager: 7 symbols failed"` → hash diversi

## Problema 3 — Stato perso al restart con datahub offline 🔴

In `reloadRules()`, se il fetch di `/alerting-state` fallisce, non viene loggato nessun warning esplicito e `stateByRuleId` viene svuotata. Tutti i contatori di finestra si azzerano, causando un potenziale burst di alert duplicati al restart del servizio.

## Problema 4 — Nessuna visibilità sugli eventi soppressi 🟡

Quando il throttle scatta, non viene salvato quanti eventi aggiuntivi sono stati soppressi. Il successivo alert (al reset della finestra) non può includere informazioni come `[+7 eventi soppressi]`, riducendo la visibilità su quello che è successo durante il periodo di silenzio.

## Problema 5 — Race condition in `ensureState()` 🟡

Se due eventi arrivano quasi contemporaneamente su una regola mai vista prima, entrambi trovano `stateByRuleId` vuota e fanno una POST su `/alerting-state`. Dipende dal constraint su datahub se questo crea righe duplicate.

## Problema 6 — Regex `onEventMessage` può escludere canali validi 🟡

Il filtro `!/\.events(\.|$)/.test(channel)` richiede che dopo `events` ci sia `.` o fine stringa. Canali con naming `DEV.scheduler.events_alert` (underscore invece di punto) vengono scartati silenziosamente. Dipende dalla naming convention usata nel sistema.

---

## Alerting Service — Analisi locale aggiuntiva

> Documento generato il 23 marzo 2026.  
> Analisi del meccanismo di dedup/throttle in `RuleEngine.js` con problemi identificati e fix specifici.

---

## 1. Architettura del sistema

Il `RuleEngine` si sottoscrive a due pattern Redis:

```
ALERTING_LOGS_PATTERN   = ${ENV}.*.*.logs.*       ← log di sistema
ALERTING_EVENTS_PATTERN = ${ENV}.*.events*         ← eventi business (hook.events)
```

Ogni messaggio in arrivo viene valutato contro tutte le regole attive.  
Se una regola fa match, entra in `applyRule()` dove si trovano i meccanismi anti-duplicazione.

---

## 2. Meccanismi attuali — come funzionano

### 2.1 Meccanismo 1 — Deduplicazione per contenuto (`dedup_seconds`)

```javascript
// RuleEngine.js — applyRule()
const hash = this.buildHash(event);

if (dedupSeconds > 0 && lastHash === hash && lastSentAt && now - lastSentAt < dedupSeconds * 1000) {
  await this.updateState(ruleId, { last_matched_at: ..., last_hash: hash });
  return; // scarta — nessun alert
}
```

`buildHash()` calcola SHA-256 su 8 campi:
```javascript
[event.source, event.eventKey, event.eventId, event.level,
 event.microservice, event.moduleName, event.functionName, event.message]
```

**Logica:** se arriva un evento con hash identico all'ultimo inviato, entro la finestra `dedup_seconds`, viene scartato silenziosamente. Lo stato `last_matched_at` viene aggiornato, ma nessuna delivery viene registrata.

**Default:**
```javascript
const DEFAULT_DEDUP_SECONDS = 0;
this.dedupSeconds = Number(process.env.ALERTING_DEDUP_SECONDS) || DEFAULT_DEDUP_SECONDS;
```

Con `dedup_seconds=0` la condizione `dedupSeconds > 0` è **sempre falsa** → **dedup disabilitato per default**.

---

### 2.2 Meccanismo 2 — Throttling a finestra scorrevole (`window_seconds` + `max_per_window`)

```javascript
let windowCount = Number(state?.window_count) || 0;
let windowStartAt = windowStart;

if (!windowStartAt || now - windowStartAt > windowSeconds * 1000) {
  windowStartAt = now;
  windowCount = 0; // reset finestra scaduta
}

if (windowCount >= maxPerWindow) {
  await this.updateState(ruleId, { last_matched_at: ..., window_start_at: ..., window_count: windowCount });
  return; // scarta — throttle attivo
}
```

**Default:**
```javascript
const DEFAULT_WINDOW_SECONDS = 300;  // 5 minuti
const DEFAULT_MAX_PER_WINDOW = 3;
```

**Logica:** conta gli alert inviati in una finestra scorrevole di `window_seconds`. Se si raggiunge `max_per_window`, i successivi vengono scartati fino a reset della finestra. Il reset avviene **solo al momento del prossimo evento** (lazy reset), non automaticamente.

**Override per regola:** `match.window_seconds`, `match.max_per_window`, `match.dedup_seconds`.

---

### 2.3 Flusso completo in `applyRule()`

```
Evento arriva
     │
     ▼
[Calcola hash SHA-256 su 8 campi]
     │
     ▼
[dedup_seconds > 0?]
     ├── NO (default 0) ──────────────────────────────────────┐
     └── SÌ                                                   │
           │                                                   │
           ▼                                                   │
     [hash == lastHash E within dedup_seconds?]               │
           ├── SÌ → updateState(last_matched_at) → RETURN     │
           └── NO ──────────────────────────────────┐         │
                                                    ▼         ▼
                                        [window scaduta?]
                                        ├── SÌ → reset windowCount=0, windowStartAt=now
                                        └── NO → windowCount invariato
                                                    │
                                                    ▼
                                        [windowCount >= maxPerWindow?]
                                        ├── SÌ → updateState → RETURN (throttle)
                                        └── NO
                                                    │
                                                    ▼
                                        [Invia alert su tutti i canali (email/whatsapp/telegram)]
                                                    │
                                                    ▼
                                        [Registra delivery su DB]
                                                    │
                                                    ▼
                                        [updateState: last_sent_at, last_hash, window_count+1]
```

---

## 3. Problemi identificati

### Problema 1 — Dedup disabilitato per default (CRITICO)

**Codice:**
```javascript
const DEFAULT_DEDUP_SECONDS = 0;
```

**Effetto:** l'intero peso anti-duplicazione ricade sul throttle a finestra. Se arrivano 3 eventi identici entro 5 minuti, vengono inviati **3 alert identici**. Solo dal 4° in poi il throttle interviene.

**Scenario reale:** un servizio va in loop di errori e logga 10 volte lo stesso `[ERROR]` in 30 secondi → vengono inviati 3 alert WhatsApp/email identici prima che il throttle blocchi.

---

### Problema 2 — Hash include il testo completo del messaggio (CRITICO per log)

**Codice:**
```javascript
buildHash(event) {
  const raw = [
    event.source, event.eventKey, event.eventId,
    event.level, event.microservice, event.moduleName,
    event.functionName, event.message,  // ← testo completo
  ].filter(Boolean).join("|");
  return crypto.createHash("sha256").update(raw).digest("hex");
}
```

**Effetto:** se il messaggio contiene valori variabili, ogni occorrenza ha un hash diverso e il dedup **non funziona mai** anche se configurato.

**Esempi di messaggi con hash sempre diversi:**
```
"FMP timeout after 15032ms for AAPL"   → hash A
"FMP timeout after 15089ms for AAPL"   → hash B  (diverso!)
"Job scan_1742649600_abc123 completed"  → hash C
"Job scan_1742649700_def456 completed"  → hash D  (diverso!)
"cacheManager: 3 symbols failed"        → hash E
"cacheManager: 7 symbols failed"        → hash F  (diverso!)
```

Il dedup funziona solo se il messaggio è **letteralmente identico**, il che per i log di sistema è raro.

---

### Problema 3 — Reset finestra lazy: nessuna notifica di "fine throttle"

**Codice:**
```javascript
if (!windowStartAt || now - windowStartAt > windowSeconds * 1000) {
  windowStartAt = now;
  windowCount = 0;
}
```

Il reset avviene solo quando arriva un nuovo evento. Se la finestra scade ma non arriva nessun nuovo evento, non viene inviata nessuna notifica "throttle terminato". Questo è corretto nella maggior parte dei casi, ma se vuoi sapere quanti eventi sono stati soppressi, non hai questa informazione nell'alert.

---

### Problema 4 — Stato perso al restart con datahub offline

**Codice:**
```javascript
// reloadRules()
const stateResp = await this.http.get(convertPathToDatahub("/alerting-state"));
if (stateResp.status < 400 && Array.isArray(stateResp.data?.items)) {
  this.stateByRuleId.clear();
  for (const st of stateResp.data.items) {
    this.stateByRuleId.set(Number(st.rule_id), st);
  }
}
// Se datahub è offline: stateByRuleId rimane vuota, nessun errore esplicito
```

**Effetto:** dopo un restart con datahub temporaneamente offline, tutti i `window_count` si azzerano. Se prima del restart erano stati inviati 3 alert (limite), dopo il restart il contatore riparte da 0 e altri 3 alert possono essere inviati immediatamente.

**Scenario reale:** il servizio va in crash durante un burst di errori → alla ripartenza, altri 3 alert vengono inviati duplicando quelli precedenti.

---

### Problema 5 — Pattern regex `onEventMessage` potrebbe escludere canali validi

**Codice:**
```javascript
async onEventMessage(payload, channel) {
  if (typeof channel === "string" && !/\.events(\.|$)/.test(channel)) return;
```

**Pattern di subscription:** `${ENV}.*.events*`  
**Pattern di filtro regex:** `\.events(\.|$)` — richiede che dopo `events` ci sia `.` o fine stringa.

Se un canale è `DEV.scheduler.events_alert` il regex **non fa match** (perché dopo `events` c'è `_`, non `.` o fine stringa) e il messaggio viene scartato silenziosamente.

**Verifica:** controllare che tutti i canali event del sistema seguano il pattern `*.events` o `*.events.subcanale`, non `*.events_tipo`.

---

### Problema 6 — `ensureState()` non è atomica (race condition teorica)

**Codice:**
```javascript
async ensureState(ruleId) {
  const key = Number(ruleId);
  if (this.stateByRuleId.has(key)) return this.stateByRuleId.get(key);
  // ← gap: due eventi quasi simultanei sulla stessa regola vuota
  //   possono entrambi passare qui e fare due POST
  const resp = await this.http.post(convertPathToDatahub("/alerting-state"), { rule_id: key });
```

**Nella pratica:** Node.js è single-threaded, ma `await` cede il controllo. In un burst iniziale su una regola mai vista, due handler concorrenti potrebbero entrambi trovare la map vuota e fare POST duplicata. Se datahub ha un constraint `UNIQUE (rule_id)` il secondo POST fallisce con 409 e lo stato viene ignorato. Se non c'è constraint, si creano due righe per lo stesso `rule_id`.

---

## 4. Fix specifici

### Fix 1 — Abilitare dedup per default con valore sensato

**File:** `alertingService/modules/RuleEngine.js`

```javascript
// PRIMA
const DEFAULT_DEDUP_SECONDS = 0;

// DOPO
const DEFAULT_DEDUP_SECONDS = 60; // 60 secondi di default — stesso evento non inviato due volte in un minuto
```

E aggiornare l'env:
```bash
# .env
ALERTING_DEDUP_SECONDS=60
```

**Effetto:** eventi con hash identico non vengono inviati più di una volta al minuto. Il throttle a finestra rimane come secondo layer di protezione.

---

### Fix 2 — Hash semantico: escludere la parte variabile del messaggio

**File:** `alertingService/modules/RuleEngine.js`

Il problema è che `event.message` contiene valori variabili. La soluzione è costruire un hash "semantico" che identifica il **tipo** di errore, non la sua istanza specifica.

```javascript
// PRIMA
buildHash(event) {
  const raw = [
    event.source, event.eventKey, event.eventId,
    event.level, event.microservice, event.moduleName,
    event.functionName, event.message,
  ].filter(Boolean).join("|");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// DOPO
buildHash(event) {
  // Per gli eventi business (hook.events): hash su tipo evento, non sul messaggio variabile
  // Per i log: normalizza il messaggio rimuovendo i valori variabili noti
  const normalizedMessage = this._normalizeMessage(event.message);

  const raw = [
    event.source,
    event.eventKey,
    event.eventId,
    event.level,
    event.microservice,
    event.moduleName,
    event.functionName,
    normalizedMessage,
  ].filter(Boolean).join("|");

  return crypto.createHash("sha256").update(raw).digest("hex");
}

_normalizeMessage(msg) {
  if (!msg || typeof msg !== "string") return "";
  return msg
    // rimuove timestamp in ms: "15032ms" → "Nms"
    .replace(/\d+ms\b/gi, "Nms")
    // rimuove numeri standalone: "3 symbols" → "N symbols"
    .replace(/\b\d+\b/g, "N")
    // rimuove UUID/job ID: "scan_1742649600_abc123" → "scan_ID"
    .replace(/[a-z]+_[\d_a-z]{6,}/gi, "ID")
    // normalizza spazi multipli
    .replace(/\s+/g, " ")
    .trim();
}
```

**Effetto:** messaggi dello stesso tipo producono lo stesso hash:
```
"FMP timeout after 15032ms for AAPL"  → "FMP timeout after Nms for AAPL" → hash A
"FMP timeout after 15089ms for AAPL"  → "FMP timeout after Nms for AAPL" → hash A (uguale!)
"cacheManager: 3 symbols failed"      → "cacheManager: N symbols failed" → hash B
"cacheManager: 7 symbols failed"      → "cacheManager: N symbols failed" → hash B (uguale!)
```

**Nota:** la normalizzazione può essere affinata nel tempo aggiungendo pattern specifici al sistema. Il punto di partenza sopra è conservativo e non rimuove informazioni utili.

---

### Fix 3 — Aggiungere contatore eventi soppressi nella delivery

**File:** `alertingService/modules/RuleEngine.js`

Quando il throttle scatta, aggiungere al conteggio quanti eventi sono stati soppressi, in modo che il prossimo alert (al reset della finestra) possa riportarlo.

```javascript
// In updateState quando throttle scatta:
if (windowCount >= maxPerWindow) {
  await this.updateState(ruleId, {
    last_matched_at: new Date(now).toISOString(),
    last_hash: hash,
    window_start_at: new Date(windowStartAt).toISOString(),
    window_count: windowCount,
    suppressed_count: (Number(state?.suppressed_count) || 0) + 1, // ← nuovo campo
  });
  return;
}

// In renderTemplate, aggiungere {{suppressed}} come variabile disponibile:
renderTemplate(template, event, suppressedCount = 0) {
  const map = {
    // ... campi esistenti ...
    suppressed: suppressedCount > 0 ? ` [+${suppressedCount} eventi soppressi]` : "",
  };
  // ...
}

// Quando si invia l'alert, resettare il contatore:
await this.updateState(ruleId, {
  // ... patch esistente ...
  suppressed_count: 0, // reset dopo invio
});
```

**Effetto:** il primo alert dopo un throttle può includere `[+7 eventi soppressi]` nel messaggio, dando visibilità su quanto è stato silenziato.

---

### Fix 4 — Guard esplicito al reload con datahub offline

**File:** `alertingService/modules/RuleEngine.js`

```javascript
async reloadRules() {
  const rulesResp = await this.http.get(convertPathToDatahub("/alerting-rules"));
  if (rulesResp.status >= 400) {
    this.logger.error(`[ruleEngine] reload rules failed status=${rulesResp.status}`);
    return { ok: false, error: "rules load failed", status: rulesResp.status };
  }
  this.rules = Array.isArray(rulesResp.data?.items) ? rulesResp.data.items : [];

  const stateResp = await this.http.get(convertPathToDatahub("/alerting-state"));
  if (stateResp.status < 400 && Array.isArray(stateResp.data?.items)) {
    this.stateByRuleId.clear();
    for (const st of stateResp.data.items) {
      if (st?.rule_id != null) this.stateByRuleId.set(Number(st.rule_id), st);
    }
    this.logger.info(`[ruleEngine] reload ok rules=${this.rules.length} state=${this.stateByRuleId.size}`);
  } else {
    // AGGIUNTO: log esplicito e non svuotare lo stato esistente
    this.logger.warning(
      `[ruleEngine] alerting-state load failed status=${stateResp.status} — keeping existing in-memory state (${this.stateByRuleId.size} entries)`
    );
    // NON fare stateByRuleId.clear() se il fetch fallisce
    // Lo stato in-memory sopravvive parzialmente anche se datahub è offline
  }

  await this.refreshSubscriptions();
  return { ok: true, rules: this.rules.length, state: this.stateByRuleId.size };
}
```

**Effetto:** se datahub è offline al momento del reload, lo stato in-memory NON viene azzerato. I contatori di finestra sopravvivono al reload anche con datahub temporaneamente offline.

---

### Fix 5 — Fix race condition in `ensureState()` con mutex in-memory

**File:** `alertingService/modules/RuleEngine.js`

```javascript
constructor(...) {
  // ...
  this._ensuringState = new Set(); // mutex leggero per ensureState
}

async ensureState(ruleId) {
  const key = Number(ruleId);
  if (this.stateByRuleId.has(key)) return this.stateByRuleId.get(key);

  // Se stiamo già creando lo stato per questa regola (burst iniziale), aspetta
  if (this._ensuringState.has(key)) {
    // Retry dopo un tick
    await new Promise(r => setTimeout(r, 10));
    return this.stateByRuleId.get(key) || null;
  }

  this._ensuringState.add(key);
  try {
    const resp = await this.http.post(convertPathToDatahub("/alerting-state"), { rule_id: key });
    if (resp.status >= 400 && resp.status !== 409) return null;
    // Se 409 (già esiste), recupera lo stato esistente
    if (resp.status === 409) {
      const existing = await this.http.get(
        `${convertPathToDatahub("/alerting-state")}?rule_id=${key}`
      );
      const row = existing.data?.items?.[0] || null;
      if (row) this.stateByRuleId.set(key, row);
      return row;
    }
    const state = { rule_id: key, id: resp.data?.id };
    this.stateByRuleId.set(key, state);
    return state;
  } finally {
    this._ensuringState.delete(key);
  }
}
```

---

### Fix 6 — Fix regex `onEventMessage` per canali con underscore

**File:** `alertingService/modules/RuleEngine.js`

```javascript
// PRIMA
async onEventMessage(payload, channel) {
  if (typeof channel === "string" && !/\.events(\.|$)/.test(channel)) return;

// DOPO
async onEventMessage(payload, channel) {
  // Accetta: *.events, *.events.sub, *.events_tipo, *.events-tipo
  if (typeof channel === "string" && !/\.events[._\-]?/.test(channel)) return;
```

O più robusto, usare lo stesso pattern di subscription per il check:

```javascript
async onEventMessage(payload, channel) {
  // Verifica che il canale corrisponda al pattern di subscription
  // ALERTING_EVENTS_PATTERN = "${ENV}.*.events*"
  // Converte il pattern glob in regex: * → [^.]+, eventKey* → eventKey.*
  if (typeof channel === "string") {
    const patternRegex = new RegExp(
      this.eventsPattern
        .replace(/\./g, "\\.")
        .replace(/\*/g, "[^.]*")
    );
    if (!patternRegex.test(channel)) return;
  }
```

---

## 5. Configurazione consigliata per le regole

### Per eventi business critici (es. DB_OFFLINE, CAPITAL_BREACH)

```json
{
  "match_json": {
    "source": "events",
    "event_key": "DB_OFFLINE",
    "dedup_seconds": 300,
    "window_seconds": 3600,
    "max_per_window": 2
  }
}
```

Comportamento: stesso tipo di evento non invia più di 1 alert ogni 5 minuti, e non più di 2 in un'ora.

### Per log di errore ripetuti (es. FMP timeout)

```json
{
  "match_json": {
    "source": "logs",
    "levels": ["error"],
    "services": ["cacheManager"],
    "message_grep": "FMP.*timeout",
    "dedup_seconds": 120,
    "window_seconds": 600,
    "max_per_window": 2
  }
}
```

Comportamento: stesso tipo di errore non invia più di 1 alert ogni 2 minuti.

### Default globale consigliato

```bash
# .env
ALERTING_DEDUP_SECONDS=60      # stesso evento identico: max 1/minuto
ALERTING_WINDOW_SECONDS=300    # finestra 5 minuti
ALERTING_MAX_PER_WINDOW=3      # max 3 alert per regola per finestra
```

---

## 6. Riepilogo fix e priorità

| # | Problema | Fix | Priorità | Impatto |
|---|----------|-----|----------|---------|
| 1 | Dedup disabilitato per default | `DEFAULT_DEDUP_SECONDS=60` + env | 🔴 Alta | Riduce alert identici immediati |
| 2 | Hash include testo variabile | `_normalizeMessage()` | 🔴 Alta | Dedup funziona su log reali |
| 3 | Stato perso al restart con datahub offline | Non svuotare stateByRuleId se fetch fallisce | 🔴 Alta | Evita burst post-restart |
| 4 | Nessuna visibilità eventi soppressi | Campo `suppressed_count` + `{{suppressed}}` nel template | 🟡 Media | Visibilità su throttle |
| 5 | Race condition in `ensureState` | Mutex `_ensuringState` + gestione 409 | 🟡 Media | Solo burst iniziale |
| 6 | Regex canali events esclude `_` | Fix regex `onEventMessage` | 🟡 Media | Dipende dalla naming convention |

---

## 7. Comportamento atteso dopo i fix

| Scenario | Prima dei fix | Dopo i fix |
|----------|--------------|------------|
| Stesso errore 10 volte in 30s | 3 alert identici poi throttle | 1 alert poi dedup per 60s |
| Errore con ms variabili in loop | 3 alert (hash sempre diversi) | 1 alert (hash normalizzato) |
| Restart con datahub offline | Burst di 3 nuovi alert | Nessun burst — stato preservato |
| Evento critico ogni 6 minuti | 1 alert per evento (finestra resetta) | 1 alert per evento (invariato) |
| Canale `events_alert` | Messaggio ignorato silenziosamente | Messaggio processato correttamente |

---

*Fine documento. I fix 1, 2, 3 sono indipendenti e possono essere applicati in qualsiasi ordine.*
