---
sidebar_position: 5
---

# Frontend — Servizi condivisi

## Client HTTP centralizzato (`src/api/httpClient.ts`)

Tutti i moduli API usano `httpClient` come base. Non si usa `axios` — tutto passa per un wrapper `fetch` custom.

**Funzionalità:**

| Feature | Comportamento |
|---|---|
| Auth header | `Authorization: Bearer <token>` su ogni richiesta autenticata |
| Auto-renewal | Se il token scade entro 5 minuti, chiama `POST /auth/renew` silenziosamente |
| Error handling | Lancia `HttpError(status, body)` su risposta non-2xx |
| Abort signal | Supporto nativo `AbortController` per cancellare le richieste |
| Skip auth | Flag `{ skipAuth: true }` per endpoint pubblici |

**API:**

```ts
httpClient<T>(path, options?) → Promise<T>

http.get<T>(path, options?)
http.post<T>(path, body, options?)
http.put<T>(path, body, options?)
http.patch<T>(path, body, options?)
http.delete<T>(path, options?)

// Token management
getToken() → string | null
setToken(token: string) → void
removeToken() → void
buildUrl(path: string) → string   // Prepende VITE_API_BASE_URL
```

---

## Moduli API (`src/api/`)

### `auth.ts` — Autenticazione

| Funzione | Metodo | Endpoint |
|---|---|---|
| `login(credentials)` | `POST` | `/auth/login` |
| `fetchCurrentAdmin(token?)` | `GET` | `/auth/admin/me` |
| `authenticate(credentials)` | — | Combina login + fetch profilo |

### `users.ts` — Gestione utenti (admin)

| Funzione | Metodo | Endpoint |
|---|---|---|
| `fetchAdminUsers(signal?)` | `GET` | `/auth/admin/user` |
| `createAdminUser(payload)` | `POST` | `/auth/admin/user` |
| `updateAdminUser(userId, payload)` | `PUT` | `/auth/admin/user/{id}` |
| `deleteAdminUser(userId)` | `DELETE` | `/auth/admin/user/{id}` |
| `fetchAdminUserPermissions(userId)` | `GET` | `/auth/admin/user/{id}/permissions` |
| `createAdminUserPermission(userId, payload)` | `POST` | `/auth/admin/user/{id}/permissions` |
| `updateAdminUserPermission(userId, permId, payload)` | `PUT` | `/auth/admin/user/{id}/permissions/{permId}` |
| `deleteAdminUserPermission(userId, permId)` | `DELETE` | `/auth/admin/user/{id}/permissions/{permId}` |
| `fetchAdminUserClientNavigation(userId)` | `GET` | `/auth/admin/user/{id}/client-nav` |
| `createAdminUserClientNavigation(userId, payload)` | `POST` | `/auth/admin/user/{id}/client-nav` |
| `updateAdminUserClientNavigation(userId, navId, payload)` | `PUT` | `/auth/admin/user/{id}/client-nav/{navId}` |
| `deleteAdminUserClientNavigation(userId, navId)` | `DELETE` | `/auth/admin/user/{id}/client-nav/{navId}` |

### `apiKeys.ts` — Gestione API Keys

| Funzione | Metodo | Endpoint |
|---|---|---|
| `listApiKeys()` | `GET` | `/auth/admin/api-keys` |
| `createApiKey(payload)` | `POST` | `/auth/admin/api-keys` |
| `updateApiKey(id, payload)` | `PUT` | `/auth/admin/api-keys/{id}` |
| `deleteApiKey(id)` | `DELETE` | `/auth/admin/api-keys/{id}` |
| `listApiKeyPermissions(apiKeyId)` | `GET` | `/auth/admin/api-keys/{id}/permissions` |
| `createApiKeyPermission(apiKeyId, payload)` | `POST` | `/auth/admin/api-keys/{id}/permissions` |
| `updateApiKeyPermission(apiKeyId, permId, payload)` | `PUT` | `/auth/admin/api-keys/{id}/permissions/{permId}` |
| `deleteApiKeyPermission(apiKeyId, permId)` | `DELETE` | `/auth/admin/api-keys/{id}/permissions/{permId}` |

### `tickerScanner.ts` — Ticker scanning e job management

**Scan jobs:**

| Funzione | Metodo | Endpoint |
|---|---|---|
| `fetchTickerScanJobs(signal?)` | `GET` | `/tickerscanner/scan/jobs` |
| `startTickerScan()` | `GET` | `/tickerscanner/scan` |
| `startTickerScanForce()` | `GET` | `/tickerscanner/scan/force` |
| `cancelTickerScanJob(jobId)` | `DELETE` | `/tickerscanner/scan/jobs/{jobId}` |
| `fetchTickerScanJobHistory(limit)` | `GET` | `/tickerscanner/fundamentals/ticker-scan-jobs` |
| `deleteTickerScanJobHistory(id)` | `DELETE` | `/tickerscanner/fundamentals/ticker-scan-jobs/{id}` |

