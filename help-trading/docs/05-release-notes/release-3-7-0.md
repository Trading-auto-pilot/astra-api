---
sidebar_position: 1
title: Release 3.7.0 - 29/03/2026
---

# Release 3.7.0

- Data rilascio globale: `29/03/2026`
- Versione globale (frontend): da aggiornare
- Fonte: `astraai/public/release.json`

## Riepilogo versioni componenti backend

| Componente | Versione | Data rilascio | Nota principale |
| --- | --- | --- | --- |
| `cacheManager` | `2.6.0` | `29/03/2026` | Nuovo provider Polygon.io + routing temporale AUTO + `AlpacaRecencyError` |
| `cacheManager` | `2.7.0` | `29/03/2026` | Token bucket Redis FMP (250 tok/min) + circuit breaker + scoring provider |
| `cacheManager` | `2.8.0` | `29/03/2026` | Endpoint `POST /l2/heal` + fix scrittura file vuoti + UI L2-hygiene heal |
| `cacheManager` | `2.9.0` | `29/03/2026` | Endpoint `POST /l2/heal/scan` (full scan cache) + progress real-time Redis Bus + cancellazione job |
| `cacheManager` | `2.10.0` | `29/03/2026` | Fix `details_json` con gap per data + persistenza `cache_quality_runs` / `cache_quality_scores` + UI qualità L2 |

## Modifiche di dettaglio per componente

### cacheManager

- Versione: `2.7.0`
- Data rilascio: `29/03/2026`

#### v2.5.1 — Bug fix qualità dati

**1. Normalizzazione date-only strings a UTC ISO (`getCandles`)**

Le date passate come stringa senza orario (es. `"2026-03-20"`) venivano interpretate con la timezone locale del server. Su server in UTC+ (es. Dubai UTC+4), `new Date("2026-03-20")` produceva `2026-03-19T20:00:00Z`, escludendo silenziosamente tutte le candele del giorno 20 dal risultato filtrato.

Ora all'ingresso di `getCandles`, le date-only strings vengono normalizzate esplicitamente a `"YYYY-MM-DDT00:00:00.000Z"` prima di qualsiasi operazione, garantendo comportamento coerente indipendentemente dalla timezone del server.

**2. Warning esplicito su file mensile con array vuoto (`_readL2ByMonthKeys`)**

Quando un file mensile L2 conteneva un array vuoto `[]` (causato ad esempio da rate limit silenzioso su FMP), la lettura ignorava il mese senza alcuna segnalazione nei log. Il risultato totale diminuiva silenziosamente, causando calcoli SMA_200 o ATR_20 incompleti senza errori visibili.

Ora `_readL2ByMonthKeys` logga un warning esplicito ogni volta che un file mensile è presente ma vuoto, rendendo il problema rilevabile nei log.

> Nota: il problema a monte (file vuoto scritto dopo rate limit FMP) era già stato corretto nelle versioni precedenti (`_writeL2MonthFile` e `_isL2MonthFileValid`). Questo fix aggiunge una difesa in profondità nel layer di lettura.

**3. Warning candele restituite sotto soglia (`getCandles`)**

Quando `getCandles` restituisce meno di 200 candele per timeframe `1day`, viene ora emesso un warning esplicito con un hint all'endpoint di diagnostica:

```
[getCandles] NVDA: restituite solo 123 candele daily — verifica file L2 con GET /l2/audit?symbol=NVDA
```

Questo rende visibile il problema nei log prima che raggiunga il decision-engine, dove compariva solo come `SMA_200 non calcolabile`.

---

#### v2.6.0 — Provider Polygon.io e routing temporale AUTO

**4. Nuovo provider `modules/polygon.js`**

Integrazione completa con Polygon.io Aggregates API (`/v2/aggs`). Il provider gestisce:
- Mapping timeframe interno → `multiplier/timespan` Polygon
- Paginazione via `next_url` nel body della risposta
- Clamp automatico dell'`endDate` a T-1 (Polygon non ha dati intraday live)
- Avviso se il range richiesto supera il limite di 2 anni del piano
- Campi bonus `vw` (VWAP) e `n` (numero transazioni) salvati nella candela normalizzata

