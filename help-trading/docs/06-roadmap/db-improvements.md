---
sidebar_position: 6
title: DB - Improvements
---

# Architettura DB — Miglioramenti e note di brainstorm

> Documento di lavoro generato il 22 marzo 2026.
> Riguarda esclusivamente le decisioni architetturali legate al database:
> spostamento su Cloud SQL GCP, Redis write-through, auth caching, start/stop automatico, archivio log.

---

## 1. Analisi consumo MySQL attuale sulla VM

Prima di qualsiasi decisione, misurare l'impatto reale di MySQL sulla VM.

### Comandi di misurazione

```bash
# RAM usata da MySQL
ps aux --sort=-%mem | grep mysql

# Configurazione buffer pool attuale
mysql -e "SHOW VARIABLES LIKE 'innodb_buffer_pool_size';"
mysql -e "SHOW STATUS LIKE 'Innodb_buffer_pool_pages%';"

# I/O disco durante un job EOD (30 secondi durante tickerScanner)
iostat -x 1 30

# CPU durante job pesanti
top -p $(pgrep mysqld)
```

### Fix rapido da valutare prima della migrazione

Ridurre il buffer pool di InnoDB nel MySQL locale — potrebbe liberare 1-2GB di RAM immediatamente, senza nessuna migrazione e senza costi aggiuntivi:

```ini
# /etc/mysql/mysql.conf.d/mysqld.cnf
innodb_buffer_pool_size = 256M   # invece del default ~1-2GB
innodb_buffer_pool_instances = 1
```

Questo è il primo test da fare: se libera abbastanza RAM da eliminare l'OOM killer durante i rebuild Docusaurus, potrebbe non essere necessario spostare MySQL su Cloud SQL. Il downside è una performance query leggermente più lenta per dataset grandi — per un workload non-OLAP come questo è tipicamente accettabile.

---

## 2. Autenticazione cachata su Redis — Priorità ALTA

Fix prioritario indipendente dalla decisione su Cloud SQL. Oggi se MySQL è offline, il frontend non è accessibile nemmeno per utenti già loggati con sessione attiva.

### Strategia

```javascript
// Al login riuscito, cache l'utente su Redis per 24h
const userCacheKey = `auth:user:${userId}`;
await redis.set(userCacheKey, JSON.stringify({
  id:          user.id,
  email:       user.email,
  role:        user.role,
  permissions: user.permissions,
}), { EX: 86400 });

// Per API key: cache 1h, refresh periodico se MySQL online
const apiKeyCacheKey = `auth:apikey:${hashedKey}`;
await redis.set(apiKeyCacheKey, JSON.stringify({
  userId: apiKey.userId,
  scope:  apiKey.scope,
  active: true,
}), { EX: 3600 });
```

### Middleware auth con fallback Redis

```javascript
async function authMiddleware(req, res, next) {
  // JWT validation è stateless — non richiede DB
  const payload = verifyJwt(extractToken(req));

  // Lookup utente: Redis first, MySQL fallback se online
  const cacheKey = `auth:user:${payload.userId}`;
  let user = await redis.get(cacheKey);

  if (!user && dbState.current === 'ONLINE') {
    user = await mysql.findUser(payload.userId);
    // Popola cache per i prossimi accessi
    await redis.set(cacheKey, JSON.stringify(user), { EX: 3600 });
  }

  if (!user) {
    // MySQL offline e utente non in cache — risposta controllata
    return res.status(503).json({
      error:   'AUTH_CACHE_MISS',
      message: 'Database temporaneamente non disponibile. Riprova tra qualche ora.',
    });
  }

  req.user = user;
  next();
}
```

### Risultato atteso

| Scenario | Comportamento attuale | Comportamento post-fix |
|----------|----------------------|----------------------|
| MySQL offline, utente loggato nelle ultime 24h | ❌ Frontend inaccessibile | ✅ Continua a funzionare |
| MySQL offline, nuovo login | ❌ Errore generico | ✅ Messaggio chiaro e controllato |
| MySQL offline, API key valida nell'ultima ora | ❌ 500 error | ✅ Continua a funzionare |
| MySQL torna online | N/A | ✅ Cache aggiornata automaticamente |

---

## 3. Datahub — Sfruttamento flag redis_cache_enabled per tabella

Il flag `redis_cache_enabled` esiste già nella configurazione per tabella in datahub. Va sfruttato sistematicamente per implementare la logica dual-mode: MySQL quando disponibile, Redis buffer quando offline.

### Logica dual-mode in datahub

