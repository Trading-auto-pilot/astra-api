---
sidebar_position: 6
---

# Frontend — Pagine e sezioni applicative

Le pagine si trovano in `src/components/pages/`. Il routing è hash-based; `DashboardPage` funge da switch interno per tutte le sotto-pagine del dashboard e dell'area admin.

---

## Pagine pubbliche (landing)

### `Homepage` — `#/landing`
Landing page principale. Visualizza le release info del sistema e link a login/contact.

### `Contact` — `#/contact`
Form contatti.

### `LandingFAQ`
FAQ pubblica.

### `Maintenance` — `#/maintenance`
Pagina di manutenzione programmata. Visualizzata automaticamente quando il sistema è in modalità manutenzione.

### `ComingSoon`
Placeholder per funzionalità in arrivo.

### `NotFound` — `#/404`
Pagina 404 per route non riconosciute o accessi non autorizzati.

---

## Autenticazione

### `LoginPage` — `#/login`

Form login con:
- Username e password
- Checkbox "Ricordami" (persiste username in localStorage)
- **Force password reset flow**: se il backend risponde con `requires_password_reset = true`, l'utente deve impostare una nuova password prima di accedere

---

## Dashboard utente

### `DashboardPage` — `#/dashboard`, `#/overview`

Switch principale. Non ha UI propria, ma:
- Legge il hash corrente e renderizza la sub-pagina corretta
- Gestisce il monitoraggio WebSocket (health gateway IBKR, market data)
- Gestisce la selezione account IBKR

### `TickersPage` — `#/dashboard/tickers`

Pagina principale dei ticker. Funzionalità:
- Listing ticker con score, settore, industria
- Ricerca per simbolo
- Filtri e ordinamento
- Modal di dettaglio ticker con tab:

  | Tab | Contenuto |
  |---|---|
  | `TickerDetailTab` | Dati fondamentali, score complessivo |
  | `TickerChartTab` | Grafico storico prezzi |
  | `TickerAnalysisTab` | Analisi tecnica e indicatori |
  | `TickerStatementTab` | Income statement / balance sheet |
  | `TickerFinancialReportTab` | Report finanziario completo |
  | `TickerRatiosTab` | Ratios finanziari |
  | `TickerNewsTab` | Notizie recenti |
  | `TickerSegmentationTab` | Segmentazione ricavi (prodotto e area geografica) |

### `UserTickersPage` — `#/dashboard/user_tickers`

Lista ticker filtrata e ordinata in base alle preferenze personali dell'utente loggato (filtri, pesi, ordinamento configurati in UserSettingsPage).

### `UserSettingsPage` — `#/dashboard/user-settings`

Configurazione preferenze utente, organizzata in tab:

| Tab | Hash | Descrizione |
|---|---|---|
| `UserGeneralTab` | `.../general` | Impostazioni generali |
| `UserFiltersTab` | `.../filters` | Filtri personalizzati sui ticker (salvati su backend) |
| `UserOrderByTab` | `.../order` | Ordinamento personalizzato |
| `UserWeightsTab` | `.../weights` | Pesi per il calcolo del `total_score` |
| `UserScoresTab` | `.../scores` | Visualizzazione formula score applicata con i pesi correnti |

La tab `UserScoresTab` include `ScoreFormulaCard` e varie card info che spiegano come ogni componente dello score viene calcolato.

---

## Area admin

### `UsersPage` — `#/admin/users`

