---
sidebar_position: 3
---

# Flusso Quote → Reservation → Release

Le **prenotazioni** sono il meccanismo che impedisce all'over-allocation di verificarsi quando più segnali si attivano contemporaneamente, e che garantisce che il capitale assegnato a un'operazione resti effettivamente disponibile fino all'invio dell'ordine.

---

## Il problema senza prenotazioni

Immagina 3 segnali che si attivano nello stesso secondo:

1. Segnale AAPL — quota richiesta: $3.000 su conto da $5.000
2. Segnale MSFT — quota richiesta: $3.000 sullo stesso conto da $5.000
3. Segnale NVDA — quota richiesta: $3.000 sullo stesso conto da $5.000

Senza prenotazioni, tutti e tre riceverebbero `maxInvestable ≈ $3.000` e il sistema invierebbe ordini per $9.000 su un conto da $5.000.

---

## Flusso completo in 3 passi

```text
┌─────────────────────────────────────────────────────────────┐
│  1. QUOTE    POST /allocation/quote                         │
│     → calcola maxInvestable tenendo conto di:               │
│       · cash disponibile e riserva liquidità                │
│       · ordini BUY già aperti                               │
│       · prenotazioni attive per questo userId               │
│       · limiti di concentrazione (ticker/settore/industria/ │
│         area geografica)                                     │
│                                                             │
│  2. RESERVE  POST /allocation/reserve                       │
│     → blocca maxInvestable in Redis per 180 secondi         │
│       Le quote successive dello stesso userId sottraggono   │
│       automaticamente questo importo                        │
│                                                             │
│  3. RELEASE  POST /allocation/release                       │
│     → libera la prenotazione dopo l'invio dell'ordine       │
│       (o scade automaticamente allo scadere del TTL)        │
└─────────────────────────────────────────────────────────────┘
```

---

## Passo 1 — Quote

**Endpoint:** `POST /allocation/quote`

**Richiesta:**
```json
{
  "userId": 7,
  "symbol": "MSFT",
  "market": "US",
  "clientRequestId": "de-live-MSFT-breakout-1709560800000"
}
```

| Campo | Obbligatorio | Descrizione |
|---|---|---|
| `userId` | ✓ | Identificativo dell'utente/strategia |
| `symbol` | ✓ | Ticker del simbolo (es. `MSFT`) |
| `clientRequestId` | ✓ | ID univoco della richiesta — usato anche per la reservation idempotente |
| `market` | — | Mercato (default: `US`) |
| `priceHint` | — | Prezzo indicativo per stimare il notional degli ordini aperti |

**Risposta (quota disponibile):**
```json
{
  "ok": true,
  "decision": {
    "maxInvestable": 2450.00,
    "reservedCashPct": 0.35,
    "reservedCash": 1750.00,
    "riskRegime": "RISK_ON",
    "liquidityScore": 72,
    "tickerInfo": {
      "sector": "Technology",
      "industry": "Software - Infrastructure",
      "area": "North America"
    },
    "concentrationDetail": {
      "ticker":   { "limit": 8133.49, "invested": 0,        "residual": 8133.49 },
      "sector":   { "name": "Technology",               "limit": 34567.34, "invested": 22000.00, "residual": 12567.34 },
      "industry": { "name": "Software - Infrastructure", "limit": 24400.48, "invested": 17000.00, "residual": 7400.48  },
      "area":     { "name": "North America",             "limit": 76251.49, "invested": 45000.00, "residual": 31251.49 }
    },
    "limitedBy": "MAX_INDUSTRY"
  }
}
```

**Risposta (capitale insufficiente):**
```json
{
  "ok": false,
  "error": {
    "code": "CONCENTRATION_LIMIT",
    "message": "maxInvestable 0 limited by MAX_SECTOR (below MIN_ORDER_NOTIONAL 50)"
  }
}
```

Se `ok: false`, **non procedere** con la reservation. I codici di errore possibili sono:

