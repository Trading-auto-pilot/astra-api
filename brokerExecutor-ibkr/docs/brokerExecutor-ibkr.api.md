# brokerExecutor-ibkr API

## Prerequisiti
- IBKR Gateway/Client Portal API raggiungibile (`IBKRGW_BASE_URL` o `IBKR_BASE_URL`).
- Account ID configurato (`IBKR_ACCOUNT_ID`).
- Chiave pubblica JWT interna configurata (`INTERNAL_JWT_PUBLIC_KEY`).
- Autenticazione gestita da Traefik forwardAuth (Bearer token standard, come gli altri microservizi).

## Endpoint

### GET `/positions`
Restituisce le posizioni aperte per l’account IBKR configurato.

```bash
curl -sS \
  -H "X-Internal-Token: <TOKEN>" \
  http://localhost:3003/positions
```

Risposta:

```json
{
  "items": [
    {
      "broker": "IBKR",
      "accountId": "U1234567",
      "conid": "265598",
      "symbol": "AAPL",
      "quantity": 10,
      "avgPrice": 190.25,
      "marketPrice": 194.8,
      "marketValue": 1948,
      "currency": "USD"
    }
  ],
  "count": 1
}
```

### GET `/orders`
Restituisce ordini attivi/open normalizzati.

```bash
curl -sS \
  -H "Authorization: Bearer <TOKEN>" \
  http://localhost:3003/orders
```

Risposta:

```json
{
  "items": [
    {
      "orderId": "12345",
      "broker": "IBKR",
      "status": "WORKING",
      "symbol": "AAPL",
      "side": "BUY",
      "type": "LIMIT",
      "quantity": 10,
      "limitPrice": 195.5,
      "stopLossPrice": 191,
      "takeProfitPrice": 202,
      "tif": "DAY"
    }
  ],
  "count": 1
}
```

### POST `/order`
Inserisce un BUY LIMIT con bracket SL/TP.

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  http://localhost:3003/order \
  -d '{
    "symbol":"AAPL",
    "quantity":10,
    "limitPrice":195.5,
    "stopLossPrice":191,
    "takeProfitPrice":202,
    "timeInForce":"DAY",
    "externalCorrelationId":"de-run-20260216-001",
    "decisionEngineRunId":"run-001"
  }'
```

Risposta:

```json
{
  "order": {
    "orderId": "12345",
    "broker": "IBKR",
    "status": "WORKING",
    "symbol": "AAPL",
    "side": "BUY",
    "type": "LIMIT",
    "quantity": 10,
    "limitPrice": 195.5,
    "stopLossPrice": 191,
    "takeProfitPrice": 202,
    "tif": "DAY",
    "externalCorrelationId": "de-run-20260216-001",
    "decisionEngineRunId": "run-001"
  }
}
```

Note:
- Idempotenza su `externalCorrelationId` (default 6 ore): se duplicato ritorna l’ordine già creato con `idempotent: true`.

### PUT `/order/:orderId`
Aggiorna solo SL/TP di un ordine esistente.

```bash
curl -sS -X PUT \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  http://localhost:3003/order/12345 \
  -d '{
    "stopLossPrice":192,
    "takeProfitPrice":204,
    "reason":"trail update",
    "decisionEngineRunId":"run-002"
  }'
```

Risposta:

```json
{
  "order": {
    "orderId": "12345",
    "broker": "IBKR",
    "status": "WORKING",
    "symbol": "AAPL",
    "side": "BUY",
    "type": "LIMIT",
    "quantity": 10,
    "limitPrice": 195.5,
    "stopLossPrice": 192,
    "takeProfitPrice": 204
  }
}
```

## Errori comuni
- `400`: payload invalido.
- `403`: token interno mancante/non valido.
- `404`: ordine non trovato.
- `409`: update bracket non supportato/coerente.
- `503`: IBKR gateway non raggiungibile.

## Troubleshooting
- Se `SYMBOL_NOT_FOUND`: verificare simbolo e disponibilità su endpoint secdef.
- Se `IBKR_UNAVAILABLE`: verificare connettività tra container e IBKR gateway.
- Se update SL/TP fallisce: verificare che gli ordini child bracket siano presenti e modificabili via API.