**Market Daily:**

| Funzione | Metodo | Endpoint |
|---|---|---|
| `updateMarketDaily()` | `POST` | `/tickerscanner/fundamentals/update-market-daily` |
| `fetchMarketDailyJobs()` | `GET` | `/tickerscanner/fundamentals/update-market-daily` |
| `cancelMarketDailyJob(jobId)` | `DELETE` | `/tickerscanner/fundamentals/update-market-daily/{jobId}` |
| `fetchMarketDailyJobHistory(limit)` | `GET` | `/tickerscanner/fundamentals/market-daily-jobs` |
| `deleteMarketDailyJobHistory(id)` | `DELETE` | `/tickerscanner/fundamentals/market-daily-jobs/{id}` |

**User Daily Scores:**

| Funzione | Metodo | Endpoint |
|---|---|---|
| `startUserDailyJob(date, pipeId?, version?, name?)` | `POST` | `/tickerscanner/fundamentals/user-daily-scores` |
| `fetchUserDailyJobs()` | `GET` | `/tickerscanner/fundamentals/user-daily-scores` |
| `cancelUserDailyJob(jobId)` | `DELETE` | `/tickerscanner/fundamentals/user-daily-scores/{jobId}` |
| `fetchUserDailyScoreJobs(limit)` | `GET` | `/tickerscanner/fundamentals/user-daily-score-jobs` |
| `deleteUserDailyScoreJob(id)` | `DELETE` | `/tickerscanner/fundamentals/user-daily-score-jobs/{id}` |

**Varie:**

| Funzione | Metodo | Endpoint |
|---|---|---|
| `refreshTickerMomentum()` | `POST` | `/tickerscanner/momentum/refresh` |
| `fetchUserPipes()` | `GET` | `/tickerscanner/fundamentals/users/pipes` |
| `fetchScoresDailyByUser(pipeId, scoreDate)` | `GET` | `/tickerscanner/fundamentals/scores-daily/{pipeId}/{date}` |
| `fetchMarketDailyCompare(tradeDate)` | `GET` | `/tickerscanner/fundamentals/market-daily/compare` |

### `scheduler.ts` — Gestione job scheduler

| Funzione | Metodo | Endpoint |
|---|---|---|
| `fetchSchedulerJobs(signal?)` | `GET` | `/scheduler/jobs` |
| `createSchedulerJob(payload)` | `POST` | `/scheduler/jobs` |
| `updateSchedulerJob(jobId, payload)` | `PUT` | `/scheduler/jobs/{id}` |
| `deleteSchedulerJob(jobId)` | `DELETE` | `/scheduler/job/{id}` |
| `reloadSchedulerJobs()` | `POST` | `/scheduler/reload` |
| `fetchSchedulerJobLastRun(jobKey)` | `GET` | `/scheduler/jobs/{key}/last-run` |
| `runSchedulerJob(jobKey, overrides?)` | `POST` | `/scheduler/jobs/{key}/run` |

### `serviceFlags.ts` — Flag servizi e configurazione microservizi

Aggrega chiamate verso più microservizi per le funzionalità di amministrazione.

**Service Control Plane:**

| Funzione | Endpoint |
|---|---|
| `fetchServiceFlags()` | `GET /servicecontrolplane/service-flags` |
| `updateServiceFlag(id, payload)` | `PUT /servicecontrolplane/service-flags/{id}` |

**Cachemanager** (e analoghi per altri microservizi):

| Funzione | Endpoint |
|---|---|
| `fetchCacheHealth()` | `GET /cachemanager/status/health` |
| `fetchCacheReleaseInfo()` | `GET /cachemanager/release` |
| `fetchCacheSettings()` | `GET /cachemanager/settings` |
| `updateCacheSetting(setting, value)` | `PUT /cachemanager/settings` |
| `reloadCacheSettings()` | `POST /cachemanager/settings/reload` |
| `fetchCacheLogLevel()` | `GET /cachemanager/status/logLevel` |
| `setCacheLogLevel(level)` | `PUT /cachemanager/status/logLevel` |
| `fetchCacheDbLoggerStatus()` | `GET /cachemanager/dbLogger` |
| `setCacheDbLoggerStatus(enable)` | `PUT /cachemanager/dbLogger/on\|off` |
| `fetchCacheCommunicationChannels()` | `GET /cachemanager/status/communicationChannels` |
| `updateCacheCommunicationChannels(payload)` | `PUT /cachemanager/status/communicationChannels` |

Pattern identico replicato per `scheduler` e altri microservizi dove necessario.

### `fundamentals.ts` — Dati finanziari (FMP)