**5. `AlpacaRecencyError` — errore tipato per il recency limit**

Alpaca risponde con `"subscription does not permit querying recent SIP data"` quando i dati richiesti sono troppo recenti per il piano sottoscritto. Questo errore viene ora rilevato sul campo `err.response?.data?.message` e rilanciato come `AlpacaRecencyError` (classe dedicata), distinguendolo da un vero malfunzionamento. Non viene loggato come errore né penalizza il provider.

**6. Routing temporale `AUTO` (nuovo default di `HISTORICAL_PROVIDER`)**

Attivato da `HISTORICAL_PROVIDER=AUTO` (ora valore di default). La catena di fallback è:

```
1. Alpaca     → storico illimitato, nessuna quota
2. Polygon    → storico recente fino a T-1 (se Alpaca lancia AlpacaRecencyError o fallisce)
3. IBKR       → dove disponibile per il mercato
4. FMP        → ultima risorsa (consuma quota mensile)
```

I valori `FMP`, `ALPACA`, `POLYGON`, `IBKR` continuano a funzionare come override esplicito (bypass del routing automatico).

**Variabile d'ambiente da aggiungere all'`.env`:**
```env
POLYGON_API_KEY=your_polygon_api_key_here
POLYGON_TIMEOUT=15000
# HISTORICAL_PROVIDER=AUTO  ← è ora il default, non serve specificarlo
```

---

#### v2.7.0 — Token bucket FMP e circuit breaker provider

**7. Token bucket Redis per FMP (`modules/fmpRateLimiter.js`)**

Rate limiting preventivo condiviso tra tutte le istanze cacheManager via Redis. Prima di ogni chiamata FMP, un Lua script atomico verifica e consuma 1 token dal bucket:

- Capacità massima: **250 token**
- Refill rate: **4 token/sec** (conservativo rispetto al limite API di 250/min)
- Se il bucket è esaurito la chiamata viene rifiutata immediatamente con errore `[FMP_RATE_LIMIT]` e il routing AUTO passa ai fallback senza penalizzare lo score FMP
- Contatore mensile in Redis (`fmp:monthly:YYYY-MM`) traccia il numero di chiamate FMP nel mese corrente
- Fail-open: se Redis non è disponibile il rate limit viene bypassato senza bloccare l'operazione

**8. Circuit breaker + scoring affidabilità provider (`modules/providerScoring.js`)**

Score di affidabilità per ogni provider (ALPACA, POLYGON, FMP, IBKR) persistito in Redis:

| Evento | Variazione score |
| --- | --- |
| Chiamata riuscita | +2 (max 100) |
| Errore API esplicito (`[API ERROR]`, `[POLYGON API ERROR]`) | −30 |
| Errore generico (timeout, rete, parsing) | −10 |
| `AlpacaRecencyError` | nessuna penalità (comportamento atteso del piano) |
| `[CB_OPEN]` o `[FMP_RATE_LIMIT]` | nessuna penalità |

Circuit breaker: quando lo **score scende sotto 20**, il provider viene marcato come "open" in Redis con TTL di **15 minuti**. Durante quel periodo ogni chiamata a quel provider viene saltata immediatamente (senza effettuare la richiesta HTTP), consentendo al routing AUTO di passare al provider successivo.

**9. Nuovo endpoint `GET /provider/status`**

Espone in tempo reale lo stato di tutti i provider e del bucket FMP:

```json
{
  "ok": true,
  "data": {
    "providers": {
      "ALPACA":  { "score": 98, "cbOpen": false },
      "POLYGON": { "score": 100, "cbOpen": false },
      "FMP":     { "score": 40, "cbOpen": false },
      "IBKR":    { "score": 70, "cbOpen": false }
    },
    "fmpBucket": {
      "tokens": 187,
      "maxTokens": 250,
      "refillRatePerSec": 4,
      "monthlyCallCount": 312
    }
  }
}
```

---

---

