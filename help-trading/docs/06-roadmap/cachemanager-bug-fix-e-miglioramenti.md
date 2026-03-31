---
sidebar_position: 2
title: Possibile bug cacheManager — Candele mese corrente da verificare
---

# Possibile bug cacheManager — Candele mese corrente da verificare

## Navigazione

1. Analisi codice — Comportamento confermato (v2.5.0)
2. Conferma dal codice sorgente (main.js)
3. Fix proposto
4. Workaround temporaneo
5. Priorità
6. Comportamento attuale
7. Il problema con il mese corrente
8. Impatto potenziale
9. Verifica da effettuare
10. Fix suggerito
11. Priorità
12. Bug provider — FMP fallback silenzioso durante processi automatici
13. Sintomo osservato
14. Bug 1 — FMP restituisce 200 anche sugli errori (causa principale)
15. Bug 2 — Array vuoto viene scritto come file "completo"
16. Bug 3 — Fallback non logga l'errore originale
17. Fix proposti
18. Workaround immediato
19. Priorità
20. Bug SMA_200 — Meno di 200 candele restituite per ticker con storia sufficiente
21. Sintomo osservato
22. Causa principale — file mensile vuoto non rilevato
23. Causa secondaria — `_filterCandlesByRange` esclude l'ultimo giorno
24. Fix proposti
25. Diagnostica rapida
26. Priorità
27. Nuovo endpoint — Verifica integrità cache, riempimento buchi e report

## Analisi codice — Comportamento confermato (v2.5.0)

## Conferma dal codice sorgente (main.js)

Il bug è stato verificato analizzando il codice di `getCandles` in `cacheManager/modules/main.js`.

### Logica attuale (v2.5.0)

```
// In getCandles():
for (const monthKey of monthKeys) {
  const ensured = this._ensureCanonicalL2MonthFile(symbol, tfCache, monthKey);
  if (!ensured) missingMonths.push(monthKey); // criterio: file esiste o no
}
```

Il criterio di cache hit è puramente binario: il file esiste → usalo. Non viene controllata la data dell'ultima candela presente nel file né la data di modifica del file stesso. Questo comportamento è stato introdotto intenzionalmente nella v2.5.0 (`release.json`: "Non si entra più nel merito delle candele presenti per ogni file") ma non contempla il caso del mese corrente.

### Aggravante: `_monthBoundsUtc`

Quando il mese corrente non ha ancora il file, il download avviene con bounds completi del mese:

```
_monthBoundsUtc(monthKey) {
  const to = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0) - 1); // 2026-03-31T23:59:59.999Z
  return { fromIso, toIso };
}
```

Il provider (FMP/Alpaca) restituirà solo le candele disponibili fino a oggi, ma il file viene salvato e classificato come "mese completo". Ogni richiesta successiva troverà il file e non lo aggiornerà mai.

### Scenario concreto

```
3 marzo  → richiesta candele marzo
           → file marzo non esiste → download 1-3 marzo dal provider
           → salva file 2026-03_1day.json (3 candele)

20 marzo → richiesta candele 1-20 marzo
           → _ensureCanonicalL2MonthFile() → file ESISTE → non entra nei missingMonths
           → restituisce 1-3 marzo   ← BUG: mancano 4-20 marzo
```

## Fix proposto

Aggiungere un controllo nella fase di verifica: se il mese è quello corrente e il file supera una soglia di "staleness", forzare il refresh.

```
// In getCandles() — aggiunta minima
const now = new Date();
const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

for (const monthKey of monthKeys) {
  const ensured = this._ensureCanonicalL2MonthFile(symbol, tfCache, monthKey);

  if (ensured && monthKey === currentMonthKey) {
    // Mese corrente: verifica se il file è stale
    if (this._isCurrentMonthFileStale(symbol, tfCache, monthKey)) {
      this.logger.info(`[getCandles] File mese corrente stale per ${symbol}, forzo refresh`);
      missingMonths.push(monthKey);
      continue;
    }
  }

  if (!ensured) missingMonths.push(monthKey);
}
```

```
// Nuovo metodo da aggiungere alla classe CacheManager
_isCurrentMonthFileStale(symbol, tfCache, monthKey) {
  try {
    const file = this._l2MonthFilePath(symbol, tfCache, monthKey);
    const stat = fs.statSync(file);
    const staleThresholdMs =
      parseInt(process.env.CURRENT_MONTH_STALE_THRESHOLD_HOURS || "12") * 60 * 60 * 1000;
    return (Date.now() - stat.mtimeMs) > staleThresholdMs;
  } catch {
    return true; // file non leggibile → considera stale
  }
}
```

`CURRENT_MONTH_STALE_THRESHOLD_HOURS` configurabile via env. Default 12h adeguato per daily bars (market chiude 16:00 ET, file aggiornato nella notte). Per timeframe intraday potrebbe essere ridotto a 1-2h.

## Workaround temporaneo

Fino all'applicazione del fix, è possibile forzare il refresh del mese corrente cancellando manualmente il file tramite l'endpoint già disponibile:

```
# Cancella il file del mese corrente per un simbolo
POST /l2/clear?symbol=NVDA&file=2026-03_1day.json
```

La prossima richiesta di candele riscaricarà l'intero mese aggiornato.

## Priorità

Media-Alta — non blocca il sistema ma introduce silenziosamente dati incompleti nell'analisi tecnica per tutti i ticker durante il mese in corso. L'impatto aumenta proporzionalmente a quanti giorni sono passati dall'ultimo download del file mensile.

## Comportamento attuale

Quando viene richiesto un range di candele che cade all'interno di un mese già scaricato, il `cacheManager` adotta la seguente logica:

1. Riceve una richiesta per un periodo specifico (es. `2026-03-01` → `2026-03-15`)
2. Verifica se esiste già il file mensile per `2026-03` in cache
3. Se il file esiste → lo considera completo e restituisce il sottoinsieme richiesto
4. Se il file non esiste → scarica l'intero mese dal provider e lo salva

Questa logica è corretta per mesi passati e chiusi: se il file di febbraio esiste, contiene tutte le candele di febbraio per definizione.

## Il problema con il mese corrente

Il mese corrente non è mai completo per definizione — le candele vengono generate giorno per giorno. Se il file del mese corrente è stato scaricato il giorno 10, conterrà solo le candele dall'1 al 10. Qualsiasi richiesta successiva che cade nello stesso mese (es. dall'1 al 20) troverà il file esistente, lo considererà completo e restituirà dati troncati al giorno 10 senza accorgersi che mancano le candele più recenti.

```
Scenario problematico:

  3 marzo  → richiesta candele marzo
             → file marzo non esiste
             → download 1-3 marzo dal provider
             → salva file marzo (3 giorni)

  20 marzo → richiesta candele 1-20 marzo
             → file marzo ESISTE
             → restituisce 1-3 marzo         ← BUG: mancano 4-20 marzo
             → nessun aggiornamento effettuato
```

## Impatto potenziale

- Il `decision-engine` riceve candele incomplete per il mese corrente
- L'analisi delle zone di supporto/resistenza e il calcolo dell'ATR sono basati su dati troncati
- I segnali generati potrebbero essere basati su un contesto di mercato parziale
- Il problema si autoalimenta: ogni richiesta successiva nello stesso mese restituisce sempre i dati del primo download, mai aggiornati

## Verifica da effettuare