Raccoglie tutti gli endpoint FMP esposti via proxy dal backend. Usato dalla pagina dettaglio ticker.

Tipologie di dati: income statement, balance sheet, cash flow, financial scores, enterprise values, key metrics, ratios, revenue segmentation (per prodotto e area geografica), news, historical prices, owner earnings.

---

## WebSocket (`src/services/ws/redisWsBridgeClient.ts`)

Singleton che mantiene la connessione verso `redis-ws-bridge`.

### Configurazione

```ts
const WS_URL = env.apiBaseUrl
  .replace('https://', 'wss://')
  .replace('http://', 'ws://')
  + '/redis-ws-bridge/ws';
```

### API

```ts
// Avvia/ferma connessione
redisWsBridgeClient.start()
redisWsBridgeClient.stop()

// Subscribe a messaggi
const unsubscribe = redisWsBridgeClient.subscribe({
  filter?: (msg: unknown) => boolean,   // Filtro opzionale
  onMessage: (msg: unknown) => void,
  onStatus?: (status: WsStatus, detail?: string) => void,
});
unsubscribe(); // Al cleanup del componente

// Monitoring
redisWsBridgeClient.onStatus((status, detail) => void)
redisWsBridgeClient.getHealth()  // { status, lastError, lastConnectedAt, reconnectCount }
redisWsBridgeClient.getLogs()    // Array<{ ts, level, message }> — ultimi 50
```

### Comportamento auto-reconnect

| Tentativo | Attesa |
|---|---|
| 1 | 1s |
| 2 | 2s |
| 3 | 4s |
| ... | raddoppio |
| N | max 30s |

La connessione si chiude con un ritardo di 800ms dall'ultimo `unsubscribe()` per evitare thrashing in caso di re-render rapidi.

---

## Hook custom (`src/hooks/`)

### `useHashRouter`
Vedi documentazione completa in [Architettura e routing](./frontend-architettura.md).

### `useReleaseInfo`

```ts
const release = useReleaseInfo();
// Ritorna: { version?, lastUpdate?, microservice?, note?: string[] }
// Source: GET /release.json
```

---

## Utility pure (`src/utils/`)

### `routing.ts` — Hash routing utilities

```ts
cleanHash(hash)            // "#/dashboard/tickers" → "dashboard/tickers"
getHashParts(hash)         // → ["dashboard", "tickers"]
getCurrentHash()           // window.location.hash
navigate(path)             // window.location.hash = path
getRouteId(hash)           // → RouteId
getPermissionKey(hash)     // → "dashboard/tickers"
matchRoute(hash, pattern)  // Glob: "dashboard/*" matches "dashboard/tickers"
getMicroserviceSlug(hash)  // "#/admin/microservice/cachemanager" → "cachemanager"
getTickerSymbol(hash)      // "#/dashboard/tickers/AAPL" → "AAPL"
getUserSettingsTab(hash)   // "#/dashboard/user-settings/filters" → "filters"
```

### `storage.ts` — localStorage helpers

```ts
readStorage(key)                    // → string | null
writeStorage(key, value)            // → void
readStorageJson<T>(key, fallback)   // → T (parse JSON con fallback)
writeStorageJson<T>(key, value)     // → void (serialize JSON)
```

**Chiavi usate dall'app:**

| Chiave | Contenuto |
|---|---|
| `astraai:auth:token` | JWT token |
| `astraai:auth:username` | Username (remember me) |
| `astraai:auth:clientNavigation` | Cache nav entries |
| `astraai:sidebar:collapsed` | Stato sidebar (true/false) |

### `textResolver.ts` — Resolver placeholder dinamici

Risolve placeholder nella forma `[[espressione]]` all'interno di stringhe di testo. Usato principalmente per i parametri dei job scheduler.

**Placeholder supportati:**

| Placeholder | Valore prodotto |
|---|---|
| `[[today]]` | Data odierna `YYYY-MM-DD` |
| `[[today,DD/MM/YYYY]]` | Data con formato custom |
| `[[today+3]]` | Oggi + 3 giorni |
| `[[today-7,DD-MM-YYYY]]` | Offset + formato |
| `[[yesterday]]` | Ieri |
| `[[tomorrow]]` | Domani |
| `[[now]]` | ISO datetime corrente |
| `[[now,YYYY-MM-DD HH:mm:ss]]` | Datetime con formato custom |
| `[[lastBusinessDay]]` | Ultimo giorno lavorativo |
| `[[lastBusinessDay-5]]` | 5 giorni lavorativi fa |
| `[[timestamp]]` | Unix seconds |
| `[[uuid]]` | UUID v4 random |
| `[[chiave]]` | Variabile dal dizionario `vars` passato al resolver |

```ts
resolveText(text: string, vars?: Record<string, string>, options?) → string
```
