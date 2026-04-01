---
sidebar_position: 1
title: Riabilitazione sistema a pipe utente
---

# Riabilitazione sistema a pipe utente

> Documento di analisi e fix generato il 23 marzo 2026.
> Obiettivo: mantenere la Pipe 0 (Ranking Daily, sistema) e riabilitare le pipe utente (1+) con calcolo score personalizzato per pesi e filtri.

---

## 1. Stato attuale — diagnosi

### 1.1 Pipe 0 — funziona

La pipe 0 è una pipe virtuale iniettata in `GET /users/pipes`:

```javascript
// routes/userData.js
const RANKING_DAILY_VIRTUAL_PIPE = {
  id: 0, name: "Ranking Daily",
  description: "Ticker da AST_RANKING_DAILY (sistema)", enabled: 1
};
```

Il frontend la legge via `GET /fundamentals/user-fundamentals-view/0` che a sua volta chiama:
```
scores-daily/by-user?user_id=X&pipe_id=0&score_date=Y
```

I dati in `AST_RANKING_DAILY` vengono prodotti dallo scheduler EOD via:
```
POST /fundamentals/ranking/daily
```

Questo percorso è **funzionante**.

---

### 1.2 Pipe utente (1+) — silenziato

Il codice per le pipe utente esiste ma non viene più eseguito per questi motivi:

#### Problema A — Lo scheduler non chiama user-daily-scores per le pipe utente

Lo scheduler EOD chiama solo:
```
POST /fundamentals/update-market-daily
POST /fundamentals/ranking/daily
```

Non chiama più:
```
POST /internal/fundamentals/user-daily-scores
```

Risultato: la tabella `scores_daily` non viene mai popolata per `pipe_id > 0`. Il frontend mostra dati vuoti per le pipe utente.

#### Problema B — `launchJobsForUser` senza pipeId fallisce se non ci sono score_weights

```javascript
// lib/userDailyService.js — launchJobsForUser
if (pipeId === undefined) {
  const resp = await axios.get(`${dbmanagerUrl}/auth/users/${userId}/score-weights`);
  const list = Array.isArray(resp.data) ? resp.data : [];
  if (!list.length) return { ok: false, status: 404, error: "Pesi/pipe non trovati per l'utente" };
  // ...
}
```

Se un utente non ha ancora configurato pesi personalizzati, il job fallisce con 404 invece di usare i pesi default. Questo blocca silenziosamente tutti gli utenti con configurazione default.

#### Problema C — `user-fundamentals-view/0` (pipe 0) punta alla stessa tabella delle pipe utente

```javascript
// routes/userData.js — GET /user-fundamentals-view/:pipeId
const [filtersResp, orderResp, fundamentalsResp] = await Promise.all([
  // ...
  axios.get(
    `${dbmanagerUrl}/fundamentals/scores-daily/by-user?user_id=X&pipe_id=0&score_date=Y`
  ),
]);
```

Pipe 0 e pipe utente leggono entrambe da `scores_daily` filtrata per `pipe_id`. I dati di pipe 0 (prodotti da `AST_RANKING_DAILY` → `rankingDailyService`) vengono scritti nella stessa tabella ma con `pipe_id=0` e `user_id=null` (o user generico). Se questi dati non coincidono con il formato di `scores_daily`, la query non restituisce nulla.

**Questo è il punto di disaccoppiamento mancante**: pipe 0 dovrebbe leggere da `AST_RANKING_DAILY` direttamente, non da `scores_daily`.

#### Problema D — `scoringService` salta valuation e quality per gli ETF ma `rankingDailyService` non lo sa

In `rankingDailyService.js` l'ordinamento avviene per `total_score DESC`. Se i dati di `daily_scores` hanno `total_score=null` per gli ETF (perché `quality_score` e `valuation_score` sono null e i pesi non sono stati adattati), gli ETF scivolo in fondo o vengono esclusi.

---

## 2. Architettura target