```javascript
// Per ogni operazione read/write in datahub:
const tableConfig = await getTableConfig(tableName);

if (tableConfig.redis_cache_enabled) {
  // Read:  Redis first → MySQL fallback se online
  // Write: MySQL first (se online) + sync Redis
  //        MySQL offline: Redis buffer → flush quando torna online
} else {
  // Comportamento attuale: MySQL diretto
  // MySQL offline: risposta 503 controllata con messaggio chiaro
}
```

### Tabelle candidate per `redis_cache_enabled = true`

| Tabella | Tipo di cache | TTL Redis | Motivo |
|---------|--------------|-----------|--------|
| `users` | Read cache | 24h, refresh on login | Auth critica |
| `api_keys` | Read cache | 1h | Auth critica |
| `settings` | Read cache | 24h, invalidato su update | Letti all'avvio da tutti i microservizi |
| `universe` | Read cache | 12h | Base fondamentale, cambia ~weekly |
| `user_pipes` | Read cache | 1h | Config utente |
| `user_score_weights` | Read cache | 1h | Config utente |
| `market_daily` | Write buffer | 16h max | Scritture frequenti EOD |
| `daily_scores` | Write buffer | 16h max | Scritture EOD |
| `scores_daily` | Write buffer | 16h max | Scritture EOD |
| `ticker_scan_jobs` | Write buffer | 16h max | Job state, non critico se ritardato |

### Tabelle che NON vanno in buffer — consistenza critica

| Tabella | Motivo |
|---------|--------|
| `orders` | Dati finanziari — zero buffer intermedio accettabile |
| `positions` | Dati finanziari — zero buffer intermedio accettabile |
| `reservations` | Capital manager — consistenza critica |
| `capital_allocations` | Dati finanziari — zero buffer intermedio accettabile |

---

## 4. Mappatura servizi per stato MySQL offline

| Servizio | Stato con MySQL offline | Note |
|----------|------------------------|------|
| `cacheManager` | ✅ Completamente operativo | L2 su filesystem, L3 su Redis |
| `market-data-service` | ✅ Completamente operativo | Stream live, non usa DB |
| `ibkr-bridge` | ✅ Completamente operativo | Proxy IBKR, non usa DB |
| `decision-engine` | ✅ Operativo (live scan) | Guardrail e score già in Redis |
| `alertingService` | ✅ Operativo | Regole in Redis/config |
| `datahub` | 🟡 Degradato — write buffer | Scritture su Redis, letture da cache |
| `liquidity-manager` | 🟡 Degradato | Settings da Redis cache |
| `capital-manager` | 🟡 Degradato | Settings da Redis cache, no nuove allocazioni |
| `scheduler` | 🟡 Degradato | Job config da Redis cache |
| Auth / Login utenti esistenti | 🟡 Degradato | Utenti cached funzionano, nuovi login no |
| `tickerScanner` EOD job | 🔴 Offline | Richiede persistenza DB per risultati |
| Nuovi login frontend | 🔴 Offline | MySQL richiesto per autenticazione iniziale |

---

## 5. Spostamento MySQL su Cloud SQL GCP

### Architettura start/stop automatico

**Datahub espone gli endpoint, Scheduler li chiama:**

```
Scheduler (job configurato)
    │
    ├─ 07:00 ET (inizio sessione di trading)
    │    → POST /db/start
    │         └─ Chiama GCP Cloud SQL Admin API
    │            → Avvia istanza MySQL
    │            → Attende stato RUNNABLE (~60-90 secondi)
    │            → Triggera flush Redis → MySQL (write buffer)
    │            → Pubblica evento Redis: DB_ONLINE
    │            → Notifica alertingService
    │
    └─ 23:00 ET (fine sessione)
         → POST /db/stop
              └─ Verifica nessun job attivo in corso
                 → Flush finale Redis → MySQL
                 → Chiama GCP Cloud SQL Admin API
                 → Ferma istanza MySQL
                 → Pubblica evento Redis: DB_OFFLINE
```

### Endpoint datahub da esporre

```
POST /db/start
  → Avvia istanza Cloud SQL tramite GCP API
  → Attende RUNNABLE, triggera flush buffer
  → Risposta: { ok: true, instance: "...", startedAt: "...", flushStats: { ... } }

POST /db/stop
  → Verifica job attivi (rifiuta se ci sono job in esecuzione)
  → Flush finale Redis → MySQL
  → Ferma istanza Cloud SQL
  → Risposta: { ok: true, stoppedAt: "...", bufferedWrites: 0 }

GET /db/status
  → Risposta: { state: "ONLINE|OFFLINE|STARTING|STOPPING",
                lastOnline: "...", lastOffline: "...",
                bufferStats: { pending_writes: N, tables: {...} } }

POST /db/flush
  → Flush manuale Redis → MySQL (disponibile solo se MySQL ONLINE)
  → Risposta: { ok: true, flushed: N, errors: [...] }

GET /db/buffer/stats
  → Quante scritture pendenti in buffer Redis, per tabella
  → Risposta: { total: 1247, by_table: { market_daily: 842, daily_scores: 405 } }
```

