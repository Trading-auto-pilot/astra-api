---
sidebar_position: 11
---

# datahubAdapter.js

## Utilizzo nei microservizi

[alertingService](./ms-alertingservice), [authService](./ms-authservice), [cacheManager](./ms-cachemanager), [scheduler](./ms-scheduler), [serviceControlPlane](./ms-servicecontrolplane), [tickerScanner](./ms-tickerscanner).

## Funzioni e utilizzo

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `adaptDatahubResponse(response, options)` | `response axios; options mapping` | [alertingService](./ms-alertingservice), [authService](./ms-authservice), [cacheManager](./ms-cachemanager), [scheduler](./ms-scheduler), [serviceControlPlane](./ms-servicecontrolplane), [tickerScanner](./ms-tickerscanner) |
| `createDatahubAdapter(axiosInstance, options)` | `istanza axios + opzioni adapter` | [alertingService](./ms-alertingservice), [authService](./ms-authservice), [cacheManager](./ms-cachemanager), [scheduler](./ms-scheduler), [serviceControlPlane](./ms-servicecontrolplane), [tickerScanner](./ms-tickerscanner) |
| `convertPathToDatahub(path)` | `path originale servizio` | [alertingService](./ms-alertingservice), [authService](./ms-authservice), [cacheManager](./ms-cachemanager), [scheduler](./ms-scheduler), [serviceControlPlane](./ms-servicecontrolplane), [tickerScanner](./ms-tickerscanner) |

## Dettaglio funzioni

### `adaptDatahubResponse(response, options)`

- Cosa fa: Normalizza il formato risposta datahub in shape coerente per i servizi.
- Parametri: `response axios; options mapping`

### `createDatahubAdapter(axiosInstance, options)`

- Cosa fa: Avvolge axios con interceptor/normalizzazioni datahub automatiche.
- Parametri: `istanza axios + opzioni adapter`

### `convertPathToDatahub(path)`

- Cosa fa: Converte path legacy/servizio verso path datahub compatibile.
- Parametri: `path originale servizio`

## Percorso

- `trading-system/shared/datahubAdapter.js`