- Controllare la logica di cache hit nel `cacheManager` per le richieste mensili
- Verificare se esiste già un controllo sulla data dell'ultimo aggiornamento del file
- Verificare se il mese corrente viene trattato diversamente dai mesi passati
- Controllare se il problema si presenta anche per la settimana corrente (stesso pattern)

## Fix suggerito

Aggiungere un controllo esplicito: se il mese richiesto è il mese corrente, non considerare il file esistente come completo e procedere sempre con un aggiornamento incrementale (scarica solo le candele mancanti dall'ultimo giorno presente nel file fino a oggi).

```
// Logica corretta (pseudocodice)
const isCurrentMonth = isCurrentMonth(year, month);

if (fileExists && !isCurrentMonth) {
  // Mese passato → file completo → usa cache
  return readFromCache(file, startDate, endDate);
}

if (fileExists && isCurrentMonth) {
  // Mese corrente → verifica ultima candela disponibile
  const lastCachedDate = getLastCandleDate(file);
  const today = new Date();

  if (lastCachedDate < today - 1 trading day) {
    // Aggiorna incrementalmente dal giorno successivo all'ultimo cached
    const newCandles = fetchFromProvider(lastCachedDate + 1, today);
    appendToCache(file, newCandles);
  }
  return readFromCache(file, startDate, endDate);
}

if (!fileExists) {
  // Nessuna cache → download completo
  const candles = fetchFromProvider(monthStart, today);
  saveToCache(file, candles);
  return filterRange(candles, startDate, endDate);
}
```

## Priorità

Media — non blocca il sistema ma può introdurre silenziosamente dati incompleti nell'analisi tecnica. Da verificare prima di mettere in produzione sessioni live intensive su mesi non ancora chiusi.

## Bug provider — FMP fallback silenzioso durante processi automatici

## Sintomo osservato

Durante processi automatici (job su N ticker) compaiono log:

```
FMP fallito per UTI, provo IBKR
IBKR fallito per UTI, provo ALPACA
ALPACA fallito per UTI, ...
```

La stessa richiesta eseguita manualmente dalla UI (tab Specific, tutti e tre i provider) funziona correttamente. Questo pattern — funziona manuale, fallisce automatico — indica che il problema non è nel provider ma nel modo in cui gli errori vengono gestiti durante carichi concorrenti.

---

## Bug 1 — FMP restituisce 200 anche sugli errori (causa principale)

In `modules/fmp.js`, la risposta non viene mai validata per il contenuto:

```
const res = await axios.get(url, { params });
const rows = Array.isArray(res.data) ? res.data
           : Array.isArray(res.data?.historical) ? res.data.historical
           : [];
return rows.map(...);
```

FMP utilizza HTTP 200 anche per rate limit e altri errori, restituendo un body del tipo:

```
{ "Error Message": "Limit Reach." }
```

oppure:

```
{ "status": "error", "message": "Too many requests" }
```

Poiché `res.data` non è un array, il codice assegna `rows = []` e ritorna zero candele senza lanciare eccezione. Axios non vede alcun errore HTTP → non entra nel `catch` → il fallback IBKR/ALPACA non viene mai attivato correttamente → si perde nel log come se il provider avesse semplicemente risposto vuoto.

Durante esecuzione manuale (singola richiesta) il rate limit non viene raggiunto → FMP risponde correttamente → nessun problema visibile.

---

## Bug 2 — Array vuoto viene scritto come file "completo"

In `modules/main.js`, dopo il fetch dal provider:

```
const monthCandles = this._filterCandlesByRange(providerCandles, fromIso, toIso);
await this._writeL2MonthFile(symbol, tfCache, monthKey, monthCandles);
```

Non c'è nessun controllo su `monthCandles.length`. Se il provider ha restituito 0 candele (per rate limit silenzioso), viene scritto un file JSON con array vuoto `[]`. La prossima richiesta troverà il file → `_ensureCanonicalL2MonthFile` ritornerà il path → il mese viene classificato come "presente e completo" → restituisce 0 candele al chiamante senza errori.

Questo bug si autoalimenta: il file vuoto non viene mai sovrascritto perché il mese risulta già in cache.

---

## Bug 3 — Fallback non logga l'errore originale

In `main.js`, il messaggio di warning nel fallback ingoia l'errore:

```
} catch (err) {
  this.logger.warning(`[L1] FMP fallito per ${symbol}, provo IBKR`);
  // err.message non viene mai loggato
}
```

Questo rende impossibile diagnosticare la causa reale del fallimento dai log. Non si sa se è un timeout, un rate limit, un errore di rete o altro.

---

## Fix proposti

### Fix 1 — `fmp.js`: validare il body della risposta

```
async fetchDailyBars({ symbol, start, end, timeframe, periodLength }) {
  const res = await axios.get(url, { params });

  // FMP usa HTTP 200 anche per errori — controllare il body
  const errMsg = res.data?.["Error Message"] || res.data?.message || null;
  if (errMsg) {
    throw new Error(`[FMP] Errore provider per ${symbol}: ${errMsg}`);
  }

  const rows = Array.isArray(res.data) ? res.data
             : Array.isArray(res.data?.historical) ? res.data.historical
             : [];

  if (!rows.length) {
    this.logger.warning(`[FMP] 0 candele per ${symbol} ${start}→${end} — possibile errore silenzioso`);
  }

  return rows.map(...);
}
```

### Fix 2 — `main.js`: non scrivere file con 0 candele

```
const monthCandles = this._filterCandlesByRange(providerCandles, fromIso, toIso);

if (!monthCandles.length) {
  this.logger.error(
    `[getCandles] Provider ha restituito 0 candele per ${symbol} ${monthKey} — file non scritto`
  );
  continue; // salta la scrittura, il mese rimane in missingMonths al prossimo giro
}

await this._writeL2MonthFile(symbol, tfCache, monthKey, monthCandles);
```

### Fix 3 — `main.js`: loggare sempre `err.message` nel fallback

```
} catch (err) {
  this.logger.warning(`[L1] FMP fallito per ${symbol}: ${err.message}, provo IBKR`);
}
// ...
} catch (err2) {
  this.logger.warning(`[L1] IBKR fallito per ${symbol}: ${err2.message}, provo ALPACA`);
}
```

---

## Workaround immediato

Se per un simbolo è già stato scritto un file vuoto, è possibile rimuoverlo tramite l'endpoint esistente:

```
POST /l2/clear?symbol=UTI&file=2026-03_1day.json
```

Per identificare tutti i file vuoti o corrotti si può usare l'audit:

```
GET /l2/audit?symbol=UTI
```

Il campo `brokenReasons.not_array` e `validCandles = 0` segnaleranno i file problematici.

---

## Priorità

Alta — durante i job automatici su molti ticker il rate limit FMP è frequente. I file vuoti scritti silenziosamente bloccano il refresh per l'intero mese (combinato con il bug del mese corrente descritto sopra), rendendo i dati del simbolo completamente assenti per tutto il ciclo.

## Bug SMA_200 — Meno di 200 candele restituite per ticker con storia sufficiente

## Sintomo osservato

Per diversi ticker nei log compare un warning del tipo:

```
[decision-engine] SMA_200 non calcolabile per UTI: solo 123 candele disponibili
```

Il ticker ha storia superiore a 200 giorni di mercato. Il problema non è nel provider ma nella catena di lettura L2.

---

## Causa principale — file mensile vuoto non rilevato

Il bug del provider FMP (rate limit silenzioso → array vuoto scritto su file) descritto nel paragrafo precedente è la causa diretta. Quando `_readL2ByMonthKeys` itera sui mesi richiesti, un file mensile vuoto `[]` viene letto e contribuisce con 0 candele senza alcun warning:

```
_readL2ByMonthKeys(symbol, tfCache, monthKeys = []) {
  for (const monthKey of monthKeys) {
    const file = this._ensureCanonicalL2MonthFile(symbol, tfCache, monthKey);
    if (!file || !fs.existsSync(file)) continue;  // ← salta silenziosamente
    try {
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(json)) out.push(...json);  // ← json=[] contribuisce 0 candele, nessun warning
    }
  }
}
```

### Scenario concreto

```
Richiesta ~200 giorni (7 mesi) per UTI

File presenti in L2:
  2025-09_1day.json  →  22 candele  ✓
  2025-10_1day.json  →  []          ← scritto vuoto per rate limit FMP
  2025-11_1day.json  →  21 candele  ✓
  2025-12_1day.json  →  22 candele  ✓
  2026-01_1day.json  →  23 candele  ✓
  2026-02_1day.json  →  20 candele  ✓
  2026-03_1day.json  →  15 candele  ✓  (mese corrente)

Totale restituito: 123 candele  → SMA_200 non calcolabile
```

Due o tre file vuoti in mesi intermedi sono sufficienti per scendere sotto la soglia di 200.

---

## Causa secondaria — `_filterCandlesByRange` esclude l'ultimo giorno

Quando `endDate` viene passato come stringa date-only (`"2026-03-20"` senza `T00:00:00Z`), il comportamento di `new Date("2026-03-20")` in Node.js varia in base alla timezone del processo. Su server in UTC+4 (Dubai), la stringa viene interpretata come `2026-03-19T20:00:00Z`, escludendo tutte le candele del 20 marzo il cui timestamp è `2026-03-20T00:00:00.000Z`.

```
_filterCandlesByRange(candles, startDate, endDate) {
  const endTs = new Date(endDate).getTime(); // ← "2026-03-20" → 2026-03-19T20:00Z su UTC+4
  return candles.filter((c) => {
    const t = this._toTimestampMs(c?.t ?? ...);
    return t >= startTs && t <= endTs; // ← candele del 20 marzo escluse
  });
}
```

Su un range di 200 giorni questo sottrae tipicamente 1 candela per ogni giorno "bordo" mal interpretato — meno critico del problema dei file vuoti ma contribuisce.

---

## Fix proposti

### Fix 1 — `main.js`: loggare e saltare esplicitamente file vuoti in `_readL2ByMonthKeys`

```
_readL2ByMonthKeys(symbol, tfCache, monthKeys = []) {
  const out = [];
  for (const monthKey of monthKeys) {
    const file = this._ensureCanonicalL2MonthFile(symbol, tfCache, monthKey);
    if (!file || !fs.existsSync(file)) {
      this.logger.warning(
        `[L2] File mancante per ${symbol} ${monthKey}_${tfCache} — mese escluso dalla lettura`
      );
      continue;
    }
    try {
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!Array.isArray(json) || json.length === 0) {
        this.logger.warning(
          `[L2] File vuoto o non valido per ${symbol} ${monthKey}_${tfCache} — mese escluso`
        );
        continue;
      }
      out.push(...json);
    } catch (err) {
      this.logger.error(`[L2] Errore parse file ${file}: ${err.message}`);
    }
  }
  return out
    .map(...)
    .filter(Boolean)
    .sort((a, b) => new Date(a.t) - new Date(b.t));
}
```

### Fix 2 — `main.js`: normalizzare le date in ingresso a UTC esplicito

```
async getCandles(symbol, startDate, endDate, tf, exchange) {
  // Normalizza date-only a ISO UTC per evitare ambiguità di timezone
  const toUtcIso = (d) =>
    d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00.000Z` : d;

  startDate = toUtcIso(startDate);
  endDate   = toUtcIso(endDate);

  // ...resto invariato
}
```

### Fix 3 — `main.js`: warning esplicito quando il totale candele è sotto soglia

```
// Alla fine di getCandles, prima del return:
if (filtered.length < 200 && tf === "1day") {
  this.logger.warning(
    `[getCandles] ${symbol}: restituite solo ${filtered.length} candele daily — ` +
    `verifica file L2 con GET /l2/audit?symbol=${symbol}`
  );
}
return filtered;
```

---

## Diagnostica rapida

Per identificare i file vuoti per un simbolo specifico:

```
GET /l2/audit?symbol=UTI
```

Cercare nel risultato:

- `validCandles = 0` su un file → file vuoto da rigenerare
- `brokenReasons.not_array > 0` → file corrotto

Per forzare il refresh di un mese specifico:

```
POST /l2/clear?symbol=UTI&file=2025-10_1day.json
```

La prossima chiamata `getCandles` per quel simbolo riscaricarà il mese mancante.

---

## Priorità

Alta — il problema blocca silenziosamente il calcolo di SMA_200 e di tutti gli indicatori che richiedono finestre lunghe (ATR_20, zone di supporto/resistenza su base storica). I ticker affetti vengono scartati dall'analisi senza un errore esplicito, il che può causare un universo di analisi incompleto nei job EOD e live scan.

## Nuovo endpoint — Verifica integrità cache, riempimento buchi e report

## Motivazione

I bug descritti nei paragrafi precedenti (file mensili vuoti, candele troncate, mese corrente non aggiornato) sono difficili da rilevare in modo sistematico: l'audit esistente (`GET /l2/audit`) segnala file corrotti o non-array ma non rileva i buchi interni (giorni di mercato mancanti all'interno di un file altrimenti valido) né i file mensili completamente assenti per simboli che hanno storia sufficiente.

Serve un endpoint dedicato che faccia tutto in sequenza: ispeziona, ripara, riporta.

---

## Specifiche del nuovo endpoint

### `POST /l2/heal`

Avvia un job asincrono di ispezione e riparazione della cache L2. Può operare su un singolo simbolo o sull'intera cache.

Query params:

| Parametro | Tipo | Default | Descrizione |
| --- | --- | --- | --- |
| `symbol` | string | — | Se specificato, opera solo su quel simbolo |
| `tf` | string | `1day` | Timeframe da controllare |
| `from` | string (YYYY-MM-DD) | 12 mesi fa | Data di inizio del range da verificare |
| `to` | string (YYYY-MM-DD) | oggi | Data di fine del range da verificare |
| `heal` | boolean | `true` | Se `false`, solo report senza tentare riparazione |
| `dry_run` | boolean | `false` | Se `true`, simula senza scrivere nulla |

Risposta immediata (job asincrono):

```
{
  "ok": true,
  "jobId": "heal_1234567890_abc",
  "status": "running",
  "startedAt": "2026-03-22T10:00:00Z"
}
```

---

### `GET /l2/heal/:jobId`

Stato e risultato del job. Quando completato, include il report completo.

---

## Logica interna del job

### Fase 1 — Identificazione dei mesi attesi

Per ogni simbolo da verificare, il job calcola la lista dei mesi che dovrebbero esistere nel range `from`→`to`:

```
const expectedMonths = listMonthKeysBetween(from, to);
// es. ["2025-04", "2025-05", ..., "2026-03"]
```

### Fase 2 — Verifica file mancanti

Per ogni mese atteso, controlla se il file `SYMBOL/YYYY-MM_1day.json` esiste in L2.

Se manca → aggiunge alla lista `missing_files` e tenta il download (se `heal=true`).

### Fase 3 — Verifica buchi interni nei file esistenti

Per ogni file presente, carica le candele e confronta le date effettive con il calendario dei giorni di mercato aperti per quel mese:

```
// Giorni di mercato attesi per un mese = tutti i giorni lun-ven
// escludendo i principali festivi NYSE (01/01, MLK, Presidents Day,
// Good Friday, Memorial Day, Independence Day, Labor Day,
// Thanksgiving, Christmas)
const expectedTradingDays = getTradingDays(monthStart, monthEnd);
const actualDates = new Set(candles.map(c => c.t.slice(0, 10)));

