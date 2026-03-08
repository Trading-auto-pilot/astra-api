---
sidebar_position: 2
---

# capital-manager — Endpoint dettagliati

Prefisso: `/allocation` (porta interna `3010`).

---

## POST /allocation/quote

Calcola il capitale massimo investibile per un segnale di acquisto.

**Request body:**

```json
{
  "userId": 7,
  "symbol": "AAPL",
  "market": "US",
  "currency": "USD",
  "side": "BUY",
  "priceHint": 182.40,
  "strategyType": "breakout",
  "clientRequestId": "de-live-AAPL-breakout-1709560800000"
}
```

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `userId` | number | ✓ | ID utente |
| `symbol` | string | ✓ | Simbolo ticker |
| `market` | string | | Default `"US"` |
| `currency` | string | | Default `"USD"` |
| `side` | string | | Default `"BUY"` |
| `priceHint` | number\|null | | Prezzo stimato (usato per stimare notional ordini aperti senza prezzo) |
| `strategyType` | string | | Tipo strategia (informativo) |
| `clientRequestId` | string | ✓ | Chiave idempotency |

**Response (ok):**

```json
{
  "ok": true,
  "decision": {
    "symbol": "AAPL",
    "market": "US",
    "maxInvestable": 3240.50,
    "reservedCashPct": 0.35,
    "reservedCash": 1750.00,
    "riskRegime": "RISK_ON",
    "liquidityScore": 72,
    "confidence": 85,
    "volatility": 18.5,
    "constraints": {
      "cashAvailable": 5000.00,
      "openOrdersReserved": 9.50,
      "reservationsReserved": 0
    },
    "reasons": [
      "score=72 → base=0.340",
      "volatility=18.5 / volScale=100 → +0.019",
      "clamped to [0.20, 0.85] → 0.350"
    ],
    "usedFallback": false,
    "ts": "2026-03-05T14:32:00.000Z"
  }
}
```

**Response (ko — capitale insufficiente):**

```json
{
  "ok": false,
  "decision": { ... },
  "error": {
    "code": "INSUFFICIENT_CAPITAL",
    "message": "maxInvestable 12.5 is below minimum order notional 50",
    "details": { "maxInvestable": 12.5, "minOrderNotional": 50 }
  }
}
```

**Status codes:** `200 OK`, `400` parametri mancanti, `422` capitale insufficiente, `500` errore interno.

---

## POST /allocation/reserve

Crea una prenotazione di capitale (idempotente per `userId + clientRequestId`).

**Request body:**

```json
{
  "userId": 7,
  "symbol": "AAPL",
  "market": "US",
  "currency": "USD",
  "amount": 3240.50,
  "clientRequestId": "de-live-AAPL-breakout-1709560800000"
}
```

**Response:**

```json
{
  "ok": true,
  "reservationId": "res_lp4k2_a3f1",
  "expiresAt": "2026-03-05T14:35:00.000Z",
  "amount": 3240.50,
  "reused": false
}
```

`reused: true` se la prenotazione era già esistente (idempotency).

**Status codes:** `201 Created` (nuova), `200 OK` (riutilizzata), `400`, `500`.

---

## POST /allocation/release

Rilascia una prenotazione.

**Request body:**

```json
{
  "reservationId": "res_lp4k2_a3f1",
  "userId": 7,
  "reason": "order_filled"
}
```

**Response:**

```json
{ "ok": true }
```

**Status codes:** `200 OK`, `400` parametri mancanti, `404` prenotazione non trovata o scaduta, `500`.

---

## GET /allocation/reservations?userId=7

Elenca le prenotazioni attive per un utente.

**Response:**

```json
{
  "ok": true,
  "data": [
    {
      "reservationId": "res_lp4k2_a3f1",
      "userId": 7,
      "symbol": "AAPL",
      "market": "US",
      "currency": "USD",
      "amount": 3240.50,
      "clientRequestId": "de-live-AAPL-breakout-1709560800000",
      "expiresAt": "2026-03-05T14:35:00.000Z"
    }
  ]
}
```

**Status codes:** `200 OK`, `400` userId mancante, `500`.

---

## Endpoint standard (ereditati da BaseService + serverFactory)

- `GET /release` — versione servizio
- `GET /settings` — settings attuali
- `PUT /settings` — aggiorna setting in cache
- `POST /settings/reload` — ricarica settings da DB
- `PUT /connect` — avvia connessione live (non applicabile)
- `DELETE /connect` — chiude connessione live (non applicabile)
- `GET /dbLogger` — stato logging su DB
- `PUT /dbLogger/:status` — abilita/disabilita logging su DB

## Endpoint status

Prefisso: `/status`

- `GET /status/health`
- `GET /status/info`
- `GET /status/metrics`
- `GET /status/logLevel`
- `PUT /status/logLevel`
- `GET /status/communicationChannels`
- `PUT /status/communicationChannels`