#### v2.8.0 — Endpoint `/l2/heal` e fix scrittura file vuoti

**10. Fix `main.js`: non scrivere file mensili con 0 candele**

In `getCandles`, dopo il fetch dal provider, viene ora controllato `monthCandles.length` prima di scrivere il file mensile. Se il provider restituisce 0 candele, il file non viene scritto e viene emesso un `error` nel log:

```
[getCandles] Provider ha restituito 0 candele per SYMBOL YYYY-MM — file non scritto
```

Questo previene il bug in cui un file vuoto `[]` veniva scritto a causa di un rate limit silenzioso FMP, bloccando ogni successivo aggiornamento per quel mese (il file "esisteva" e veniva considerato completo).

**11. Nuovo endpoint `POST /l2/heal` — ispezione e riparazione automatica cache L2**

Avvia un job asincrono che ispeziona la cache L2 e tenta di riparare automaticamente:

- **File mancanti**: mesi attesi nel range `from`→`to` per i quali non esiste il file JSON → scarica l'intero mese dal provider
- **Gap interni**: giorni di mercato NYSE (lun-ven esclusi festivi) presenti nel file ma senza candele → scarica il range mancante e fa merge con le candele esistenti

Query params / body:

| Parametro | Default | Descrizione |
| --- | --- | --- |
| `symbol` | — | Se specificato, opera solo su quel simbolo |
| `tf` | `1day` | Timeframe da controllare |
| `from_days_back` | `365` | Calcola `from = oggi - N giorni` |
| `from` / `to` | — | Range esplicito alternativo a `from_days_back` |
| `heal` | `true` | Se `false`, solo report senza riparare |
| `dry_run` | `false` | Se `true`, simula senza scrivere nulla |

Risposta immediata (job asincrono):

```json
{ "ok": true, "jobId": "heal_1234567890_abc123", "status": "running", "startedAt": "..." }
```

Endpoint correlati:

| Endpoint | Descrizione |
| --- | --- |
| `GET /l2/heal/jobs` | Lista ultimi 10 job |
| `GET /l2/heal/:jobId` | Stato + risultato completo + summary |
| `DELETE /l2/heal/:jobId` | Cancella/termina job |
| `GET /l2/heal/:jobId/report.md` | Scarica report in formato Markdown |

**12. Frontend — sezione Heal nel tab L2-hygiene**

Il tab `L2-hygiene` in `#/admin/microservice/cachemanager` include ora una sezione **Cache Heal** con:
- Form parametri: symbol, timeframe, giorni indietro, dry run
- Pulsante **Run Heal** → `POST /l2/heal`
- Lista job recenti con stato, summary (symbols, file, gap, candele aggiunte) e polling automatico ogni 3s per i job in esecuzione
- Link diretto per scaricare il report Markdown di ogni job completato

---

#### v2.9.0 — Full scan cache + progress real-time + cancellazione job

**13. Nuovo endpoint `POST /l2/heal/scan` — full scan di tutti i TF/symbol presenti in cache**

Avvia un job asincrono che scopre automaticamente tutti i timeframe e i simboli presenti nella cache L2 (directory scan) ed esegue `heal` su ciascuna combinazione, senza richiedere la lista dei simboli in input.

Body params:

| Parametro | Default | Descrizione |
| --- | --- | --- |
| `heal` | `true` | Se `false`, solo report senza riparare |
| `dry_run` | `false` | Se `true`, simula senza scrivere nulla |
| `days_back_per_tf` | vedi sotto | Oggetto `{ "1day": 365, "1h": 60, … }` — override dei giorni indietro per TF |

Valori default di `days_back_per_tf`:

| TF | Giorni |
| --- | --- |
| `1day` | 365 |
| `1week` / `1month` | 730 |
| `4h` / `2h` | 90 |
| `1h` | 60 |
| `30min` / `15min` | 30 |
| `5min` | 14 |
| `1min` | 7 |

Al termine calcola e restituisce:
- **System score**: media pesata per `trading_days_expected` su tutti i symbol/TF
- **Universe score**: media semplice degli score post-heal
- Persiste i risultati nelle tabelle `cache_quality_runs` e `cache_quality_scores` via datahub