### Autenticazione GCP dalla VM

Service Account con ruolo `Cloud SQL Admin` — autenticazione trasparente via metadata server GCP, nessuna API key da gestire nel codice.

```javascript
const { GoogleAuth } = require('google-auth-library');
const auth = new GoogleAuth({
  scopes: 'https://www.googleapis.com/auth/sqlservice.admin',
});

async function startCloudSQL(projectId, instanceId) {
  const client = await auth.getClient();
  const url = `https://sqladmin.googleapis.com/v1/projects/${projectId}/instances/${instanceId}`;
  // Patch per avviare l'istanza (settings.activationPolicy = ALWAYS)
  await client.request({
    url,
    method: 'PATCH',
    data: { settings: { activationPolicy: 'ALWAYS' } },
  });
}

async function stopCloudSQL(projectId, instanceId) {
  const client = await auth.getClient();
  const url = `https://sqladmin.googleapis.com/v1/projects/${projectId}/instances/${instanceId}`;
  // Patch per fermare l'istanza (settings.activationPolicy = NEVER)
  await client.request({
    url,
    method: 'PATCH',
    data: { settings: { activationPolicy: 'NEVER' } },
  });
}
```

### Health check con state machine in datahub

```javascript
// Stati: ONLINE, OFFLINE, STARTING, STOPPING, RECOVERING
const dbState = { current: 'UNKNOWN', lastCheck: null };

setInterval(async () => {
  try {
    await db.query('SELECT 1');
    if (dbState.current === 'OFFLINE' || dbState.current === 'RECOVERING') {
      dbState.current = 'RECOVERING';
      await flushRedisBuffer();   // flush scritture accumulate
      dbState.current = 'ONLINE';
      await redis.publish('system.events', JSON.stringify({
        event: 'DB_ONLINE', ts: new Date().toISOString()
      }));
    } else {
      dbState.current = 'ONLINE';
    }
  } catch {
    if (dbState.current === 'ONLINE') {
      await redis.publish('system.events', JSON.stringify({
        event: 'DB_OFFLINE', ts: new Date().toISOString()
      }));
    }
    dbState.current = 'OFFLINE';
  }
}, 10_000); // check ogni 10 secondi
```

### Flush Redis → MySQL

```javascript
async function flushRedisBuffer() {
  const keys = await redis.keys('datahub:buffer:*');
  const errors = [];

  for (const key of keys) {
    try {
      const raw = await redis.get(key);
      const { table, data, ts } = JSON.parse(raw);
      await mysql.upsert(table, data);  // upsert per idempotenza
      await redis.del(key);
    } catch (err) {
      errors.push({ key, error: err.message });
    }
  }

  return { flushed: keys.length - errors.length, errors };
}
```

---

## 6. Valutazione economica

### Configurazione target

- VM: `e2-medium` (1 vCPU, 4GB RAM)
- Disco VM: `pd-ssd` 20GB
- Cloud SQL: `db-f1-micro` (1 vCPU condivisa, 614MB RAM)
- Cloud SQL storage: 10GB SSD

### Stima costi mensili

| Scenario | VM | Cloud SQL | Totale |
|----------|----|-----------|--------|
| Attuale — tutto h24, MySQL locale | ~$48 | — | **~$48/mese** |
| VM ridimensionata h24 + Cloud SQL 8h/gg | ~$24 | ~$7 | **~$31/mese** |
| VM 8h/24h + Cloud SQL 8h/gg | ~$8 | ~$7 | **~$15/mese** |

**Risparmio potenziale passando a tutto start/stop: ~$33/mese (~$400/anno)**

### Dettaglio calcoli

- VM `e2-medium` h24: ~$24/mese — accesa 8h/24h: ~$8/mese
- Cloud SQL `db-f1-micro` 8h/24h: ~$5/mese compute
- Cloud SQL storage 10GB SSD: ~$1.7/mese (**sempre addebitato**, anche con istanza ferma)
- Upgrade disco VM `pd-standard` → `pd-ssd` 20GB: +$2.6/mese — **consigliato** per ridurre I/O contention durante rebuild Docusaurus e job EOD

### Beneficio RAM sulla VM

Rimuovere MySQL libera il buffer pool InnoDB (~1-2GB con configurazione attuale). Su una VM da 4GB questo è il 25-50% della RAM totale — direttamente rilevante per eliminare l'OOM killer durante i rebuild Docusaurus.

### Considerazione latenza

Spostare MySQL su Cloud SQL introduce latenza di rete:
- Stessa region GCP: **~1-3ms per query** (vs ~0.1ms su localhost)
- Per query singole: trascurabile
- Per job con loop di N query (tickerScanner EOD): può moltiplicarsi — **da misurare con benchmark prima della migrazione definitiva**
- Mitigazione: connection pooling, batch insert dove possibile

---

## 7. Endpoint archivio log datahub

### Motivazione

Il DB accumula log applicativi, job history e dati operativi che crescono nel tempo occupando spazio prezioso. Con Cloud SQL su istanza piccola (`db-f1-micro`) questo è ancora più critico. L'archivio su filesystem risolve il problema mantenendo la possibilità di reimportare i dati storici se necessario.

### Endpoint

```
POST /logs/archive
  Body: {
    before_date: "2026-01-01",     // archivia tutto prima di questa data
    tables: ["logs", "ticker_scan_jobs", "market_daily_jobs"]
  }
  → Esporta record su filesystem compressi (gzip)
  → File: /archive/{table}/2025-11_{table}.json.gz  (un file per mese per tabella)
  → Rimuove i record dal DB dopo conferma scrittura file
  → Risposta: {
      archived: 15432,
      files: ["2025-11_logs.json.gz", "2025-12_logs.json.gz"],
      freed_mb: 45,
      duration_ms: 3200
    }