```
EOD Scheduler
  │
  ├─ 1. POST /fundamentals/update-market-daily
  │       └─ Popola market_daily per tutti i simboli
  │
  ├─ 2. POST /internal/fundamentals/user-daily-scores  ← DA RIABILITARE
  │       └─ Per ogni userId attivo → per ogni pipeId dell'utente
  │           └─ Calcola scores_daily con pesi pipe-specifici
  │
  └─ 3. POST /fundamentals/ranking/daily
          └─ Legge daily_scores (pipe sistema) → scrive AST_RANKING_DAILY

Frontend
  │
  ├─ Pipe 0 → legge AST_RANKING_DAILY (via ranking/daily) ← PATH SEPARATO
  └─ Pipe N → legge scores_daily?pipe_id=N             ← PATH ESISTENTE
```

---

## 3. Fix specifici — codice

### Fix 1 — `userDailyService.js` — Fallback a default weights se pipe non configurata

**File:** `tickerScanner/lib/userDailyService.js`

**Problema:** `launchJobsForUser` restituisce 404 se l'utente non ha score_weights configurati.

**Fix:**

```javascript
// PRIMA (buggy)
const launchJobsForUser = async ({ userId, targetDate, pipeId, modelName, modelVersion, jobKey }, ctx) => {
  if (pipeId === undefined) {
    const url = `${dbmanagerUrl}/auth/users/${userId}/score-weights`;
    const resp = await axios.get(url, { timeout: 8000 });
    const list = Array.isArray(resp.data) ? resp.data : [];
    if (!list.length) return { ok: false, status: 404, error: "Pesi/pipe non trovati per l'utente" };
    // ... lancia job per ogni pipe
  }
};

// DOPO (fix)
const launchJobsForUser = async ({ userId, targetDate, pipeId, modelName, modelVersion, jobKey }, ctx) => {
  if (pipeId === undefined) {
    let list = [];
    try {
      const url = `${dbmanagerUrl}/auth/users/${userId}/score-weights`;
      const resp = await axios.get(url, { timeout: 8000 });
      list = Array.isArray(resp.data) ? resp.data : [];
    } catch (err) {
      logger.warning(`${fn} score-weights fetch failed for user=${userId}, using default pipe_id=0: ${err?.message}`);
    }

    // Fallback: se l'utente non ha pipe configurate, esegui comunque con pipe 0 e pesi default
    if (!list.length) {
      logger.info(`${fn} no user pipes found for user=${userId}, falling back to default pipe_id=0`);
      list = [{ pipe_id: 0 }];
    }

    const jobs = [];
    for (const row of list) {
      const pid = row.pipe_id ?? row.pipeId ?? 0;
      const job = createJob();
      updateJob(job.id, { date: targetDate, pipeId: pid, userId, modelName, modelVersion });
      setImmediate(() => runJob(
        job.id,
        { userId, targetDate, pipeId: pid, modelName, modelVersion, jobKey },
        ctx
      ));
      jobs.push(job.id);
    }
    return { ok: true, type: "async", jobIds: jobs, jobKey };
  }

  // pipeId specificato esplicitamente
  const job = createJob();
  updateJob(job.id, { date: targetDate, pipeId, userId, modelName, modelVersion });
  setImmediate(() => runJob(
    job.id,
    { userId, targetDate, pipeId, modelName, modelVersion, jobKey },
    ctx
  ));
  return { ok: true, type: "async", jobId: job.id, jobKey };
};
```

---

### Fix 2 — `userData.js` — Pipe 0 legge da `AST_RANKING_DAILY`, pipe N da `scores_daily`

**File:** `tickerScanner/routes/userData.js`

**Problema:** `user-fundamentals-view/:pipeId` usa lo stesso path per pipe 0 e pipe utente. Pipe 0 dovrebbe leggere da `AST_RANKING_DAILY`.

**Fix:**