**14. Progress tracking real-time via Redis Bus (`modules/heal.js`)**

Durante l'esecuzione di `POST /l2/heal` e `POST /l2/heal/scan`, il runner pubblica aggiornamenti di avanzamento sul canale Redis `${ENV}.cachemanager.events` dopo ogni simbolo elaborato:

```json
{ "type": "heal_progress", "jobId": "heal_...", "done": 45, "total": 239, "currentSymbol": "AAPL", "tf": "1day", "pct": 18, "eta_seconds": 412 }
```

Al termine del job viene pubblicato un evento di completamento:

```json
{ "type": "heal_complete", "jobId": "heal_...", "status": "completed", "finishedAt": "..." }
```

I messaggi transitano via **Redis WS Bridge** e raggiungono il frontend senza polling aggiuntivo.

**15. Cancellazione job in esecuzione (`DELETE /l2/heal/:jobId`)**

L'endpoint `DELETE /l2/heal/:jobId` (già esistente) ora interrompe effettivamente il runner in esecuzione tramite un flag `aborted` controllato ad ogni iterazione del loop simboli. Il job si ferma al termine dell'elaborazione del simbolo corrente (non mid-fetch) e salva il risultato parziale con `status: "cancelled"`.

---

#### v2.10.0 — Fix `details_json` + persistenza qualità + UI qualità L2

**16. Fix `toScoreRow`: inclusione dettaglio gap in `details_json`**

La funzione `toScoreRow` (che costruisce il payload per `cache_quality_scores`) non includeva `m.details`, quindi il campo `details_json` in tabella conteneva solo le metriche aggregate ma non l'elenco dei giorni mancanti per mese.

Ora `details_json` include:

```json
{
  "details": {
    "missing_months": ["2024-11", "2024-12"],
    "gap_months": [
      { "month": "2025-01", "gaps": ["2025-01-15", "2025-01-20"] },
      { "month": "2025-03", "gaps": ["2025-03-04"] }
    ]
  }
}
```

**17. Frontend — progress bar e pulsante Stop nel tab L2-hygiene**

La card di ogni job in esecuzione mostra ora:
- **Progress bar** blu con transizione CSS che avanza simbolo per simbolo
- **Simbolo corrente** e TF in elaborazione
- **Contatore** `done/total` e **ETA** calcolata in base al tempo medio per simbolo
- **Pulsante Stop** (icona rossa) che invia `DELETE /l2/heal/:jobId` e interrompe il runner

I dati di avanzamento arrivano via **WebSocket** (Redis Bus Bridge) senza polling aggiuntivo; il polling a 3s rimane attivo solo per rilevare la transizione finale `running → completed/cancelled` e caricare scores e summary.

**18. Frontend — sezione Full Scan nel tab L2-hygiene**

Aggiunta sezione **Full Scan** sotto la sezione Heal con:
- Input giorni indietro per ciascun TF (modificabili singolarmente)
- Checkbox dry run
- Pulsante **Run Full Scan** → `POST /l2/heal/scan`
- Il job risultante appare nella stessa lista job con progress bar e semaforo qualità

**19. Frontend — semaforo qualità nel tab L2 per ciascun simbolo**

Nella lista simboli del tab L2, a sinistra del nome di ogni simbolo appare un pallino colorato con il quality score dell'ultimo run:

| Colore | Soglia |
| --- | --- |
| Verde | score ≥ 90 |
| Ambra | score 70–89 |
| Rosso | score &lt; 70 |

Il dato viene caricato da `cache_quality_scores` via datahub all'apertura del tab e persiste anche dopo riavvio del backend (resistente alla perdita dei job in memoria).

**20. Frontend — metriche aggregate qualità in testa al tab L2**

Prima della barra di utilizzo disco viene mostrata una card con le metriche aggregate dell'ultimo run heal:

- **System score** (media pesata per `trading_days_expected`) e **Universe score**
- Conteggio simboli per fascia: verde (≥90) / ambra (70–89) / rosso (&lt;70) / totale
- Gap trovati · Healed · Non riparati · +Candele aggiunte
- Alert se ci sono simboli con score sotto 50
- Data e ora dell'ultimo run, mode, numero simboli processati

**21. Frontend — pannello qualità nella modal visualizzazione file L2**

Aprendo la modal di un file mensile (icona occhio nella riga file del tab L2) viene mostrato in testa, prima dello switch JSON/TABLE, un pannello con i dati di qualità di quel file recuperati da `cache_quality_scores`:

- Pallino semaforico + score numerico
- Completezza%, Gap score%, Mesi ok/tot, Trading days presenti/attesi
- Gap trovati / healed / non riparati
- **Elenco giorni mancanti per mese** (da `details_json.details.gap_months`)
- **Mesi completamente mancanti** (da `details_json.details.missing_months`)
- Data ultimo check e range analizzato

---

*Fix derivati dall'analisi documentata in [cachemanager-bug-fix-e-miglioramenti](../roadmap/done/cachemanager-bug-fix-e-miglioramenti).*

---

### tickerScanner — Fase 1 separazione ETF

#### v — Classificazione ETF nell'universo e scoring per utente

**1. Campo `asset_class` nella tabella `universe`**

Aggiunto il campo `asset_class VARCHAR(20) NOT NULL DEFAULT 'STOCK'` alla tabella `universe`, valorizzato da `buildUniverseRecord` in `universeService.js` in base ai flag FMP `profile.isEtf` o `profile.isFund`:

```js
asset_class: (profile.isEtf || profile.isFund) ? "ETF" : "STOCK"
```

Migrazione DB: `db/0004_UNIVERSE_ASSET_CLASS.sql` (backfill automatico su righe esistenti tramite `is_etf` / `is_fund`).

**2. `asset_type` nel response di `/user-fundamentals-view/:pipeId`**

Il campo `asset_type` viene ora popolato in modo affidabile:

- **Pipe 0 (AST_RANKING_DAILY)**: inferito dal `bucket` — se inizia con `"ETF_"` → `"ETF"`, altrimenti `"EQUITY"`.
- **Pipe N (scores_daily)**: batch-fetch da `universe` (una sola query `GET /api/table/universe?symbol=A,B,C,...`) per i simboli privi di `asset_type`; mappato `STOCK` → `"EQUITY"`, `ETF` → `"ETF"`.

**3. Fallback pipe utente con pesi default**

Se `score-weights` non restituisce pipe configurate per un utente (es. nuovo utente, errore fetch), `launchJobsForUser` ora fa fallback automatico a `[{ pipe_id: 1 }]` con pesi default, invece di non calcolare alcuno score.

**4. Job EOD scheduler per `user-daily-scores`**

Aggiunto job scheduler `eod-user-daily-scores` (migrazione `db/0005_SCHEDULER_USER_DAILY_SCORES_JOB.sql`) che esegue ogni giorno feriale alle 22:30 chiamando `POST /internal/fundamentals/user-daily-scores` su tickerscanner con `{ "all_users": true }`.

---

### decision-engine — Fix Redis snapshot e supporto ETF

#### v — Fix snapshot Redis e market data handler

**5. Fix: snapshot Pipe Execution non salvata in Redis**

`buildDecisionEngineRouter` veniva chiamato sincronicamente in `server.js` prima che l'IIFE asincrona di init completasse, lasciando `service` (e quindi `bus()`) a `undefined`. Conseguenze:

- La lista risultati spariva al refresh della pagina (Redis mai scritto)
- Live Daily Update non funzionava (market data handler mai attachato)

**Fix**: `server.js` ora passa `getService: () => serviceInstance` al router; `bus()` e `redisStatusChannel` usano `resolveService()` lazy ad ogni chiamata. Il market data handler viene attachato tramite middleware Express alla prima richiesta HTTP, quando `serviceInstance` è certamente pronto.

**6. Fix: mese corrente senza dati non propaga errore (`cacheManager`)**

