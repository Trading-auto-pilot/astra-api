---
sidebar_position: 1
title: Release 3.6.0 - 10/03/2026
---

# Release 3.6.0

- Data rilascio globale: `10/03/2026`
- Versione globale (frontend): `3.5.1`
- Fonte: `astraai/public/release.json`

## Riepilogo versioni componenti backend

| Componente | Versione | Data rilascio | Nota principale |
| --- | --- | --- | --- |
| `alertingService` | `2.1.3` | `10/03/2026` | v.2.1.3 Minor Fix |
| `authService` | `1.6.1` | `07/03/2026` | v.1.6.1 Aggiunta messaggi su canale HOOK per alerting più fix minori |
| `brokerExecutor-ibkr` | `1.0.0` | `07/03/2026` | Nessuna modifica in questa release |
| `cacheManager` | `2.4.2` | `11/03/2026` | 2.4.2 Fix per candele sui bordi |
| `capital-manager` | `1.0.1` | `11/03/2026` | v.1.0.1 Cambiata porta da 3010 a 3005 |
| `datahub` | `1.0.0` | `07/03/2026` | Nessuna modifica in questa release |
| `decision-engine` | `3.0.0` | `11/03/2026` | v.3.0.0 Interfaccia con market-simulator per simulazione mercato |
| `ibkr-bridge` | `1.1.0` | `07/03/2026` | Nessuna modifica in questa release |
| `ibkr-keepalive` | `1.0.1` | `12/02/2026` | Nessuna modifica in questa release |
| `ibkr-login-desktop` | `1.0.1` | `08/03/2026` | v.1.0.1 Vista iPad |
| `liquidity-manager` | `1.0.1` | `07/03/2026` | v.1.0.1 Add persistence on REDIS for 24h |
| `market-data-service` | `1.0.0` | `07/03/2026` | Nessuna modifica in questa release |
| `market-simulator` | `1.1.0` | `10/03/2026` | Data sources: cachemanager (default), file, Redis |
| `mcp-gateway` | `1.0.0` | `07/03/2026` | Nessuna modifica in questa release |
| `redisWsBridge` | `1.0.2` | `02/02/2026` | Nessuna modifica in questa release |
| `scheduler` | `1.4.7` | `10/03/2026` | v.1.4.7 Fix errore data ultimo run |
| `serviceControlPlane` | `2.0.0` | `08/03/2026` | Nessuna modifica in questa release |
| `tickerScanner` | `3.0.2` | `08/03/2026` | Nessuna modifica in questa release |
| `ibkr-clientgateway` | `1.1.0` | `12/02/2026` | Nessuna modifica in questa release |

## Modifiche rispetto alla 3.5.0

### alertingService
- Versione: `2.1.2`
- Data rilascio: `10/03/2026`
- Dettaglio modifiche:
  - v.2.1.2 Fix Data ultimo run

### decision-engine
- Versione: `2.0.2`
- Data rilascio: `08/03/2026`
- Dettaglio modifiche:
  - v.2.0.2 Fix entry on Pullback, didn't work

### scheduler
- Versione: `1.4.7`
- Data rilascio: `10/03/2026`
- Dettaglio modifiche:
  - v.1.4.6 Fix minori, aggiunta messaggi su canale HOOK per alerting
  - v.1.4.7 Fix errore data ultimo run

## Approfondimenti nuovi componenti (release 3.5.0)

- [ibkr-login-desktop: scopo e funzionamento](./release-3-5-0-ibkr-login-desktop)
- [serviceControlPlane: controllo runtime Docker (start/stop/restart)](./release-3-5-0-servicecontrolplane)
