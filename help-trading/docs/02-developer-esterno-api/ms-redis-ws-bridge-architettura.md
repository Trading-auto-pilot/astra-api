---
sidebar_position: 1
---

# Architettura e flussi

## Flusso dati

1. Il bridge apre subscription Redis (`psubscribe`) sui pattern configurati (`REDIS_PATTERNS`).
2. Ogni messaggio ricevuto viene normalizzato con `__channel`.
3. Il `wsHub` valuta i filtri per ciascun client WS.
4. I messaggi compatibili vengono inviati al client (eventualmente aggregati/throttled).

## Canale WebSocket

- endpoint WS: `/ws`
- ogni client puo impostare filtri via query string:
- `topics`, `symbols`, `types`
- opzioni di aggregazione: `aggregate` e `rateMs`

Esempio:

- `/ws?topics=DEV.market-data-service.data&symbols=AAPL,MSFT&types=tick&aggregate=lastPerSymbol&rateMs=200`

## Filtri e aggregazioni

Implementati in `pipeline.js`:

- `buildFilter`: filtro per topic/symbol/type;
- `makeThrottler`: invio a frequenza ridotta;
- `makeLastPerKey`: ultimo evento per chiave (es. simbolo);
- `makeTickToBar1s`: aggregazione tick -> barra 1s.

## Integrazione con altri servizi

- fonte dati: Redis Bus dei microservizi (es. `market-data-service`, `decision-engine`, ecc.);
- consumer: frontend o servizi realtime che leggono via WS.

## Integrazione con datahub

- settings runtime caricati via `DATAHUB_URL`/`DBMANAGER_URL`;
- log persistiti su datahub tramite logger shared.