| Codice | Causa |
|---|---|
| `INSUFFICIENT_CAPITAL` | Cash disponibile esaurito dopo la riserva liquidità |
| `CONCENTRATION_LIMIT` | Limite di concentrazione (ticker/settore/industria/area) azzerato |

---

## Passo 2 — Reservation

**Endpoint:** `POST /allocation/reserve`

**Richiesta:**
```json
{
  "userId": 7,
  "symbol": "MSFT",
  "market": "US",
  "currency": "USD",
  "amount": 2450.00,
  "clientRequestId": "de-live-MSFT-breakout-1709560800000"
}
```

:::tip Usa lo stesso `clientRequestId` della quote
La reservation è **idempotente** sulla coppia `userId + clientRequestId`. Se la richiesta viene inviata due volte (es. retry su timeout di rete), il servizio restituisce la stessa prenotazione senza crearne una nuova.
:::

**Risposta (prima chiamata — 201 Created):**
```json
{
  "ok": true,
  "reservationId": "res_lp4k2_a3f1",
  "amount": 2450.00,
  "expiresAt": "2026-03-05T14:35:00.000Z",
  "reused": false
}
```

**Risposta (retry — 200 OK, stessa prenotazione):**
```json
{
  "ok": true,
  "reservationId": "res_lp4k2_a3f1",
  "amount": 2450.00,
  "expiresAt": "2026-03-05T14:35:00.000Z",
  "reused": true
}
```

Dalla creazione, la prenotazione:
- Scala automaticamente dal `maxInvestable` di ogni quota successiva per lo stesso `userId`
- Scade automaticamente dopo il TTL (default **180 secondi**, configurabile via `RESERVATION_TTL_SEC`)
- Va rilasciata esplicitamente non appena l'ordine è stato accettato dal broker

---

## Passo 3 — Release

**Endpoint:** `POST /allocation/release`

Chiamare questo endpoint appena l'ordine viene inviato al broker (o rifiutato). Questo restituisce il capitale bloccato al pool disponibile **immediatamente**, senza attendere la scadenza del TTL.

**Richiesta:**
```json
{
  "reservationId": "res_lp4k2_a3f1",
  "userId": 7,
  "reason": "order_placed"
}
```

| Campo | Obbligatorio | Descrizione |
|---|---|---|
| `reservationId` | ✓ | ID restituito da `POST /allocation/reserve` |
| `userId` | ✓ | Deve corrispondere all'userId con cui è stata creata |
| `reason` | — | Testo libero per il log (es. `order_placed`, `order_rejected`) |

**Risposta:**
```json
{ "ok": true }
```

Se la prenotazione non esiste (già scaduta o già rilasciata) → `404 NOT_FOUND`.

---

## Lifecycle di una prenotazione

```
POST /allocation/reserve
        │
        ▼
   [ACTIVE] ─── scadenza automatica (TTL 180s) ──→ [EXPIRED]
        │
        ▼ (ordine inviato/rifiutato)
POST /allocation/release
        │
        ▼
   [RELEASED]
```

La scadenza automatica è la rete di sicurezza: anche se il `decision-engine` non chiamasse `release` (es. crash), la prenotazione sparisce da sola e non blocca il capitale a tempo indeterminato.

---

## Visualizzare le prenotazioni attive

```http
GET /allocation/reservations?userId=7
```

**Risposta:**
```json
{
  "ok": true,
  "data": [
    {
      "reservationId": "res_lp4k2_a3f1",
      "userId": 7,
      "symbol": "MSFT",
      "market": "US",
      "currency": "USD",
      "amount": 2450.00,
      "clientRequestId": "de-live-MSFT-breakout-1709560800000",
      "expiresAt": "2026-03-05T14:35:00.000Z"
    }
  ]
}
```

---

## Chiavi Redis utilizzate

| Chiave | Contenuto | TTL |
|---|---|---|
| `capital:reservations:{userId}:{reservationId}` | Dati completi della prenotazione (JSON) | `RESERVATION_TTL_SEC` |
| `capital:reservationIndex:{userId}:{clientRequestId}` | Indice idempotency → punta a `reservationId` | `RESERVATION_TTL_SEC` |