```javascript
// routes/userData.js — GET /user-fundamentals-view/:pipeId

router.get("/user-fundamentals-view/:pipeId", async (req, res) => {
  const fn = "userData.GET:/user-fundamentals-view/:pipeId";
  try {
    const userId = await fetchUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "User non identificato" });
    const pipeId = req.params.pipeId;
    if (!pipeId) return res.status(400).json({ ok: false, error: "pipeId mancante" });

    const rawDate = req.query.date || req.query.asOfDate || req.query.scoreDate || null;
    const asOfDate = rawDate ? String(rawDate).slice(0, 10) : new Date().toISOString().slice(0, 10);

    // ---- PIPE 0: legge da AST_RANKING_DAILY (sistema) ----
    if (String(pipeId) === "0") {
      return handleRankingDailyView(req, res, { userId, asOfDate, datahubAxios, logger });
    }

    // ---- PIPE UTENTE (1+): legge da scores_daily ----
    const [filtersResp, orderResp, fundamentalsResp] = await Promise.all([
      axios.get(
        `${dbmanagerUrl}/fundamentals/user-filters/${userId}?pipeId=${encodeURIComponent(pipeId)}`,
        { timeout: 6000 }
      ),
      axios.get(
        `${dbmanagerUrl}/fundamentals/user-order/${userId}?pipeId=${encodeURIComponent(pipeId)}`,
        { timeout: 6000 }
      ),
      axios.get(
        `${dbmanagerUrl}/fundamentals/scores-daily/by-user?user_id=${encodeURIComponent(userId)}&pipe_id=${encodeURIComponent(pipeId)}&score_date=${encodeURIComponent(asOfDate)}`,
        { timeout: 8000, transformResponse: (r) => r }
      ),
    ]);

    const fundamentalsPayload = (() => {
      try { return typeof fundamentalsResp.data === "string" ? JSON.parse(fundamentalsResp.data) : fundamentalsResp.data; }
      catch { return fundamentalsResp.data; }
    })();

    const fundamentalsList = Array.isArray(fundamentalsPayload?.data)
      ? fundamentalsPayload.data
      : Array.isArray(fundamentalsPayload) ? fundamentalsPayload : [];

    const normalizedList = fundamentalsList.map(normalizeRecordForFilters);
    const filters  = normalizeUserFilters(filtersResp?.data?.data || filtersResp?.data || []);
    const orders   = normalizeUserOrder(orderResp?.data?.data || orderResp?.data || []);
    const filtered = applyUserFilters(normalizedList, filters);
    const ordered  = applyUserOrder(filtered, orders);
    const appliedFilters = filters.filter((f) => f?.enabled);

    const meta = {
      pipeId, asOfDate,
      total: fundamentalsList.length, filtered: ordered.length,
      appliedFilters: appliedFilters.length, appliedOrder: orders.length,
      filters: appliedFilters, order: orders,
    };

    if (fundamentalsPayload && typeof fundamentalsPayload === "object" && !Array.isArray(fundamentalsPayload)) {
      return res.json({ ...fundamentalsPayload, data: ordered, meta: { ...(fundamentalsPayload.meta || {}), ...meta } });
    }
    return res.json({ ok: true, data: ordered, meta });
  } catch (err) {
    logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
    return res.status(err?.response?.status || 500).json({ ok: false, error: "Errore pipeline fundamentals" });
  }
});

// ---- Helper: pipe 0 legge da AST_RANKING_DAILY ----
async function handleRankingDailyView(req, res, { userId, asOfDate, datahubAxios, logger }) {
  const fn = "userData.rankingDailyView";
  try {
    // Legge la ranking del giorno da AST_RANKING_DAILY
    const rankingResp = await datahubAxios.get(
      `/api/table/AST_RANKING_DAILY?score_date=${encodeURIComponent(asOfDate)}&limit=5000`
    );
    const rankingRows = rankingResp.data?.items || [];

    const enriched = rankingRows.map((row) => ({
      symbol:          row.symbol,
      bucket:          row.bucket,
      asset_type:      row.asset_type,
      rank_position:   row.rank_position,
      total_score:     row.rank_score,
      score_date:      row.score_date,
      // campi da reason_json (se presenti)
      quality_score:   row.reason_json?.quality_score   ?? null,
      risk_score:      row.reason_json?.risk_score       ?? null,
      momentum_score:  row.reason_json?.momentum_score   ?? null,
      price:           row.reason_json?.price            ?? null,
      atr_14_pct:      row.reason_json?.atr_14_pct       ?? null,
      dollar_vol_20d:  row.reason_json?.dollar_vol_20d   ?? null,
    }));

    // Ordina per bucket ASC, rank_position ASC (già ordinato da rankingDailyService)
    enriched.sort((a, b) => {
      if (a.bucket < b.bucket) return -1;
      if (a.bucket > b.bucket) return 1;
      return (a.rank_position || 0) - (b.rank_position || 0);
    });

    return res.json({
      ok: true,
      data: enriched,
      meta: {
        pipeId:    "0",
        pipeType:  "system",
        asOfDate,
        total:     enriched.length,
        filtered:  enriched.length,
        source:    "AST_RANKING_DAILY",
      },
    });
  } catch (err) {
    logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
    return res.status(500).json({ ok: false, error: "Errore lettura AST_RANKING_DAILY" });
  }
}
```

