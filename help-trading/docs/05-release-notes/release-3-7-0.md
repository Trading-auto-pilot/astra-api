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

*Fix derivati dall'analisi documentata in [cachemanager-bug-fix-e-miglioramenti](../roadmap/cachemanager-bug-fix-e-miglioramenti).*
