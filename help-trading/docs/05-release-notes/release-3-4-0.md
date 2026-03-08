---
sidebar_position: 2
title: Release 3.4.0 - 07/03/2026
---

# Release 3.4.0

- Data rilascio globale: `07/03/2026`
- Versione globale (frontend): `3.4.0`
- Fonte: `astraai/public/release.json`

## Riepilogo versioni componenti backend

| Componente | Versione | Data rilascio | Nota principale |
| --- | --- | --- | --- |
| `alertingService` | `2.1.1` | `07/03/2026` | v.2.1.1 Fix minori |
| `authService` | `1.6.1` | `07/03/2026` | v.1.6.1 Aggiunta messaggi su canale HOOK per alerting piu fix minori |
| `brokerExecutor-ibkr` | `1.0.0` | `07/03/2026` | v.1.0.0 Initial release using BaseService |
| `cacheManager` | `2.4.1` | `07/03/2026` | 2.4.1 Aggiunta messaggi su canale HOOK per alerting piu fix minori |
| `capital-manager` | `1.0.0` | `07/03/2026` | v.1.0.0 Initial release using BaseService |
| `datahub` | `1.0.0` | `07/03/2026` | v.1.0.0 Initial release using. Refactoring completo del DBManager |
| `decision-engine` | `2.0.0` | `07/03/2026` | v.2.0.0 Verifica eventi a calendario prima di acquisto, richiamo capital-manager per capitale da investire. Fix invio ordini |
| `ibkr-bridge` | `1.1.0` | `07/03/2026` | v.1.1.0 Revisione gestione routes |
| `ibkr-keepalive` | `1.0.1` | `12/02/2026` | v.1.0.1 Fix general settings per impostazione logs |
| `liquidity-manager` | `1.0.0` | `07/03/2026` | v.1.0.0 Initial release using BaseService |
| `market-data-service` | `1.0.0` | `07/03/2026` | v.1.0.0 Initial release using BaseService |
| `mcp-gateway` | `1.0.0` | `07/03/2026` | v.1.0.0 Initial release using BaseService. Funziona solo in locale con Claud Desktop |
| `redisWsBridge` | `1.0.2` | `02/02/2026` | v.1.0.2 Dependency fix |
| `scheduler` | `1.4.6` | `12/02/2026` | v.1.4.6 Fix minori piu aggiunta messaggi su canale HOOK per alerting |
| `serviceControlPlane` | `1.0.1` | `24/12/2025 19:25` | v.1.0.1 aggiunto info microservice su user agent |
| `tickerScanner` | `3.0.0` | `07/03/2026` | v.3.0.0 Refactoring di calcolo (disabilitate pipe utente) |
| `ibkr-clientgateway` | `1.1.0` | `12/02/2026` | v.1.1.0 loop check connessione con invio su BUS Redis |

## Approfondimenti nuovi microservizi (release 3.4.0)

- [brokerExecutor-ibkr: scopo e funzionamento](./release-3-4-0-brokerexecutor-ibkr)
- [capital-manager: scopo e funzionamento](./release-3-4-0-capital-manager)
- [datahub: refactoring DBManager e API dinamiche](./release-3-4-0-datahub)
- [decision-engine: integrazione capital-manager e controlli calendario](./release-3-4-0-decision-engine)
- [liquidity-manager: scopo e funzionamento generale](./release-3-4-0-liquidity-manager)
- [mcp-gateway: versione iniziale MCP (solo Claud.ai Desktop)](./release-3-4-0-mcp-gateway)
- [tickerScanner: refactoring selezione ticker/ETF e pipe utente](./release-3-4-0-tickerscanner)

## Modifiche di dettaglio (per componente)

### alertingService
- Versione: `2.1.1`
- Data rilascio: `07/03/2026`
- Dettaglio modifiche:
  - v.0.1.0 alertingService: Initial scaffolding generated from template.
  - v.2.0.0 Refactoring completo creato da zero. Aggiunto invio Whatsapp e Rule Engine 
  - v.2.1.1 Fix minori

### authService
- Versione: `1.6.1`
- Data rilascio: `07/03/2026`
- Dettaglio modifiche:
  - v.1.0.0 auth: Initial scaffolding generated from template.
  - v.1.1.0 auth: Aggiunta log per debug login.
  - v.1.2.0 auth: Aggiunto modulo di autorizzazione
  - v.1.3.0 auth: Implementazione navigazione utente lato client
  - v.1.4.0 auth: Fix per utilizzo API_KEY
  - v.1.5.0 Inclusione delle informazioni di Peso per utente, aggiunto info microservice su user agent
  - v.1.6.0 Tocken auto extend su interazione. Session expire solo se non usata
  - v.1.6.1 Aggiunta messaggi su canale HOOK per alerting piu fix minori

### brokerExecutor-ibkr
- Versione: `1.0.0`
- Data rilascio: `07/03/2026`
- Dettaglio modifiche:
  - v.1.0.0 Initial release using BaseService

### cacheManager
- Versione: `2.4.1`
- Data rilascio: `07/03/2026`
- Dettaglio modifiche:
  - 0.1.0 cacheManager: Initial scaffolding generated from template.
  - 2.0.0 cacheManager: Refactoring con multiprovider FMT + ALPACA
  - 2.1.0 Supporto a multiple TAB in frontend. Cache L2 e L3
  - 2.1.1 Aggiunto info microservizio in user-agent
  - 2.2.0 Aggiunta del provider IBKR per dati storici
  - 2.3.0 Lettura contenuto file in cache L2, Hygiene sui file
  - 2.4.0 Refactoring completo fatto con Claud.ai, taglio su sole candele richieste
  - 2.4.1 Aggiunta messaggi su canale HOOK per alerting piu fix minori