---

### Fix 3 — `userScores.js` — Endpoint interno espone `userId` obbligatorio per lo scheduler

**File:** `tickerScanner/routes/userScores.js`

**Problema:** L'endpoint interno `/internal/fundamentals/user-daily-scores` richiede `userId` nel body. Lo scheduler deve sapere per quali userId lanciare il job. Bisogna aggiungere un endpoint che recupera gli userId attivi.

**Fix A — Nuovo endpoint per lista userId attivi:**

```javascript
// Da aggiungere in routes/userScores.js (buildInternalUserScoresRouter)

// POST /internal/fundamentals/user-daily-scores/all
// Lancia il calcolo per TUTTI gli utenti attivi (chiamato dallo scheduler EOD)
router.post("/user-daily-scores/all", requireInternalToken, async (req, res) => {
  const fn = "userScores.INTERNAL.POST:/user-daily-scores/all";
  try {
    const jobKey = req.body?.jobKey || req.headers["x-job-key"] || "eod_scheduler";
    const tz     = req.body?.timezone || process.env.DEFAULT_JOB_TIMEZONE || "America/New_York";
    const defaultDate = getDateInTz(tz);
    const targetDate = (req.body?.date || req.query?.date || defaultDate).toString().slice(0, 10);
    const modelName    = req.body?.name    || "EOD Scheduler";
    const modelVersion = req.body?.version || "1.0";

    // Recupera tutti gli utenti attivi dal datahub/auth
    const usersResp = await axios.get(
      `${dbmanagerUrl}/auth/users/active`,
      { timeout: 10000 }
    );
    const users = Array.isArray(usersResp.data) ? usersResp.data
                : Array.isArray(usersResp.data?.data) ? usersResp.data.data
                : [];

    if (!users.length) {
      logger.warning(`${fn} no active users found, skipping`);
      return res.json({ ok: true, launched: 0, jobKey, targetDate });
    }

    const service = getService();
    const allJobIds = [];

    for (const user of users) {
      const userId = Number(user.id ?? user.userId ?? user.user_id);
      if (!Number.isFinite(userId)) continue;

      try {
        const result = await service.userDailySvc.launchJobsForUser(
          { userId, targetDate, pipeId: undefined, modelName, modelVersion, jobKey },
          {
            bus:                    service.bus,
            redisStatusChannel:     service.redisStatusChannel,
            redisTelemetryChannel:  service.redisTelemetryChannel,
          }
        );
        if (result.ok) {
          const ids = result.jobIds || (result.jobId ? [result.jobId] : []);
          allJobIds.push(...ids);
          logger.info(`${fn} launched ${ids.length} jobs for user=${userId}`);
        } else {
          logger.warning(`${fn} failed for user=${userId}: ${result.error}`);
        }
      } catch (err) {
        logger.error(`${fn} error for user=${userId}: ${err?.message || String(err)}`);
      }
    }

    return res.json({
      ok: true,
      launched: allJobIds.length,
      jobIds: allJobIds,
      users: users.length,
      jobKey,
      targetDate,
    });
  } catch (err) {
    logger.error(`${fn} error ${safeStringify(err?.response?.data || err?.message || err)}`);
    return res.status(500).json({ ok: false, error: "Errore avvio calcolo user_daily_scores/all" });
  }
});
```