const gaps = expectedTradingDays.filter(d => !actualDates.has(d));
```

Se `gaps.length > 0` → aggiunge alla lista `internal_gaps` e tenta il download incrementale (se `heal=true`).

### Fase 4 — Tentativo di riparazione con fallback provider

Per ogni buco (file mancante o gap interno), tenta il download nell'ordine:

```
1. Provider primario (HISTORICAL_PROVIDER da env)
2. Fallback 1 (es. FMP se primario è ALPACA)
3. Fallback 2 (es. IBKR se entrambi falliscono)
```

Per i gap interni usa un range ristretto (es. `from = primo_giorno_gap - 1`, `to = ultimo_giorno_gap + 1`) per evitare di riscaricare l'intero mese.

Se il download riesce → merge con le candele esistenti → riscrive il file → segna il gap come `healed`.

Se tutti i provider falliscono → segna il gap come `unhealed` con il motivo dell'errore.

Protezione mese corrente: per il mese in corso usa sempre `to = oggi` invece della fine del mese, evitando di considerare come buchi i giorni futuri.

### Fase 5 — Generazione del report

Al termine, il job produce un report strutturato con due sezioni principali.

---

## Struttura del report finale

```
{
  "jobId": "heal_1234567890_abc",
  "status": "completed",
  "startedAt": "2026-03-22T10:00:00Z",
  "finishedAt": "2026-03-22T10:04:33Z",
  "params": {
    "symbol": null,
    "tf": "1day",
    "from": "2025-03-01",
    "to": "2026-03-22",
    "heal": true,
    "dry_run": false
  },
  "summary": {
    "symbolsChecked": 142,
    "missingFiles": 3,
    "missingFilesHealed": 2,
    "missingFilesUnhealed": 1,
    "internalGapsFound": 27,
    "internalGapsHealed": 19,
    "internalGapsUnhealed": 8,
    "totalCandlesAdded": 341
  },
  "unhealed": {
    "missing_files": [
      {
        "symbol": "UTI",
        "month": "2025-10",
        "tf": "1day",
        "reason": "All providers failed",
        "errors": {
          "FMP": "429 Too Many Requests",
          "ALPACA": "Symbol not found",
          "IBKR": "secType mismatch"
        }
      }
    ],
    "internal_gaps": [
      {
        "symbol": "NVDA",
        "month": "2025-11",
        "tf": "1day",
        "gaps": ["2025-11-05", "2025-11-06"],
        "reason": "All providers returned empty for range",
        "note": "Likely market holiday — verify manually"
      },
      {
        "symbol": "AAPL",
        "month": "2026-01",
        "tf": "1day",
        "gaps": ["2026-01-09", "2026-01-10", "2026-01-13"],
        "reason": "FMP: 0 candles returned. ALPACA: timeout. IBKR: unavailable",
        "note": ""
      }
    ]
  }
}
```

---

## Tabella riepilogativa dei buchi non riempiti

Il report finale include una tabella markdown pronta per il display nel frontend:

```
| Simbolo | Mese    | Tipo          | Buchi / Motivo                    | Provider tentati       |
|---------|---------|---------------|-----------------------------------|------------------------|
| UTI     | 2025-10 | File mancante | Intero mese non scaricabile       | FMP, ALPACA, IBKR      |
| NVDA    | 2025-11 | Gap interno   | 05/11, 06/11 (possibile festivo)  | FMP, ALPACA, IBKR      |
| AAPL    | 2026-01 | Gap interno   | 09/01, 10/01, 13/01              | FMP (0 candele), ALPACA|
```

---

## Endpoint di supporto

### `GET /l2/heal/jobs`

Lista dei job heal attivi o recenti (ultimi 10).

### `DELETE /l2/heal/:jobId`

Cancella un job in esecuzione.

### `GET /l2/heal/:jobId/report.md`

Scarica il report in formato Markdown puro — utile per salvataggio o invio via alert.

---

## Integrazione con lo scheduler

Il job può essere schedulato automaticamente tramite il `scheduler` per girare ogni notte dopo il job EOD:

```
{
  "job_key": "cache_heal_nightly",
  "cron": "0 6 * * 1-5",
  "endpoint": "POST http://cachemanager:3006/l2/heal",
  "body": { "tf": "1day", "from_days_back": 60, "heal": true }
}
```

Il parametro `from_days_back` calcola automaticamente `from = oggi - N giorni` senza dover passare una data fissa.

---

## Priorità

Alta — questo endpoint risolve definitivamente il problema della diagnostica manuale: invece di dover eseguire `GET /l2/audit` + `POST /l2/clear` + attendere il prossimo job per ogni simbolo affetto, un singolo `POST /l2/heal` identifica e ripara tutto in modo automatico, con un report chiaro di cosa non è stato possibile correggere e perché.

---

# Sezioni aggiuntive dal brainstorming

Le sezioni seguenti provengono dal documento `cachemanager-miglioramenti-brainstorm (1).md` e integrano la pagina originale con proposte architetturali e operative ulteriori.

## 1. Gestione provider — routing basato su caratteristiche temporali

### 1.1 Caratteristiche dei provider disponibili

| Provider | Dati storici | Dati recenti | Limite chiamate | Recency limit | Note |
|----------|-------------|--------------|-----------------|---------------|------|
| **Alpaca** | ✅ Illimitato, preferito | ❌ Blocca SIP recenti | Nessuno (piano attuale) | Messaggio esplicito | Prima scelta per storico |
| **Polygon.io** | ✅ Fino a 2 anni fa | ✅ Fino a chiusura giorno precedente | Da verificare piano | T-1 (chiusura ieri) | Seconda scelta per storico recente e dati T-1 |
| **IBKR** | ✅ Da verificare per mercato | ✅ Da verificare per mercato | Nessuno noto | Da verificare | Dipende da secType e mercato |
| **FMP** | ✅ Disponibile | ✅ Disponibile | ⚠️ Limite req/min e req/mese | Nessuno | Ultima risorsa — preservare quota |

Con la logica attuale FMP viene usato per tutto, consumando quota anche per dati storici che Alpaca o Polygon coprirebbero gratuitamente o senza limiti significativi.

---

### 1.2 Routing strategy basata su date

```
Richiesta: symbol=NVDA, from=2024-01-01, to=2026-03-22

