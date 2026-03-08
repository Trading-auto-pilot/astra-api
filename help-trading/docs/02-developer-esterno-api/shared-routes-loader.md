---
sidebar_position: 12
---

# routes-loader.js

## Utilizzo nei microservizi

[DBManager (legacy)](./ms-datahub).

## Funzioni e utilizzo

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `mountRoutesFrom(app, options)` | `app express + options (routesDir, baseUrl, factoryArgs, depth, logger)` | [DBManager (legacy)](./ms-datahub) |

## Dettaglio funzioni

### `mountRoutesFrom(app, options)`

- Cosa fa: Carica e monta automaticamente route Express da una directory.
- Parametri: `app express + options (routesDir, baseUrl, factoryArgs, depth, logger)`

## Percorso

- `trading-system/shared/routes-loader.js`