**Fix B — Registrare la nuova route in `server.js`:**

```javascript
// server.js — già presente, nessuna modifica necessaria
// buildInternalUserScoresRouter è già montato su /internal/fundamentals
// La nuova route /user-daily-scores/all viene aggiunta dentro buildInternalUserScoresRouter
// quindi è automaticamente disponibile su:
// POST /internal/fundamentals/user-daily-scores/all
```

---

### Fix 4 — Scheduler EOD — Aggiungere il job per le pipe utente

**File:** nel microservizio `scheduler` — job EOD configuration.

Il job EOD deve includere questa chiamata **tra** `update-market-daily` e `ranking/daily`:

```json
{
  "job_key": "eod_user_daily_scores",
  "cron": "0 22 * * 1-5",
  "description": "Calcolo score giornalieri per tutte le pipe utente",
  "endpoint": "POST http://tickerscanner:3013/internal/fundamentals/user-daily-scores/all",
  "headers": {
    "x-internal-token": "{{INTERNAL_TOKEN}}",
    "x-job-key": "eod_user_daily_scores"
  },
  "body": {
    "timezone": "America/New_York",
    "name": "EOD Scheduler",
    "version": "1.0"
  },
  "depends_on": ["eod_market_daily"],
  "timeout_ms": 300000
}
```

**Sequenza EOD corretta:**

```
1. eod_market_daily
   POST /fundamentals/update-market-daily
   → Popola market_daily per tutti i simboli
   → WAIT per completamento

2. eod_user_daily_scores                          ← DA AGGIUNGERE
   POST /internal/fundamentals/user-daily-scores/all
   → Calcola scores_daily per ogni userId × pipeId
   → Usa market_daily popolato nello step 1
   → WAIT per completamento

3. eod_ranking_daily
   POST /fundamentals/ranking/daily
   → Legge daily_scores → scrive AST_RANKING_DAILY (pipe 0)
   → Può girare in parallelo con step 2 SE ha dati sufficienti,
     oppure dopo per garantire coerenza
```

---

### Fix 5 — `rankingDailyService.js` — Scrive i dati anche in `daily_scores` per pipe 0

**Problema:** `buildDailyRankingSnapshot` scrive in `AST_RANKING_DAILY` ma non in `scores_daily` con `pipe_id=0`. Il path di lettura per pipe 0 in `user-fundamentals-view/0` (versione corrente) tenta di leggere da `scores_daily` con `pipe_id=0` e trova vuoto.

Con il Fix 2 sopra questo non è più necessario (pipe 0 legge direttamente da `AST_RANKING_DAILY`). Ma se si vuole mantenere la compatibilità con il path attuale, si può aggiungere una scrittura aggiuntiva.

**Opzione A (consigliata): Fix 2 è sufficiente** — pipe 0 legge da `AST_RANKING_DAILY` direttamente. Nessuna modifica a `rankingDailyService.js`.

**Opzione B (retrocompatibilità)**: aggiungere a `buildDailyRankingSnapshot` una scrittura su `scores_daily` con `pipe_id=0`:

```javascript
// rankingDailyService.js — buildDailyRankingSnapshot
// Dopo la scrittura su AST_RANKING_DAILY, sync su scores_daily pipe_id=0

// Sync su scores_daily per retrocompatibilità pipe_id=0
logger.info(`${fn} syncing ${toWrite.length} rows to daily_scores pipe_id=0`);
await runConcurrent(
  toWrite,
  async (record) => {
    const scoreRow = {
      symbol:         record.symbol,
      score_date:     record.score_date,
      total_score:    record.rank_score,
      quality_score:  record.reason_json?.quality_score  ?? null,
      risk_score:     record.reason_json?.risk_score      ?? null,
      momentum_score: record.reason_json?.momentum_score  ?? null,
      price:          record.reason_json?.price           ?? null,
      atr_14_pct:     record.reason_json?.atr_14_pct      ?? null,
      dollar_vol_20d: record.reason_json?.dollar_vol_20d  ?? null,
      pipe_id: 0,
      user_id: null,
    };
    try {
      await datahubAxios.post("/api/table/daily_scores", scoreRow);
    } catch {
      // ignore duplicates — upsert non disponibile, silently skip
    }
  },
  10
);
```

---

### Fix 6 — `userDailyService.js` — Evitare che `runJob` fallisca silenziosamente per assenza di market_daily

**File:** `tickerScanner/lib/userDailyService.js`

**Problema:** se `market_daily` è vuoto per un simbolo (es. primo avvio), il job continua ma accumula warning e alla fine `results` è vuoto senza errore esplicito.

**Fix:**

```javascript
// In runJob, dopo il fetch di fundamentalsRows:
const fundamentalsRows = await fetchAllPages(datahubAxios, `/api/table/universe`);

if (!fundamentalsRows.length) {
  const finishedAt = new Date().toISOString();
  updateJob(jobId, { status: "error", error: "universe vuoto — nessun simbolo da processare", finishedAt });
  await reportJobDone(bus, redisStatusChannel, jobId, {
    status: "FAILED",
    error: "universe vuoto",
  });
  return;
}

// Aggiungi anche un check alla fine prima di salvare:
if (!results.length) {
  logger.warning(`${jobFn} 0 risultati calcolati — market_daily probabilmente vuoto per questa data (${targetDate})`);
  // Non fallire, ma logga chiaramente
}
```

---

## 4. Schema completo delle dipendenze tra tabelle e pipe

```
universe
  │ (join per is_etf, market_cap, sector, country)
  ▼
market_daily
  │ (candles storiche, popolate da update-market-daily)
  ▼
scores_daily / daily_scores                      ← popolate da user-daily-scores (pipe 1+)
  │ pipe_id=1, pipe_id=2, ...
  ▼
user-fundamentals-view/:pipeId (pipe 1+)         ← frontend legge qui per pipe utente

AST_RANKING_DAILY                                ← popolata da ranking/daily (pipe 0)
  ▼
user-fundamentals-view/0 (pipe 0)                ← frontend legge qui per pipe sistema
```

---

## 5. Riepilogo fix e priorità

| # | File | Tipo fix | Priorità | Descrizione |
|---|------|----------|----------|-------------|
| 1 | `lib/userDailyService.js` | Bug fix | 🔴 Alta | Fallback a default weights se pipe non configurata |
| 2 | `routes/userData.js` | Architetturale | 🔴 Alta | Pipe 0 legge da AST_RANKING_DAILY, pipe N da scores_daily |
| 3A | `routes/userScores.js` | Feature | 🔴 Alta | Nuovo endpoint `/user-daily-scores/all` per scheduler |
| 3B | `server.js` | Nessuna modifica | — | Già montato correttamente |
| 4 | Scheduler config | Config | 🔴 Alta | Aggiungere job `eod_user_daily_scores` nel ciclo EOD |
| 5 | `lib/rankingDailyService.js` | Opzionale | 🟡 Media | Sync retrocompatibilità su daily_scores pipe_id=0 |
| 6 | `lib/userDailyService.js` | Robustezza | 🟡 Media | Guard su universe/market_daily vuoti |

---

## 6. Verifica post-fix — checklist

Dopo aver applicato i fix, verificare nell'ordine:

