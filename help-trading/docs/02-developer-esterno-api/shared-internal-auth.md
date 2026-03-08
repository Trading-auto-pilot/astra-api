---
sidebar_position: 10
---

# internalAuth.js

## Utilizzo nei microservizi

[brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [decision-engine](./ms-decision-engine), [scheduler](./ms-scheduler), [tickerScanner](./ms-tickerscanner).

## Funzioni e utilizzo

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `signInternalToken(payload, options)` | `payload claim tecnici; options issuer/audience/ttl/privateKey` | [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [decision-engine](./ms-decision-engine), [scheduler](./ms-scheduler), [tickerScanner](./ms-tickerscanner) |
| `verifyInternalToken(token, options)` | `token + options issuer/audience/scope/publicKey` | [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [decision-engine](./ms-decision-engine), [scheduler](./ms-scheduler), [tickerScanner](./ms-tickerscanner) |

## Dettaglio funzioni

### `signInternalToken(payload, options)`

- Cosa fa: Firma token JWT interno per chiamate service-to-service.
- Parametri: `payload claim tecnici; options issuer/audience/ttl/privateKey`

### `verifyInternalToken(token, options)`

- Cosa fa: Verifica token interno e ritorna payload validato.
- Parametri: `token + options issuer/audience/scope/publicKey`

## Percorso

- `trading-system/shared/internalAuth.js`