Quando il mese corrente non ha ancora dati (mercato non ancora aperto, es. prima delle 15:30 UTC), il fetch dal provider falliva e l'intera `getCandles` restituiva errore anche se tutti i mesi storici erano in cache.

Il loop su `missingMonths` ora gestisce in try/catch ogni mese: se il provider fallisce per il mese corrente o futuro viene emesso un warning e si prosegue, restituendo comunque i dati storici. Se il mese è passato l'errore viene propagato normalmente.

**7. Tag ETF nel tab Pipe Execution**

Nel tab **Pipe Execution** di `#/admin/microservice/decision-engine`, i simboli ETF mostrano ora un badge viola `ETF` affianco al nome del ticker nella tabella risultati.

Il tab **Pipe Execution** viene ricordato al refresh della pagina (persiste in localStorage insieme agli altri parametri di navigazione).

---

#### v — Fix flusso Live (live-manager)

**8. Fix: rate limit per ticker non applicato**

Le strutture `runningByTicker` e `lastRunByTicker` esistevano ma il check `now - lastRun < minIntervalMs` non veniva mai eseguito: ogni snapshot ricevuto per un ticker avviava una valutazione indipendentemente dall'intervallo trascorso dall'ultima. Il rate limit è ora correttamente applicato prima di avviare la valutazione, con log di trace che include il `nextRunIn` in secondi.

Variabile d'ambiente: `LIVE_RECALC_INTERVAL_MS` (default `60000` ms).

**9. Fix: segnale emesso su dati stantii quando `recalcFlagOkFromLiveSnapshot` fallisce**

Quando `cachemanagerUrl` non era raggiungibile o le candele non erano disponibili, `recalcFlagOkFromLiveSnapshot` restituiva `null` ma il codice faceva fallback silenzioso su `basePattern.flagOk` — un valore calcolato ore prima su un prezzo diverso.

Ora se il recalc restituisce `null`, il segnale viene bloccato (politica **fail-safe**): il TTL Redis viene aggiornato e la funzione ritorna senza emettere eventi. Un falso segnale su pattern stantio è considerato più pericoloso di un segnale mancato.

**10. Fix: `effectivePrice` unificato — prezzo live e snapshot usavano valori diversi**

I flag di ingresso (`breakoutOk`, `pullbackOk`) venivano calcolati con il `price` dello snapshot, mentre il check finale di entry usava `livePrice` letto dalla cache dei tick live. I due valori potevano divergere rendendo impossibile soddisfare entrambe le condizioni contemporaneamente.

Introdotto `effectivePrice = livePrice ?? snapshotPrice`: un unico prezzo di riferimento usato coerentemente per tutti i check — flag, entry, volume — eliminando la discordanza. Nei log di trace entrambi i valori sono ora visibili (`snapshotPrice` e `effectivePrice`).

**11. Fix: tre scenari di ingresso separati (breakout / pullback / retracement)**

`pullbackOk` era di fatto il check di retracement (`price <= retracementEntryLimit`) — i due scenari erano confusi sotto un'unica variabile. Il codice compensava con un workaround `levelsKey = entryMode === "pullback" ? "retracement" : entryMode`.

I tre flag sono ora distinti e semanticamente corretti:

| Flag | Condizione |
|---|---|
| `breakoutOk` | `effectivePrice > breakLevel + buffer` AND `volumeOk` |
| `pullbackOk` | `breakoutRecent` AND `breakLevel ≤ effectivePrice ≤ breakLevel + buffer` |
| `retracementOk` | `effectivePrice ≤ retracementEntryLimit` |

Priorità di selezione: `breakout > pullback > retracement`. Il pullback usa i livelli del breakout (stesso entry/SL/TP); il retracement usa i propri livelli. `breakoutRecent` è derivato dal flag `breakoutOk` del tick precedente, persistito in `lastFlagByTicker`.

---

*Modifiche derivate dall'analisi documentata in [Verifica tickerScanner — Comportamento con gli ETF](../roadmap/done/tickerscanner-service-improvements).*

---

### liquidity-manager — Stabilizzazione score e regime

#### v — EMA, isteresi, persistenza storica