Segmentazione automatica del range:
│
├─ [2024-01-01 → limite Alpaca recency]
│    → Alpaca (preferito, illimitato per storico)
│    → Se Alpaca dà "subscription does not permit querying recent SIP data"
│      → scende al livello successivo per quel segmento
│
├─ [limite Alpaca recency → ieri (T-1)]
│    → Polygon.io (copre fino alla chiusura del giorno precedente, 2 anni di storia)
│    → Fallback: IBKR se disponibile per quel mercato/secType
│    → Fallback: FMP (consuma quota — ultimo resort)
│
└─ [oggi, intraday live]
     → IBKR se mercato supportato
     → FMP (consuma quota)
```

Per una richiesta di 200 giorni:
- **Alpaca** copre ~185 giorni gratis
- **Polygon** copre il gap recente (ultimi ~15 giorni fino a ieri)
- **FMP** viene chiamato solo per intraday live o se entrambi falliscono

Il consumo di quota FMP si riduce a quasi zero nelle operazioni di backfill e refresh giornaliero.

---

### 1.3 Nuovo modulo — `modules/polygon.js`

#### Endpoint Polygon.io

```
GET https://api.polygon.io/v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}
```

**Parametri:**

| Parametro | Tipo | Descrizione |
|-----------|------|-------------|
| `ticker` | string | Simbolo uppercase (es. `AAPL`) |
| `multiplier` | int | Moltiplicatore del timespan (es. `1` per daily) |
| `timespan` | string | `minute`, `hour`, `day`, `week`, `month` |
| `from` | string | Data inizio `YYYY-MM-DD` o timestamp ms |
| `to` | string | Data fine `YYYY-MM-DD` o timestamp ms |
| `adjusted` | boolean | `true` per prezzi split-adjusted (default) |
| `sort` | string | `asc` o `desc` |
| `limit` | int | Max aggregati per pagina (default 5000, max 50000) |
| `apiKey` | string | API key Polygon |

**Risposta:**

```json
{
  "ticker": "AAPL",
  "status": "OK",
  "queryCount": 252,
  "resultsCount": 252,
  "adjusted": true,
  "results": [
    {
      "v":  75088875,
      "vw": 149.5328,
      "o":  148.88,
      "c":  150.43,
      "h":  151.23,
      "l":  148.50,
      "t":  1680739200000,
      "n":  452345
    }
  ],
  "next_url": "https://api.polygon.io/v2/aggs/ticker/AAPL/range/..."
}
```

| Campo risposta | Descrizione |
|---------------|-------------|
| `t` | Timestamp Unix **millisecondi** (start della barra) |
| `o` | Open |
| `h` | High |
| `l` | Low |
| `c` | Close |
| `v` | Volume |
| `vw` | VWAP (volume weighted average price) |
| `n` | Numero di transazioni nell'intervallo |

**Paginazione:** Polygon restituisce `next_url` se i risultati sono troncati. Va gestita esattamente come Alpaca gestisce `next_page_token`.

#### Implementazione `modules/polygon.js`

```javascript
"use strict";

