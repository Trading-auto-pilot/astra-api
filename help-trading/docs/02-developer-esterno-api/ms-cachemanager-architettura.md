---
sidebar_position: 1
---

# Architettura e flussi cache

## Modello logico

Il servizio usa una pipeline gerarchica:

1. `L3 Redis`: lookup per chiave `candles:{symbol}:{tf}`.
2. `L2 File`: lookup su file mensili `cache/{SYMBOL}/YYYY-MM_tf.json`.
3. `L1 Provider`: fetch remoto da `FMP`, `ALPACA` o `IBKR`.

Se manca un intervallo:

- legge prima da L2;
- per il delta mancante chiama il provider;
- salva i risultati in L2 e poi in L3.

## Ingress e sicurezza

- ingresso esterno via Traefik su `/cachemanager/*`;
- middleware: `stripPrefix + CORS + auth-forward`;
- i microservizi interni richiamano `cachemanager` via `CACHEMANAGER_URL`.

## Dipendenze runtime

- `datahub` (`DATAHUB_URL`/`DBMANAGER_URL`) per settings e log;
- `redis` come bus + cache L3;
- provider esterni per storico mercato.

## Persistenza L2

La cache su file e salvata in `/app/cache`, montata su volume Docker:

- `cachemanager_data:/app/cache`

Questo rende la cache file persistente anche dopo restart del container.