### capital-manager
- Versione: `1.0.0`
- Data rilascio: `07/03/2026`
- Dettaglio modifiche:
  - v.1.0.0 Initial release using BaseService

### datahub
- Versione: `1.0.0`
- Data rilascio: `07/03/2026`
- Dettaglio modifiche:
  - v.1.0.0 Initial release using. Refactoring completo del DBManager

### decision-engine
- Versione: `2.0.0`
- Data rilascio: `07/03/2026`
- Dettaglio modifiche:
  - v.1.0.0 decision-engine: Initial scaffolding generated from template.
  - v.1.0.1 Fix API setLogLevel
  - v.1.1.0 Fix generl settings, Call API asincrone
  - v.2.0.0 Verifica eventi a calendario prima di acquisto, richiamo capital-manager per capitale da investire. Fix invio ordini

### ibkr-bridge
- Versione: `1.1.0`
- Data rilascio: `07/03/2026`
- Dettaglio modifiche:
  - v.1.0.0 ibkr-bridge: Initial scaffolding generated from template.
  - v.1.0.1 Fix general settings per scrittura logs
  - v.1.1.0 Revisione gestione routes

### ibkr-keepalive
- Versione: `1.0.1`
- Data rilascio: `12/02/2026`
- Dettaglio modifiche:
  - v.1.0.0 ibkr-keepalive: Initial scaffolding generated from template.
  - v.1.0.1 Fix general settings per impostazione logs

### liquidity-manager
- Versione: `1.0.0`
- Data rilascio: `07/03/2026`
- Dettaglio modifiche:
  - v.1.0.0 Initial release using BaseService

### market-data-service
- Versione: `1.0.0`
- Data rilascio: `07/03/2026`
- Dettaglio modifiche:
  - v.1.0.0 Initial release using BaseService

### mcp-gateway
- Versione: `1.0.0`
- Data rilascio: `07/03/2026`
- Dettaglio modifiche:
  - v.1.0.0 Initial release using BaseService. Funziona solo in locale con Claud Desktop

### redisWsBridge
- Versione: `1.0.2`
- Data rilascio: `02/02/2026`
- Dettaglio modifiche:
  - v.1.0.0 redis-ws-bridge: Initial scaffolding generated from template.
  - v.1.0.1 Fix general setting logs
  - v.1.0.2 Dependency fix

### scheduler
- Versione: `1.4.6`
- Data rilascio: `12/02/2026`
- Dettaglio modifiche:
  - v.0.1.0 scheduler: Initial scaffolding generated from template.
  - v.1.1.0 scheduler: Endpoint adapt to Traefik.
  - v.1.2.0 scheduler: Added Axios fix.
  - v.1.3.0 Gestione Ultimo run e stato
  - v.1.4.0 Implementazione endpoint LogLevel e DB Settings
  - v.1.4.0 Fix varie per adattamento esposizione in Frontend
  - v.1.4.2 Aggiunto info microservice su user agent, Flag isMarketopen per aggiornare solo quando mercato aperto
  - v.1.4.3 Fix errore visualizzazione Job disabilitati
  - v.1.4.4 Fix avvio solo Job abilitati and handling connessione Redis e DBManager
  - v.1.4.5 Fix Last status, Manual Run, Execution details
  - v.1.4.6 Fix minori piu aggiunta messaggi su canale HOOK per alerting

### serviceControlPlane
- Versione: `1.0.1`
- Data rilascio: `24/12/2025 19:25`
- Dettaglio modifiche:
  - v.1.0.0 serviceControlPlane: Initial scaffolding generated from template.
  - v.1.0.1 aggiunto info microservice su user agent

### tickerScanner
- Versione: `3.0.0`
- Data rilascio: `07/03/2026`
- Dettaglio modifiche:
  - v.0.1.0 tickerScanner: Initial scaffolding generated from template.
  - v.1.1.0 tickerScanner: Auto compilation test.
  - v.1.2.0 tickerScanner: axios fix
  - v.1.3.0 Esposizione Glossary
  - v.1.4.0 Creazione endpoint loglevel e db settings
  - v.1.5.0 Fix varie per adattamento frontend, gestione tabella ticker_fundamentals_history, aggiunto info microservice in user agent
  - v.2.0.0 Supporto per refactoring supporto liste utente e pipe id
  - v.2.1.0 Miglioramento Performance e implementazione storico Scan
  - v.2.1.1 Fix centralizzato log con JSON. Data update daily presa da timezon Job Scheduler 
  - v.2.2.0 Aggiunta log storici, puntamento a tabelle corrette 
  - v.2.2.1 Call API async, fix general setting
  - v.3.0.0 Refactoring di calcolo (disabilitate pipe utente)

### ibkr-clientgateway
- Versione: `1.1.0`
- Data rilascio: `12/02/2026`
- Dettaglio modifiche:
  - v.1.0.0 ibkr-clientgateway: Initial scaffolding generated from template.
  - v.1.1.0 loop check connessione con invio su BUS Redis
