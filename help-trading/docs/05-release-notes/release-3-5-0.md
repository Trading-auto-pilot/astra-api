---
sidebar_position: 1
title: Release 3.5.0 - 08/03/2026
---

# Release 3.5.0

- Data rilascio globale: `08/03/2026`
- Versione globale (frontend): `3.5.0`
- Fonte: `astraai/public/release.json`

## Riepilogo versioni componenti backend

| Componente | Versione | Data rilascio | Nota principale |
| --- | --- | --- | --- |
| `alertingService` | `2.1.1` | `07/03/2026` | Nessuna modifica in questa release |
| `authService` | `1.6.1` | `07/03/2026` | Nessuna modifica in questa release |
| `brokerExecutor-ibkr` | `1.0.0` | `07/03/2026` | Nessuna modifica in questa release |
| `cacheManager` | `2.4.1` | `07/03/2026` | Nessuna modifica in questa release |
| `capital-manager` | `1.0.0` | `07/03/2026` | Nessuna modifica in questa release |
| `datahub` | `1.0.0` | `07/03/2026` | Nessuna modifica in questa release |
| `decision-engine` | `2.0.1` | `08/03/2026` | v.2.0.1 Minor Fix |
| `ibkr-bridge` | `1.1.0` | `07/03/2026` | Nessuna modifica in questa release |
| `ibkr-keepalive` | `1.0.1` | `12/02/2026` | Nessuna modifica in questa release |
| `ibkr-login-desktop` | `1.0.0` | `08/03/2026` | **NUOVO** — Login IBKR via desktop remoto VNC |
| `liquidity-manager` | `1.0.0` | `07/03/2026` | Nessuna modifica in questa release |
| `market-data-service` | `1.0.0` | `07/03/2026` | Nessuna modifica in questa release |
| `mcp-gateway` | `1.0.0` | `07/03/2026` | Nessuna modifica in questa release |
| `redisWsBridge` | `1.0.2` | `02/02/2026` | Nessuna modifica in questa release |
| `scheduler` | `1.4.6` | `12/02/2026` | Nessuna modifica in questa release |
| `serviceControlPlane` | `2.0.0` | `08/03/2026` | v.2.0.0 Abilitati controlli start/stop/restart servizi |
| `tickerScanner` | `3.0.2` | `08/03/2026` | v.3.0.1 Minor Fix scheduler run, v.3.0.2 Minor Fix |
| `ibkr-clientgateway` | `1.1.0` | `12/02/2026` | Nessuna modifica in questa release |

## Approfondimenti nuovi componenti (release 3.5.0)

- [ibkr-login-desktop: scopo e funzionamento](./release-3-5-0-ibkr-login-desktop)
- [serviceControlPlane: controllo runtime Docker (start/stop/restart)](./release-3-5-0-servicecontrolplane)

## Modifiche di dettaglio (per componente)

### decision-engine
- Versione: `2.0.1`
- Data rilascio: `08/03/2026`
- Dettaglio modifiche:
  - v.1.0.0 decision-engine: Initial scaffolding generated from template.
  - v.1.0.1 Fix API setLogLevel
  - v.1.1.0 Fix general settings, Call API asincrone
  - v.2.0.0 Verifica eventi a calendario prima di acquisto, richiamo capital-manager per capitale da investire. Fix invio ordini
  - v.2.0.1 Minor Fix

### ibkr-login-desktop
- Versione: `1.0.0`
- Data rilascio: `08/03/2026`
- Dettaglio modifiche:
  - v.1.0.0 Initial release using BaseService

### serviceControlPlane
- Versione: `2.0.0`
- Data rilascio: `08/03/2026`
- Dettaglio modifiche:
  - v.1.0.0 serviceControlPlane: Initial scaffolding generated from template.
  - v.1.0.1 aggiunto info microservice su user agent
  - v.2.0.0 Abilitati controlli start/stop/restart servizi via Docker socket

### tickerScanner
- Versione: `3.0.2`
- Data rilascio: `08/03/2026`
- Dettaglio modifiche:
  - v.3.0.0 Refactoring di calcolo (disabilitate pipe utente)
  - v.3.0.1 Minor Fix for scheduler run
  - v.3.0.2 Minor Fix