**Step 1 — Test fix 1 (fallback weights):**
```bash
# Chiamata manuale al job per un utente senza pipe configurate
curl -X POST http://tickerscanner:3013/internal/fundamentals/user-daily-scores \
  -H "x-internal-token: TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": 1, "date": "2026-03-21"}'
# Atteso: { ok: true, type: "async", jobId: "..." }
# Prima del fix: { ok: false, status: 404, error: "Pesi/pipe non trovati" }
```

**Step 2 — Test fix 3A (all users):**
```bash
curl -X POST http://tickerscanner:3013/internal/fundamentals/user-daily-scores/all \
  -H "x-internal-token: TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"date": "2026-03-21"}'
# Atteso: { ok: true, launched: N, users: M }
```

**Step 3 — Verifica dati in scores_daily:**
```sql
SELECT symbol, score_date, user_id, pipe_id, total_score
FROM scores_daily
WHERE score_date = '2026-03-21'
ORDER BY pipe_id, total_score DESC
LIMIT 20;
-- Atteso: righe con pipe_id=1, pipe_id=2, ecc.
```

**Step 4 — Test fix 2 (pipe 0 da AST_RANKING_DAILY):**
```bash
curl http://tickerscanner:3013/fundamentals/user-fundamentals-view/0?date=2026-03-21 \
  -H "Authorization: Bearer TOKEN"
# Atteso: { ok: true, data: [...], meta: { source: "AST_RANKING_DAILY" } }
```

**Step 5 — Test pipe utente (pipe 1+):**
```bash
curl http://tickerscanner:3013/fundamentals/user-fundamentals-view/1?date=2026-03-21 \
  -H "Authorization: Bearer TOKEN"
# Atteso: { ok: true, data: [...], meta: { source: "scores_daily", pipeId: "1" } }
```

**Step 6 — Verifica frontend:**
- Aprire il frontend → selezionare Pipe 0 → verificare ticker da AST_RANKING_DAILY
- Selezionare Pipe 1+ → verificare ticker con score personalizzati
- Modificare pesi pipe 1 → rilancio manuale job → verificare cambio ordinamento

---

## 7. Note aggiuntive

### Endpoint `GET /auth/users/active` — da verificare esistenza

Il Fix 3A usa `GET /auth/users/active` per recuperare gli userId attivi. Verificare che questo endpoint esista in `datahub` / `authservice`. Se non esiste, le alternative sono:

1. **Leggere da `user_pipes` tramite datahub:**
   ```javascript
   const resp = await datahubAxios.get('/api/table/user_pipes?limit=1000');
   const userIds = [...new Set(resp.data?.items?.map(r => r.user_id).filter(Boolean))];
   ```

2. **Leggere da `universe` + `user_score_weights`:**
   ```javascript
   const resp = await datahubAxios.get('/api/table/user_score_weights?limit=1000');
   const userIds = [...new Set(resp.data?.items?.map(r => r.user_id).filter(Boolean))];
   ```

3. **Hardcodare userId nel body della chiamata scheduler** (soluzione temporanea):
   ```json
   { "userIds": [1, 2, 3], "date": "2026-03-21" }
   ```

### Gestione `pipe_id=0` in `user_score_weights`

Verificare che la tabella `user_score_weights` accetti `pipe_id=0` come valore valido. Se la PK è `(user_id, pipe_id)` con `pipe_id > 0`, il fallback del Fix 1 deve usare i `DEFAULT_WEIGHTS` hardcodati in `weightsConfig.js` invece di cercare da DB per pipe_id=0.

Il codice in `userDailyService.runJob → fetchUserScoreWeights` già gestisce questo:
```javascript
// Se il fetch fallisce o restituisce {}, usa DEFAULT_WEIGHTS
return resp.data || {};
// e poi in runJob:
const weights = await fetchUserScoreWeights(userIdSafe, pipeIdSafe);
// weightsConfig.normalizeWeights() riempie i missing con DEFAULT_WEIGHTS
```

Quindi il fallback è già sicuro.

---

*Fine documento. I fix sono elencati in ordine di applicazione consigliato: 1 → 3A → 4 → 2 → 5 (opzionale) → 6.*
