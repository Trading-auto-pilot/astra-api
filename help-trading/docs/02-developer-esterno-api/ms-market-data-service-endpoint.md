---
sidebar_position: 2
---

# Endpoint dettagliati

## Endpoint subscriptions

Prefisso esterno: `/market-data-service`.

### `GET /market-data-service/subscriptions`

Ritorna lista ticker attualmente sottoscritti.

### `POST /market-data-service/subscriptions`

Aggiorna set completo ticker.

Body:

```json
{ "tickers": ["AAPL", "MSFT"] }
```

### `DELETE /market-data-service/subscriptions/:ticker`

Rimuove uno o piu ticker dalle sottoscrizioni.

- via path param (`:ticker`)
- oppure body `{"tickers":[...]}`.

### `POST /market-data-service/subscriptions/resubscribe`

Forza unsubscribe/subscribe su tutti i ticker correnti (utile dopo cambio fields/sessione).

## Endpoint fields market data

### `GET /market-data-service/fields`

Legge i campi market data correnti (da Redis o default).

### `POST /market-data-service/fields`

Imposta i campi market data e forza resubscribe.

Body:

```json
{ "fields": ["31", "84", "86"] }
```

## Endpoint IBKR e snapshot

### `GET /market-data-service/ibkr/status`

Stato connessione WS, auth/tickle HMDS e stato snapshot loop.

### `GET /market-data-service/snapshot/loop`

Stato loop snapshot (`running`, `intervalMs`, `lastSnapshotAt`).

### `POST /market-data-service/snapshot/loop`

Avvia loop snapshot con intervallo custom (`intervalMs >= 10000`), esegue anche fetch immediato.

### `DELETE /market-data-service/snapshot/loop`

Ferma loop snapshot.

### `PUT /market-data-service/snapshot/interval`

Aggiorna intervallo snapshot persistito (`intervalMs >= 60000`).

## Endpoint standard microservizio

- `GET /release`
- `GET /settings`
- `PUT /settings`
- `POST /settings/reload`
- `PUT /connect`
- `DELETE /connect`
- `GET /dbLogger`
- `PUT /dbLogger/:status`

## Endpoint status

Prefisso: `/status`.

- `GET /status/health`
- `GET /status/info`
- `GET /status/metrics`
- `GET /status/logLevel`
- `PUT /status/logLevel`
- `GET /status/communicationChannels`
- `PUT /status/communicationChannels`