GET /logs/archive
  → Lista file archiviati con metadati
  → Risposta: [{
      file:        "2025-11_logs.json.gz",
      table:       "logs",
      period:      "2025-11",
      records:     15432,
      size_mb:     2.3,
      archived_at: "2026-01-01T04:00:00Z"
    }]

POST /logs/restore
  Body: { file: "2025-11_logs.json.gz" }
  → Reimporta file archiviato nel DB
  → Utile per analisi storica o debug
  → Risposta: { restored: 15432, duration_ms: 4200 }

GET /logs/archive/:filename
  → Download diretto del file archiviato
```

### Compressione

gzip riduce JSON di log tipicamente del 70-80%:
- 1M record, ~500MB JSON → ~100MB gzip
- Storage `/archive/` nel filesystem della VM (non nel container Cloud SQL)

### Schedulazione consigliata

Job notturno che archivia tutto ciò che è più vecchio di 90 giorni:

```json
{
  "job_key":  "logs_archive_nightly",
  "cron":     "0 4 * * *",
  "endpoint": "POST http://datahub:3000/logs/archive",
  "body": {
    "before_date": "-90d",
    "tables": ["logs", "ticker_scan_jobs", "market_daily_jobs", "user_daily_score_jobs"]
  }
}
```

Con questo job il DB rimane sempre sotto i 90 giorni di dati operativi, indipendentemente dalla dimensione dell'istanza Cloud SQL scelta.

---

## 8. Ordine di implementazione consigliato

| # | Task | Dipendenze | Priorità | Stima |
|---|------|------------|----------|-------|
| 1 | Misurare consumo reale MySQL (RAM, CPU, I/O) | Nessuna | 🔴 Prima di tutto | 1h |
| 2 | Ridurre `innodb_buffer_pool_size` a 256MB | Fix 1 | 🔴 Quick win | 30min |
| 3 | Auth caching su Redis | Nessuna | 🔴 Alta | 3h |
| 4 | Sfruttare flag `redis_cache_enabled` per tabelle read-cache | Fix 3 | 🟠 Alta | 4h |
| 5 | Write buffer Redis per tabelle EOD | Fix 4 | 🟠 Alta | 3h |
| 6 | Flush automatico Redis → MySQL al reconnect | Fix 5 | 🟠 Alta | 2h |
| 7 | Endpoint `/logs/archive` + `/logs/restore` | Nessuna | 🟡 Media | 3h |
| 8 | Schedulazione archivio 90 giorni | Fix 7 | 🟡 Media | 1h |
| 9 | Benchmark latenza query dopo eventuale migrazione Cloud SQL | Fix 1 | 🟡 Media | 2h |
| 10 | Endpoint `/db/start` `/db/stop` `/db/status` in datahub | Fix 3-6 | 🟢 Bassa | 4h |
| 11 | Service Account GCP + integrazione Cloud SQL Admin API | Fix 10 | 🟢 Bassa | 2h |
| 12 | Job scheduler per start/stop automatico | Fix 10-11 | 🟢 Bassa | 1h |
| 13 | Migrazione dati MySQL locale → Cloud SQL | Fix 1-9 | 🟢 Bassa — dopo validazione | 4h |

**Totale stimato passi 1–8 (pre-migrazione):** ~17h
**Totale stimato passi 9–13 (migrazione Cloud SQL):** ~13h

---

*Documento da aggiornare man mano che emergono nuovi punti nel brainstorm.*
