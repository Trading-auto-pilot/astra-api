---
sidebar_position: 4
---

# capital-manager — Configurazione

## Parametri operativi

| Parametro | Valore |
|---|---|
| Servizio | `capital-manager` |
| Porta interna | `3010` |
| Prefisso API | `/allocation` |
| Pattern bootstrap | `createMicroserviceServer` (serverFactory) |
| Pattern classe | `CapitalManager extends BaseService` |

## Variabili chiave

- `DATAHUB_URL` (o fallback `DBMANAGER_URL`) — DB settings
- `REDIS_URL` — prenotazioni + bus eventi
- `IBKR_BRIDGE_URL` — cash disponibile + ordini aperti
- `LIQUIDITY_MANAGER_URL` — risk score macro
- `RESERVATION_TTL_SEC` — scadenza prenotazioni
- `FALLBACK_RESERVED_CASH_PCT` — buffer conservativo se confidenza bassa

## Formula completa

```
# Caso confidenza < CONFIDENCE_THRESHOLD (69):
reservedCashPct = FALLBACK_RESERVED_CASH_PCT (0.60)

# Caso confidenza sufficiente:
base = SCORE_RESERVED_MAX (0.70) - (score / 100) × (SCORE_RESERVED_MAX - SCORE_RESERVED_MIN)
if riskRegime == "OFF":
    base += RISK_OFF_ADD_PCT (0.10)
base += clamp(volatility / VOL_SCALE, 0, VOL_ADD_MAX_PCT)
reservedCashPct = clamp(base, SCORE_RESERVED_MIN (0.20), 0.85)

# Capitale investibile:
reservedCash   = cashAvailable × reservedCashPct
maxInvestable  = cashAvailable
               - reservedCash
               - reservationsReserved
               - openOrdersReserved
```

## Pattern dipendenze esterne

Tutte le dipendenze esterne usano HTTP nativo (no axios), con timeout configurabile e gestione fail-soft:

```javascript
// adapters usa http/https built-in
// timeout configurabile via IBKR_ADAPTER_TIMEOUT_MS / LIQUIDITY_ADAPTER_TIMEOUT_MS
// tutti gli errori vengono loggati come warning, non propagati
```

## Pattern Redis

Le prenotazioni usano `bus.get/set/del` per operazioni CRUD e `bus.pub.scanIterator()` per listing:

```javascript
// Chiavi Redis:
`capital:reservations:${userId}:${reservationId}`         // TTL: RESERVATION_TTL_SEC
`capital:reservationIndex:${userId}:${clientRequestId}`   // TTL: RESERVATION_TTL_SEC
```

## curl di esempio

```bash
# Quote
curl -X POST http://localhost:3010/allocation/quote \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 7,
    "symbol": "AAPL",
    "market": "US",
    "clientRequestId": "test-001",
    "priceHint": 182.40
  }'

# Reserve
curl -X POST http://localhost:3010/allocation/reserve \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 7,
    "symbol": "AAPL",
    "market": "US",
    "amount": 3240.50,
    "clientRequestId": "test-001"
  }'

# Release
curl -X POST http://localhost:3010/allocation/release \
  -H "Content-Type: application/json" \
  -d '{ "reservationId": "res_lp4k2_a3f1", "userId": 7, "reason": "order_filled" }'

# List reservations
curl "http://localhost:3010/allocation/reservations?userId=7"
```
