---
sidebar_position: 1
---

# market-simulator

Il `market-simulator` è un microservizio che riproduce una sessione di mercato storica come se fosse live, restando completamente trasparente al resto del sistema. La sua funzione principale nella **Phase 1** è rispondere alle richieste di snapshot del decision-engine fornendo dati storici reali in luogo di dati IBKR live.

## Cosa fa

- Accetta una sessione di simulazione con `startDate`, `endDate` e timeframe configurabile.
- Riceve le sottoscrizioni di ticker dal decision-engine (stessa API di `market-data-service`).
- Ad ogni `tick` recupera le candele storiche dalla fonte configurata e le pubblica sul canale Redis `{ENV}.market-data-service.data` nel formato identico agli snapshot IBKR live.
- Espone un endpoint per recuperare una singola candela (ispezione e modifica dal frontend).
- Permette di iniettare candele personalizzate come snapshot (scenari specifici).
- Supporta sorgenti dati alternative: **cachemanager** (default), **file JSON locale**, **Redis**.

## Porta esposta

| Ambiente | Porta | URL interno |
|---|---|---|
| Docker | `3010` | `http://market-simulator:3010` |
| Locale | `3010` | `http://localhost:3010` |

## Dipendenze

| Servizio | Motivo |
|---|---|
| `cachemanager` | Fonte dati storica (candele OHLCV) |
| `Redis` | Pubblicazione snapshot sul canale market-data, storage sessione |
| `datahub` | Caricamento settings e logging |

## Variabili d'ambiente principali

| Variabile | Default | Note |
|---|---|---|
| `CACHEMANAGER_URL` | `http://cachemanager:3006` | Fonte dati candele storiche |
| `REDIS_URL` | — | Connessione Redis |
| `ENV` | `DEV` | Prefisso canali Redis |
| `LOG_LEVEL` | `info` | Livello log |
| `DATAHUB_URL` | — | Settings e DB logger |

## Sezioni

- [Architettura](./ms-market-simulator-architettura)
- [Endpoint](./ms-market-simulator-endpoint)
- [File e ruoli](./ms-market-simulator-file-e-ruoli)
- [Configurazione](./ms-market-simulator-configurazione)
- [Runbook](./ms-market-simulator-runbook)
