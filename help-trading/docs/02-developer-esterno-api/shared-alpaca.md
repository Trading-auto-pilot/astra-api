---
sidebar_position: 17
---

# Alpaca.js

## Utilizzo nei microservizi

[DBManager (legacy)](./ms-datahub).

## Funzioni e utilizzo

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `new AlpacaApi()` | `-` | [DBManager (legacy)](./ms-datahub) |
| `init()` | `-` | [DBManager (legacy)](./ms-datahub) |
| `hasActiveOrder(symbol=null)` | `symbol opzionale` | [DBManager (legacy)](./ms-datahub) |
| `hasActivePosition(symbol=null)` | `symbol opzionale` | [DBManager (legacy)](./ms-datahub) |
| `refreshCacheActiveOrders()/refreshCacheActivePositions()` | `-` | [DBManager (legacy)](./ms-datahub) |
| `loadActiveOrders(filters)/loadActivePositions(symbol)` | `filtri ordine o symbol` | [DBManager (legacy)](./ms-datahub) |
| `placeOrder(...)` | `parametri ordine broker (symbol, qty, side, type, tif, prezzi, ...)` | [DBManager (legacy)](./ms-datahub) |
| `closePosition(symbol)` | `symbol` | [DBManager (legacy)](./ms-datahub) |
| `getAvailableCapital()` | `-` | [DBManager (legacy)](./ms-datahub) |

## Dettaglio funzioni

### `new AlpacaApi()`

- Cosa fa: Client singleton Alpaca con cache Redis interna.
- Parametri: `-`

### `init()`

- Cosa fa: Inizializza settings, endpoint Alpaca e connessione Redis locale.
- Parametri: `-`

### `hasActiveOrder(symbol=null)`

- Cosa fa: Verifica presenza ordini aperti (globale o per simbolo).
- Parametri: `symbol opzionale`

### `hasActivePosition(symbol=null)`

- Cosa fa: Verifica presenza posizioni aperte.
- Parametri: `symbol opzionale`

### `refreshCacheActiveOrders()/refreshCacheActivePositions()`

- Cosa fa: Forza refresh cache ordini/posizioni da API broker.
- Parametri: `-`

### `loadActiveOrders(filters)/loadActivePositions(symbol)`

- Cosa fa: Carica stato corrente da cache o da Alpaca API.
- Parametri: `filtri ordine o symbol`

### `placeOrder(...)`

- Cosa fa: Invia un ordine ad Alpaca con payload normalizzato.
- Parametri: `parametri ordine broker (symbol, qty, side, type, tif, prezzi, ...)`

### `closePosition(symbol)`

- Cosa fa: Chiude la posizione aperta su simbolo.
- Parametri: `symbol`

### `getAvailableCapital()`

- Cosa fa: Legge buying power/account capital disponibile.
- Parametri: `-`

## Percorso

- `trading-system/shared/Alpaca.js`