const axios = require("axios");

class PolygonProvider {
  /**
   * @param {object} options
   * @param {string} options.apiKey        POLYGON_API_KEY
   * @param {object} options.logger
   * @param {number} [options.timeout]     Timeout ms (default 15000)
   */
  constructor({ apiKey, logger, timeout = 15000 }) {
    this.apiKey   = apiKey;
    this.logger   = logger;
    this.timeout  = timeout;
    this.baseUrl  = "https://api.polygon.io";
  }

  _mapTimespan(tf) {
    const v = String(tf || "1day").toLowerCase();
    if (["1min", "1m"].includes(v))    return { multiplier: 1,  timespan: "minute" };
    if (["5min", "5m"].includes(v))    return { multiplier: 5,  timespan: "minute" };
    if (["15min", "15m"].includes(v))  return { multiplier: 15, timespan: "minute" };
    if (["30min", "30m"].includes(v))  return { multiplier: 30, timespan: "minute" };
    if (["1h", "1hour"].includes(v))   return { multiplier: 1,  timespan: "hour"   };
    if (["2h", "2hour"].includes(v))   return { multiplier: 2,  timespan: "hour"   };
    if (["4h", "4hour"].includes(v))   return { multiplier: 4,  timespan: "hour"   };
    if (["1day", "1d"].includes(v))    return { multiplier: 1,  timespan: "day"    };
    if (["1week", "1w"].includes(v))   return { multiplier: 1,  timespan: "week"   };
    if (["1month", "1mo"].includes(v)) return { multiplier: 1,  timespan: "month"  };
    return { multiplier: 1, timespan: "day" }; // default
  }

  _normalizeBar(raw, symbol, tf) {
    const ts = raw?.t;
    if (!Number.isFinite(ts)) return null;
    return {
      t:      new Date(ts).toISOString(),  // da ms a ISO UTC
      o:      raw.o,
      h:      raw.h,
      l:      raw.l,
      c:      raw.c,
      v:      raw.v ?? null,
      vw:     raw.vw ?? null,              // VWAP — campo aggiuntivo Polygon
      n:      raw.n ?? null,               // numero transazioni — campo aggiuntivo
      tf:     tf,
      symbol: symbol,
    };
  }

  /**
   * Verifica il limite di recency di Polygon:
   * disponibile fino alla chiusura del giorno precedente (T-1).
   * Non ha senso chiedere candele di oggi (mercato ancora aperto).
   */
  _clampEndDate(endDate) {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const end = String(endDate).slice(0, 10);
    if (end > yesterdayStr) {
      this.logger.info(
        `[PolygonProvider] endDate ${end} > T-1 (${yesterdayStr}), clamp a ${yesterdayStr}`
      );
      return yesterdayStr;
    }
    return end;
  }

