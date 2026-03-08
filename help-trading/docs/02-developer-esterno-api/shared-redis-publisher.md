---
sidebar_position: 8
---

# redisPublisher.js

## Utilizzo nei microservizi

[DBManager (legacy)](./ms-datahub).

## Funzioni e utilizzo

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `publishCommand(message, channel="commands")` | `message: payload; channel opzionale` | [DBManager (legacy)](./ms-datahub) |

## Dettaglio funzioni

### `publishCommand(message, channel="commands")`

- Cosa fa: Pubblica comandi semplici su Redis senza usare RedisBus completo.
- Parametri: `message: payload; channel opzionale`

## Percorso

- `trading-system/shared/redisPublisher.js`