Gestione utenti del sistema. Funzionalità:
- Lista utenti con stato (attivo/disabilitato)
- Creazione nuovo utente
- Modifica dati utente
- Gestione permessi per pagina (quale hash l'utente può visitare)
- Gestione voci menu personalizzate (`clientNavigation`)

### `ApiKeysPage` — `#/admin/api_key`

Gestione API key. Funzionalità:
- Lista API key esistenti
- Creazione nuova API key
- Modifica label e scadenza
- Gestione permessi per API key (quali endpoint può chiamare)
- Cancellazione

### `SchedulerPage` — `#/admin/scheduler`

Gestione job schedulati. Funzionalità:
- Lista job con stato last run
- Visualizzazione Gantt dei job (`SvelteGanttChart`)
- Creazione job (cron expression, endpoint, payload, overrides)
- Modifica e cancellazione job
- Run manuale di un job con possibilità di override parametri
- Visualizzazione output dell'ultima esecuzione

### `LogsPage` — `#/admin/logs`

Viewer dei log di sistema (pagina stub, in sviluppo).

### `AlertsPage` — `#/admin/alerts`

Viewer degli alert configurati e delle notifiche (pagina stub, in sviluppo).

### `AdminMicroservicePage` — `#/admin/microservice`

Lista di tutti i microservizi del sistema con indicatore di stato health.

### `AdminMicroserviceDetailPage` — `#/admin/microservice/{slug}`

Pagina di dettaglio per ogni microservizio. Accessibile via `slug` (es. `cachemanager`, `tickerscanner`, `scheduler`).

Funzionalità:
- Tab **Generale**: versione, stato health, modalità DB log, log level
- Card **Communication Channels**: gestione canali Redis publish/subscribe del microservizio
- Card **Settings**: lettura e modifica impostazioni runtime via `GET/PUT /settings`
- Card **Data Provider**: configurazione provider dati (dove applicabile)
- Card **IBKR Bridge**: configurazione bridge IBKR (dove applicabile)
- Card **Logs**: ultimi log del microservizio

Ogni microservizio ha la sua page dedicata in `pages/microservices/`:

| File | Slug | Microservizio |
|---|---|---|
| `AlertingServiceMicroservicePage` | `alertingservice` | Alerting Service |
| `CachemanagerMicroservicePage` | `cachemanager` | Cache Manager |
| `DatahubMicroservicePage` | `datahub` | Datahub |
| `DbmanagerMicroservicePage` | `dbmanager` | DB Manager (legacy) |
| `DecisionEngineMicroservicePage` | `decision-engine` | Decision Engine |
| `IBKRKeepaliveMicroservicePage` | `ibkr-keepalive` | IBKR Keepalive |
| `IbkrBridgeMicroservicePage` | `ibkr-bridge` | IBKR Bridge |
| `IbkrgwMicroservicePage` | `ibkrgw` | IBKR Gateway |
| `LiquidityManagerMicroservicePage` | `liquidity-manager` | Liquidity Manager |
| `MarketDataServiceMicroservicePage` | `market-data-service` | Market Data Service |
| `RedisWsBridgeMicroservicePage` | `redis-ws-bridge` | Redis WS Bridge |
| `SchedulerMicroservicePage` | `scheduler` | Scheduler |
| `ServiceControlPlaneMicroservicePage` | `servicecontrolplane` | Service Control Plane |
| `StrategyUtilsMicroservicePage` | `strategy-utils` | Strategy Utils |
| `BrokerExecutorIbkrMicroservicePage` | `broker-executor-ibkr` | Broker Executor IBKR |
| `TickerScannerMicroservicePage` | `tickerscanner` | Ticker Scanner |

### `TickerScannerAdminPage` — `#/admin/ticker-scanner`

Pagina dedicata alla gestione operativa del tickerScanner. Sezioni:

| Sezione | Funzionalità |
|---|---|
| **Scan Jobs** | Avvia scan standard o forzato; lista job attivi; cancellazione; storico job |
| **Market Daily** | Avvia job aggiornamento OHLCV storico da FMP; lista job attivi; storico |
| **User Daily Scores** | Avvia job ricalcolo score utente per data/pipe; lista job attivi; storico |
| **Momentum Refresh** | Pulsante per ricalcolare momentum su tutti i simboli |
| **Market Daily Compare** | Confronto dati market daily per data di riferimento |

### `StrategiesPage` — `#/admin/strategies`

Visualizzazione delle strategie di trading configurate (pagina in sviluppo).
