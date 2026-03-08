---
sidebar_position: 1
---

# capital-manager — Architettura e flussi

## Componenti principali

- `server.js` — bootstrap via `createMicroserviceServer` (porta 3010);
- `modules/main.js` — `CapitalManager extends BaseService`; orchestrazione quote/reserve/release;
- `routes.allocation.js` — router Express factory `({ getService, logger }) → Router`;
- `modules/allocation/decisionEngine.js` — formula `reservedCashPct` e `computeAllocationDecision`;
- `modules/allocation/exposureCalculator.js` — calcolo notional ordini aperti;
- `modules/adapters/ibkrBridge.js` — fetch account summary + open orders;
- `modules/adapters/liquidityManager.js` — fetch risk score;
- `modules/store/reservationsStore.js` — CRUD prenotazioni su Redis;
- `modules/utils/clamp.js`, `modules/utils/hash.js` — utility.

## Flusso POST /allocation/quote

```
Client (decision-engine)
    │
    └─ POST /allocation/quote { userId, symbol, market, clientRequestId, ... }
                │
                ▼
    ┌───────────────────────────────────────────────────────┐
    │  Promise.allSettled([                                 │
    │    ibkrBridge.fetchAccountSummary()   → cashAvailable│
    │    liquidityManager.fetchLiquidityScore() → liquidity │
    │    ibkrBridge.fetchOpenOrders()       → openOrders   │
    │  ])                    (fail-soft: timeout 5s each)   │
    └───────────────────────────────────────────────────────┘
                │
                ▼
    reservationsStore.getTotalReservedAmount(userId)
                │
                ▼
    decisionEngine.computeAllocationDecision({
        cashAvailable, openOrdersReserved,
        reservationsReserved, liquidity,
        symbol, market
    })
                │
                ▼
    Response: { ok, decision: { maxInvestable, reservedCashPct, ... } }
```

## Flusso POST /allocation/reserve

```
Client
    │
    └─ POST /allocation/reserve { userId, symbol, amount, clientRequestId }
                │
                ▼
    reservationsStore.createReservation(...)
        ├─ Controlla indice Redis capital:reservationIndex:{userId}:{clientRequestId}
        ├─ Se esiste → restituisce prenotazione esistente (idempotente)
        └─ Se non esiste → genera reservationId, scrive su Redis con TTL
                │
                ▼
    Response: { ok, reservationId, expiresAt, amount, reused }
```

## Flusso POST /allocation/release

```
Client
    │
    └─ POST /allocation/release { reservationId, userId, reason }
                │
                ▼
    reservationsStore.releaseReservation(reservationId, userId)
        ├─ Legge capital:reservations:{userId}:{reservationId}
        ├─ Se non esiste → 404
        └─ Cancella chiave reservation + indice clientRequestId
                │
                ▼
    Response: { ok: true }
```

## Formula reservedCashPct

```
if confidence < CONFIDENCE_THRESHOLD (69):
    reservedCashPct = FALLBACK_RESERVED_CASH_PCT (0.60)
else:
    base = SCORE_RESERVED_MAX (0.70) - (score/100) × (SCORE_RESERVED_MAX - SCORE_RESERVED_MIN)
    if riskRegime == "OFF": base += RISK_OFF_ADD_PCT (0.10)
    base += clamp(volatility / VOL_SCALE, 0, VOL_ADD_MAX_PCT)
    reservedCashPct = clamp(base, SCORE_RESERVED_MIN, 0.85)

reservedCash   = cashAvailable × reservedCashPct
maxInvestable  = cashAvailable - reservedCash - reservationsReserved - openOrdersReserved
```

## Integrazione con decision-engine (Fase 7)

Il `decision-engine` chiama il `capital-manager` all'interno del blocco fire-and-forget dell'ordine:

```javascript
// decision-engine/modules/live-manager.js (fire-and-forget)
(async () => {
  // 1) PAPER guardrail
  // 2) Quote da capital-manager
  const resp = await httpGetJson(`${capitalManagerUrl}/allocation/quote`, { ... });
  const dollars = resp?.decision?.maxInvestable ?? 5000;
  const quantity = Math.max(1, Math.floor(dollars / entryLimit));
  // 3) POST ordine a broker-executor
})();
```

## Archiviazione Redis

| Chiave | TTL | Contenuto |
|---|---|---|
| `capital:reservations:{userId}:{reservationId}` | `RESERVATION_TTL_SEC` | JSON prenotazione completa |
| `capital:reservationIndex:{userId}:{clientRequestId}` | `RESERVATION_TTL_SEC` | Puntatore idempotency → `reservationId` |

Il SCAN delle chiavi usa `bus.pub.scanIterator()` (node-redis v4) per evitare `KEYS` bloccante.