**8. EMA dello score con alpha scalato per confidence**

Lo score grezzo calcolato da `liquidityScoreEngine` veniva restituito direttamente senza smoothing, rendendo il regime sensibile alle oscillazioni giornaliere dei singoli componenti (es. VIX spike temporaneo).

Ora viene calcolato un `score_ema` tramite EMA configurabile:

```
alpha_effective = LIQ_EMA_ALPHA × confidence
score_ema = alpha_effective × score_raw + (1 − alpha_effective) × score_ema_prev
```

Con `LIQ_EMA_ALPHA=0.2` e confidence=1.0, la finestra effettiva equivale a circa 9 giorni. Quando la confidence scende (dati mancanti), l'alpha si riduce proporzionalmente, rallentando automaticamente le variazioni.

**9. Decay verso neutral in caso di bassa confidence**

Se `confidence < LIQ_DECAY_CONFIDENCE_THRESHOLD` (default 0.3), l'EMA non viene aggiornata normalmente ma decade lentamente verso 50 (neutral) al tasso `LIQ_DECAY_RATE` (default 0.05) per ciclo:

```
score_ema = score_ema_prev + DECAY_RATE × (50 − score_ema_prev)
```

Questo evita che uno score estremo rimanga "congelato" quando i dati sono indisponibili per giorni consecutivi.

**10. Rate limiting: cap variazione giornaliera**

La variazione massima giornaliera di `score_ema` è limitata a `LIQ_MAX_DAILY_SCORE_CHANGE` (default ±8 punti). Se l'EMA calcolata supera il cap, viene troncata al valore massimo consentito. Nei log viene emessa una nota esplicativa.

**11. Isteresi sul regime (`riskRegimeSmoothed`)**

Il regime basato su `score_ema` utilizza soglie asimmetriche (banda morta) per evitare flip-flop attorno ai threshold:

| Transizione | Soglia |
|---|---|
| Entra in RISK_OFF | `score_ema < 28` |
| Esce da RISK_OFF | `score_ema > 32` |
| Entra in RISK_ON | `score_ema > 62` |
| Esce da RISK_ON | `score_ema < 58` |

Il campo `riskRegimeSmoothed` viene aggiunto allo snapshot e al payload Redis accanto al `riskRegime` grezzo, che rimane invariato.

**12. Persistenza storica in `liquidity_daily_scores`**

Ad ogni recompute viene ora salvata una riga nella tabella `liquidity_daily_scores` via `POST /api/table/liquidity_daily_scores` (datahub). La riga contiene tutti gli score parziali (raw, normalized, weight) dei 4 componenti, bitmask `components_available`, `score_raw`, `score_ema`, entrambi i regimi, e `capital_manager_base` pre-calcolato:

```
capital_manager_base = 0.70 − (score_ema / 100) × 0.50
```

Il campo `source` (ENUM `scheduler` / `manual` / `simulation`) permette di archiviare righe di simulazione sulle stesse date senza conflitti con i dati reali.

**13. capital-manager: uso di `score_ema` al posto di `score`**

`computeReservedCashPct` in `capital-manager` ora utilizza `score_ema` (se presente) al posto di `score_raw`, e `riskRegimeSmoothed` al posto di `riskRegime`. Il campo `liquidityScore` nel decision output riflette anch'esso l'EMA.

**Variabili d'ambiente:**

```env
LIQ_EMA_ALPHA=0.2
LIQ_MAX_DAILY_SCORE_CHANGE=8
LIQ_DECAY_CONFIDENCE_THRESHOLD=0.3
LIQ_DECAY_RATE=0.05
LIQ_HYSTERESIS_RISK_OFF_ENTER=28
LIQ_HYSTERESIS_RISK_OFF_EXIT=32
LIQ_HYSTERESIS_RISK_ON_ENTER=62
LIQ_HYSTERESIS_RISK_ON_EXIT=58
```

---

*Modifiche derivate dall'analisi documentata in [Stabilizzazione score e regime](../roadmap/done/liquidity-manager-stabilizzazione-score).*