  async fetchDailyBars({ symbol, start, end, timeframe = "1day" }) {
    const { multiplier, timespan } = this._mapTimespan(timeframe);
    const from    = String(start).slice(0, 10);
    const to      = this._clampEndDate(end);
    const allBars = [];

    // Polygon supporta fino a 2 anni di storia per il piano attuale
    const twoYearsAgo = new Date();
    twoYearsAgo.setUTCFullYear(twoYearsAgo.getUTCFullYear() - 2);
    const twoYearsAgoStr = twoYearsAgo.toISOString().slice(0, 10);
    if (from < twoYearsAgoStr) {
      this.logger.warning(
        `[PolygonProvider] from=${from} è oltre il limite di 2 anni (${twoYearsAgoStr}) ` +
        `— Polygon potrebbe non avere dati così vecchi`
      );
    }

    let url = `${this.baseUrl}/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
              `/range/${multiplier}/${timespan}/${from}/${to}` +
              `?adjusted=true&sort=asc&limit=50000&apiKey=${this.apiKey}`;

    // Gestione paginazione via next_url
    while (url) {
      this.logger.info(`[PolygonProvider] Fetch ${symbol} ${from}→${to} tf=${timeframe}: ${url.replace(this.apiKey, "***")}`);

      let res;
      try {
        res = await axios.get(url, { timeout: this.timeout });
      } catch (err) {
        const status  = err.response?.status;
        const errBody = err.response?.data || {};
        const errMsg  = errBody?.error || errBody?.message || err.message;

        this.logger.error(
          `[PolygonProvider] Error fetching bars for ${symbol} ${from}→${to}: ` +
          `${status ? status + " " : ""}${errMsg}`
        );
        throw new Error(`[POLYGON ERROR] ${symbol} ${from}→${to}: ${errMsg}`);
      }

      const data = res.data || {};

      // Polygon ritorna status "ERROR" nel body anche con HTTP 200
      if (data.status === "ERROR" || data.status === "NOT_AUTHORIZED") {
        const errMsg = data.error || data.message || data.status;
        this.logger.error(`[PolygonProvider] API error per ${symbol}: ${errMsg}`);
        throw new Error(`[POLYGON API ERROR] ${symbol}: ${errMsg}`);
      }

      const bars = Array.isArray(data.results) ? data.results : [];
      allBars.push(...bars);

      // Paginazione: next_url include già apiKey e tutti i parametri
      url = data.next_url ? `${data.next_url}&apiKey=${this.apiKey}` : null;
    }

    const normalized = allBars
      .map((row) => this._normalizeBar(row, symbol, timeframe))
      .filter(Boolean);

    this.logger.log(
      `[PolygonProvider] Fetched ${allBars.length} raw bars ` +
      `(${normalized.length} normalized) for ${symbol} ${from}→${to}`
    );

    return normalized;
  }
}

function createPolygonFromEnv(logger) {
  return new PolygonProvider({
    apiKey:  process.env.POLYGON_API_KEY,
    logger,
    timeout: parseInt(process.env.POLYGON_TIMEOUT || "15000", 10),
  });
}

module.exports = { PolygonProvider, createPolygonFromEnv };
```

---

### 1.4 Integrazione in `main.js`

#### Costruttore — aggiungere Polygon

```javascript
// In constructor di CacheManager, accanto a Alpaca e FMP:
const hasPolygonKey = Boolean(process.env.POLYGON_API_KEY);

if (hasPolygonKey) {
  this.polygon = new PolygonProvider({
    apiKey:  process.env.POLYGON_API_KEY,
    logger:  this.logger,
    timeout: parseInt(process.env.POLYGON_TIMEOUT || "15000", 10),
  });
  this.logger.info("[CacheManager] Provider storico: POLYGON disponibile");
} else {
  this.logger.warning("[CacheManager] POLYGON_API_KEY mancante: Polygon non disponibile");
}
```

#### `_retrieveFromProvider` — routing temporale con Polygon

```javascript
async _retrieveFromProvider(symbol, startDate, endDate, tf, exchange) {

  // -------------------------------------------------------
  // Routing temporale:
  // 1. Alpaca per storico (fino al suo limite di recency)
  // 2. Polygon per il gap recente (fino a T-1)
  // 3. IBKR per intraday/live dove disponibile
  // 4. FMP come ultima risorsa (preservare quota)
  // -------------------------------------------------------

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const endStr   = String(endDate).slice(0, 10);
  const startStr = String(startDate).slice(0, 10);

  // Override manuale: se specificato, usa quel provider per tutto il range
  if (this.providerType !== "AUTO") {
    return await this._fetchFromProvider(this.providerType, symbol, startDate, endDate, tf, exchange);
  }

  // Routing automatico basato su date
  const allCandles = [];

  // Segmento 1: storico — prova Alpaca
  try {
    const alpacaBars = await this._fetchFromProvider("ALPACA", symbol, startDate, endDate, tf, exchange);
    allCandles.push(...alpacaBars);
    this.logger.info(`[L1] ALPACA: ${alpacaBars.length} candele per ${symbol}`);
    return allCandles; // Alpaca ha coperto tutto il range
  } catch (err) {
    if (err instanceof AlpacaRecencyError) {
      // Alpaca copre solo la parte storica — gestisci il segmento recente separatamente
      this.logger.info(
        `[L1] ALPACA recency limit per ${symbol}: ` +
        `"subscription does not permit querying recent SIP data" ` +
        `→ routing segmento recente a POLYGON/IBKR/FMP`
      );

      // Tenta di ottenere la parte storica che Alpaca copre (potrebbe averne alcune)
      // Al momento del catch non sappiamo esattamente il cutoff, quindi
      // proviamo Polygon per l'intero range come fallback immediato

    } else {
      this.logger.warning(`[L1] ALPACA fallito per ${symbol}: ${err.message}`);
    }
  }

  // Segmento 2: storico recente — Polygon (fino a T-1)
  if (this.polygon && endStr <= yesterdayStr) {
    try {
      const polygonBars = await this._fetchFromProvider("POLYGON", symbol, startDate, endDate, tf, exchange);
      this.logger.info(`[L1] POLYGON: ${polygonBars.length} candele per ${symbol}`);
      return polygonBars;
    } catch (err) {
      this.logger.warning(`[L1] POLYGON fallito per ${symbol}: ${err.message}, provo IBKR`);
    }
  }

  // Segmento 3: IBKR
  try {
    const ibkrBars = await this._fetchFromProvider("IBKR", symbol, startDate, endDate, tf, exchange);
    this.logger.info(`[L1] IBKR: ${ibkrBars.length} candele per ${symbol}`);
    return ibkrBars;
  } catch (err) {
    this.logger.warning(`[L1] IBKR fallito per ${symbol}: ${err.message}, provo FMP`);
  }

  // Segmento 4: FMP — ultima risorsa
  this.logger.warning(`[L1] Tutti i provider prioritari falliti per ${symbol}, uso FMP (consuma quota)`);
  return await this._fetchFromProvider("FMP", symbol, startDate, endDate, tf, exchange);
}
```

#### `_fetchFromProvider` — aggiungere case POLYGON

```javascript
case "POLYGON": {
  if (!this.polygon) {
    throw new Error("Polygon provider non inizializzato (POLYGON_API_KEY mancante)");
  }
  const bars = await this.polygon.fetchDailyBars({
    symbol,
    start: startDate,
    end:   endDate,
    timeframe: tf,
  });
  const tagged = tagBars(bars, "POLYGON", fallbackFrom);
  this.L1Hit = (this.L1Hit || 0) + 1;
  this.lastProviderCall = new Date().toISOString();
  this.logger.info(`[L1][POLYGON] Restituite ${bars.length} candele per ${symbol}`);
  return tagged;
}
```

---

### 1.5 Variabili d'ambiente da aggiungere

```env
# Polygon.io
POLYGON_API_KEY=your_polygon_api_key_here
POLYGON_TIMEOUT=15000

# Provider routing
# AUTO = routing automatico basato su date (default)
# ALPACA / POLYGON / FMP / IBKR = forza provider specifico
HISTORICAL_PROVIDER=AUTO
```

---

### 1.6 Messaggio di errore Alpaca sulla recency — testo esatto

Alpaca restituisce questo formato quando i dati richiesti sono troppo recenti:

```
Error fetching bars from https://data.alpaca.markets/...
```

Con il seguente dettaglio nel body JSON:

```json
{
  "message": "subscription does not permit querying recent SIP data"
}
```

> **Nota implementativa:** il match va fatto su `err.response?.data?.message`, **non** su `err.message` (che contiene il wrapper `"Error fetching bars from ..."`).  
> La stringa esatta è: `"subscription does not permit querying recent SIP data"`.

```javascript
class AlpacaRecencyError extends Error {
  constructor(message, context) {
    super(message);
    this.name = "AlpacaRecencyError";
    this.context = context;
  }
}

// Nel catch di fetchDailyBars in alpaca.js:
const errMsg = err.response?.data?.message || "";
if (errMsg.includes("subscription does not permit querying recent SIP data")) {
  throw new AlpacaRecencyError(
    "Alpaca: subscription does not permit querying recent SIP data",
    { symbol, start, end, suggestProvider: "POLYGON_OR_FMP" }
  );
}
```

`AlpacaRecencyError` **non penalizza** lo score del provider — è comportamento atteso del piano, non un malfunzionamento.

---

### 1.7 Parametro provider esplicito (override manuale)

| Valore `HISTORICAL_PROVIDER` | Comportamento |
|------------------------------|--------------|
| `AUTO` (default) | Routing automatico basato su date |
| `ALPACA` | Forza Alpaca per tutto il range |
| `POLYGON` | Forza Polygon per tutto il range |
| `FMP` | Forza FMP per tutto il range |
| `IBKR` | Forza IBKR |

Passabile anche come query param: `GET /candles?symbol=NVDA&...&provider=POLYGON`

---

### 1.8 Circuit breaker e provider scoring

Score affidabilità in Redis per ogni provider (incluso Polygon):

```javascript
// Su successo: +2 (max 100)
// Su errore API (status ERROR/NOT_AUTHORIZED): -30
// Su errore generico: -10
// AlpacaRecencyError: nessuna penalizzazione
// Polygon date clamp (richiesta > T-1): nessuna penalizzazione — comportamento atteso
```

Circuit breaker: score < 20 → provider "open" per 15 minuti, saltato senza tentare la chiamata.

---

### 1.9 Rate limiting preventivo per FMP

Token bucket Redis condiviso (max 250 token/min, refill 4/sec) + contatore mensile. Polygon e Alpaca non richiedono rate limiting lato client per i piani attuali.

---

## 2. Formato canonico delle candele e tracciabilità provider

### 2.1 Formato canonico unico

```json
{
  "t":                      "2025-10-15T00:00:00.000Z",
  "o":                      134.20,
  "h":                      136.50,
  "l":                      133.80,
  "c":                      135.90,
  "v":                      12450000,
  "vw":                     135.12,
  "n":                      452345,
  "tf":                     "1day",
  "symbol":                 "NVDA",
  "provider":               "POLYGON",
  "provider_fallback":      false,
  "provider_fallback_from": null,
  "provider_fallback_reason": null,
  "adj":                    true
}
```

| Campo | Tipo | Fonte | Descrizione |
|-------|------|-------|-------------|
| `t` | ISO 8601 UTC | Tutti | Timestamp — sempre UTC, mai date-only |
| `o`, `h`, `l`, `c` | number | Tutti | OHLC |
| `v` | number \| null | Tutti | Volume |
| `vw` | number \| null | **Polygon** | VWAP — disponibile solo da Polygon, null per altri provider |
| `n` | number \| null | **Polygon** | Numero transazioni — disponibile solo da Polygon, null per altri |
| `tf` | string | Tutti | Timeframe normalizzato |
| `symbol` | string | Tutti | Ticker uppercase |
| `provider` | string | Tutti | `ALPACA`, `POLYGON`, `FMP`, `IBKR` |
| `provider_fallback` | boolean | Tutti | `true` se provider di fallback |
| `provider_fallback_from` | string \| null | Tutti | Provider che ha fallito prima |
| `provider_fallback_reason` | string \| null | Tutti | `ALPACA_RECENCY`, `RATE_LIMIT`, `ERROR`, `POLYGON_RECENCY` |
| `adj` | boolean | Tutti | `true` se split-adjusted |

I campi `vw` e `n` sono bonus esclusivi di Polygon — arricchiscono i dati senza rompere la compatibilità con i consumatori che non li usano.

### 2.2 Normalizzatore universale

```javascript
_normalizeCandle(raw, symbol, tf, provider, fallbackFrom = null, fallbackReason = null) {
  const ts = this._toTimestampMs(raw?.t ?? raw?.timestamp ?? raw?.time ?? raw?.date);
  if (!Number.isFinite(ts)) return null;
  return {
    t:                        new Date(ts).toISOString(),
    o:                        raw.o ?? raw.open  ?? null,
    h:                        raw.h ?? raw.high  ?? null,
    l:                        raw.l ?? raw.low   ?? null,
    c:                        raw.c ?? raw.close ?? null,
    v:                        raw.v ?? raw.volume ?? null,
    vw:                       raw.vw ?? null,           // solo Polygon
    n:                        raw.n  ?? null,            // solo Polygon
    tf,
    symbol,
    provider,
    provider_fallback:        fallbackFrom !== null,
    provider_fallback_from:   fallbackFrom,
    provider_fallback_reason: fallbackReason,
    adj:                      raw.adj ?? true,
  };
}
```

---

## 3. Qualità dei dati — Endpoint unificato e score 0-100

### 3.1 Endpoint `POST /l2/inspect`

Sostituisce e generalizza `GET /l2/audit` e `POST /l2/heal`.

| Parametro | Valori | Default | Descrizione |
|-----------|--------|---------|-------------|
| `mode` | `report`, `heal` | `report` | Solo analisi o analisi + riparazione |
| `symbol` | string | — | Simbolo specifico o tutti |
| `tf` | string | `1day` | Timeframe |
| `from` | YYYY-MM-DD | 12 mesi fa | Inizio range |
| `to` | YYYY-MM-DD | oggi | Fine range |
| `dry_run` | boolean | `false` | Simula senza scrivere |
| `save_to_db` | boolean | `true` | Salva in `cache_quality_scores` |
| `min_quality` | number | — | Ripara solo simboli sotto questa soglia |

---

### 3.2 Calcolo dello score di qualità (0-100)

```
quality_score =
  completeness × 0.40  +
  gap_score     × 0.30  +
  validity      × 0.20  +
  freshness     × 0.10
```

#### Completeness
```
(mesi_presenti_non_vuoti / mesi_attesi) × 100
```

#### Gap score
```
(giorni_con_candela / giorni_mercato_aperti_attesi) × 100
```
Weekend e festivi NYSE (o exchange del simbolo) esclusi dal denominatore.

#### Validity score
Per ogni candela:

| Check | Peso |
|-------|------|
| `high >= max(open, close)` | 20% |
| `low <= min(open, close)` | 20% |
| `volume > 0` (se equity liquido) | 20% |
| Nessuno spike > 20% vs candela precedente | 20% |
| Timestamp è giorno di mercato aperto | 20% |

#### Freshness score

| Condizione | Score |
|-----------|-------|
| Mese corrente aggiornato nelle ultime 12h | 100 |
| Aggiornato nelle ultime 24h | 70 |
| Aggiornato nelle ultime 48h | 40 |
| Non aggiornato o assente | 0 |

---

### 3.3 Score aggregati e persistenza DB

```sql
CREATE TABLE cache_quality_scores (
  id                      BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id                  VARCHAR(40) NOT NULL,
  symbol                  VARCHAR(20) NOT NULL,
  tf                      VARCHAR(10) NOT NULL,
  check_date              DATE NOT NULL,
  range_from              DATE,
  range_to                DATE,
  quality_score           DECIMAL(5,2),
  completeness            DECIMAL(5,2),
  gap_score               DECIMAL(5,2),
  validity                DECIMAL(5,2),
  freshness               DECIMAL(5,2),
  quality_score_post_heal DECIMAL(5,2),
  months_checked          INT,
  months_ok               INT,
  months_empty            INT,
  months_missing          INT,
  trading_days_expected   INT,
  trading_days_present    INT,
  gaps_found              INT,
  gaps_healed             INT DEFAULT 0,
  gaps_unhealed           INT DEFAULT 0,
  invalid_candles         INT,
  candles_added           INT DEFAULT 0,
  healed                  TINYINT DEFAULT 0,
  details_json            JSON,
  created_at              DATETIME DEFAULT NOW(),
  INDEX idx_symbol_date (symbol, check_date),
  INDEX idx_run         (run_id),
  INDEX idx_quality     (quality_score)
);

CREATE TABLE cache_quality_runs (
  run_id              VARCHAR(40) PRIMARY KEY,
  mode                VARCHAR(10),
  started_at          DATETIME,
  finished_at         DATETIME,
  symbols_checked     INT,
  system_score        DECIMAL(5,2),
  universe_score      DECIMAL(5,2),
  symbols_below_50    INT,
  symbols_below_80    INT,
  total_gaps_found    INT,
  total_gaps_healed   INT,
  total_candles_added INT,
  params_json         JSON,
  status              VARCHAR(20)
);
```

Alert automatico se `universe_score` scende sotto `CACHE_QUALITY_ALERT_THRESHOLD` (default 75):

```json
{
  "eventId": "CACHE.QUALITY.DEGRADED",
  "severity": "warning",
  "payload": {
    "universeScore": 68.4,
    "threshold": 75,
    "symbolsBelowCritical": ["UTI", "AAPL", "MSFT"],
    "runId": "inspect_2026-03-22_nightly"
  }
}
```

---

### 3.4 Healing con routing temporale

Quando `mode=heal`, la riparazione usa il routing provider temporale (sezione 1.2):
- **File mancanti/vuoti** → download completo (Alpaca storico → Polygon recente → IBKR → FMP)
- **Gap interni** → download range ristretto (giorni mancanti ±1 buffer) con stesso routing
- **Candele invalide** → ri-fetch giorno specifico per distinguere errore provider da anomalia mercato

`quality_score_post_heal` viene ricalcolato e salvato per confronto.

---

## 4. Performance

### 4.1 Preloading notturno

```json
{
  "job_key": "cache_daily_preload",
  "cron": "0 23 * * 1-5",
  "endpoint": "POST http://cachemanager:3006/l2/preload",
  "body": { "tf": "1day", "date": "today", "symbols": "universe" }
}
```

Con il routing automatico, il preload giornaliero usa Polygon (T-1) invece di FMP — zero consumo quota FMP.

### 4.2 In-memory LRU cache

```javascript
const fileCache = new LRU({
  max: 500,
  maxSize: 50 * 1024 * 1024,   // 50MB
  sizeCalculation: (v) => Buffer.byteLength(JSON.stringify(v)),
  ttl: 1000 * 60 * 30,
});
// ~100 simboli × 7 mesi × 22KB ≈ 15MB
```

### 4.3 Download parallelo mesi mancanti

```javascript
await runConcurrent(missingMonths, (monthKey) => download(monthKey), 3);
```

---

## 5. Gestione casi limite

**IPO recente:** `universe.ipo_date` da FMP → quality check parte da quella data.  
**Delisted:** `universe.delisted_date` → nessun download/gap oltre quella data.  
**Split azionari:** rilevamento via FMP `/stable/stock-split-calendar` → invalidazione L2 e re-download.  
**Exchange non-NYSE:** modulo `TradingCalendar` per calcolo `trading_days_expected` per-exchange — rilevante per ETF/futures su LSE, CME etc.  
**Polygon limite 2 anni:** se `startDate` è oltre 2 anni fa, Polygon potrebbe non avere dati — il routing ricade su Alpaca (che non ha questo limite).

---

## 6. Ordine di implementazione consigliato

| # | Cosa | Stima | Priorità | Dipendenze |
|---|------|-------|----------|------------|
| 1 | Fix bug esistenti (FMP 200, file vuoti, date UTC, logging) | 2h | 🔴 Critica | Nessuna |
| 2 | `modules/polygon.js` + integrazione in `main.js` costruttore | 2h | 🔴 Alta | Fix 1 |
| 3 | Formato canonico + `provider_fallback_reason` + normalizzatore unico | 1h | 🔴 Alta | Fix 2 |
| 4 | `AlpacaRecencyError` match messaggio esatto | 1h | 🟠 Alta | Nessuna |
| 5 | Routing temporale AUTO in `_retrieveFromProvider` | 3h | 🟠 Alta | Fix 2,4 |
| 6 | Token bucket Redis FMP + contatore mensile | 2h | 🟠 Alta | Nessuna |
| 7 | Circuit breaker + scoring provider | 2h | 🟡 Media | Fix 4,5 |
| 8 | `POST /l2/inspect` con quality score 0-100 | 4h | 🟡 Media | Fix 1,3 |
| 9 | Tabelle DB `cache_quality_scores` + `cache_quality_runs` | 2h | 🟡 Media | Fix 8 |
| 10 | Healing integrato nell'inspect + routing temporale | 3h | 🟡 Media | Fix 5,8 |
| 11 | Alert su degradazione qualità | 1h | 🟡 Media | Fix 9 |
| 12 | Preloading notturno (`POST /l2/preload`) | 2h | 🟢 Bassa | Fix 5 |
| 13 | In-memory LRU cache file mensili | 1h | 🟢 Bassa | Nessuna |
| 14 | Gestione IPO, delisting, split, calendario exchange | 3h | 🟢 Bassa | Fix 8 |

**Totale stimato passi 1–11:** ~23h  
**Nessun breaking change sull'API** per i passi 1–6.

---

## 7. Nuovi endpoint — riepilogo

| Endpoint | Metodo | Descrizione |
|----------|--------|-------------|
| `/l2/inspect` | POST | Analisi qualità + healing opzionale |
| `/l2/inspect/:jobId` | GET | Stato e risultato job |
| `/l2/inspect/jobs` | GET | Lista job recenti |
| `/l2/inspect/:jobId/report.md` | GET | Report Markdown scaricabile |
| `/l2/preload` | POST | Pre-scarica candele del giorno per universo |
| `/l2/quality/summary` | GET | Score qualità corrente tutti i simboli |
| `/l2/quality/:symbol` | GET | Storico score qualità per simbolo |
| `/provider/status` | GET | Score affidabilità provider + contatore FMP mensile |

---

## 8. Note implementative chiave

- **Match Alpaca recency:** `err.response?.data?.message` (non `err.message`). Stringa esatta: `"subscription does not permit querying recent SIP data"`
- **`AlpacaRecencyError`** non penalizza lo score del provider
- **Polygon limit date:** `endDate` viene clampato a T-1 automaticamente in `PolygonProvider._clampEndDate()` — nessun errore lato client
- **Polygon paginazione:** gestita via `next_url` nel body della risposta (non header) — aggiungere `&apiKey=` alla next_url
- **Polygon `vw` e `n`:** campi bonus salvati nelle candele quando il provider è Polygon — ignorati dai consumatori che non li conoscono
- **Quality score mese corrente:** `range_to = today` sempre — i giorni futuri non sono buchi
- **`HISTORICAL_PROVIDER=AUTO`:** nuovo valore default che attiva il routing temporale. I valori esistenti `FMP`, `ALPACA`, `IBKR` continuano a funzionare come override esplicito

---

*Documento da importare nella pagina roadmap `cachemanager-bug-mese-corrente` come nuovi paragrafi quando il server è stabile.*
