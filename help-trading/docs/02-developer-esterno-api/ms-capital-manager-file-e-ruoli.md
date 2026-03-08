---
sidebar_position: 3
---

# capital-manager — Implementazione per file

## Struttura directory

```
capital-manager/
├── server.js                          # Bootstrap
├── routes.allocation.js               # Router REST /allocation
├── modules/
│   ├── main.js                        # CapitalManager (BaseService)
│   ├── allocation/
│   │   ├── decisionEngine.js          # Formula reservedCashPct + computeAllocationDecision
│   │   └── exposureCalculator.js      # Open orders reserved notional
│   ├── adapters/
│   │   ├── ibkrBridge.js              # HTTP client → ibkr-bridge
│   │   └── liquidityManager.js        # HTTP client → liquidity-manager
│   ├── store/
│   │   └── reservationsStore.js       # CRUD prenotazioni Redis
│   └── utils/
│       ├── clamp.js                   # clamp(value, min, max)
│       └── hash.js                    # generateReservationId()
├── Dockerfile
├── package.json
└── release.json
```

---

## Ruolo dei file

### `server.js`

Bootstrap minimale via `createMicroserviceServer`. Passa `buildAllocationRouter` come factory function — serverFactory la chiama con `{ logger, getService }` dopo l'init del servizio.

```javascript
createMicroserviceServer({
  ServiceClass: capitalManagerService,
  microservice: "capital-manager",
  defaultPort: 3010,
  routes: [
    { path: "/allocation", router: buildAllocationRouter, protected: true },
  ],
});
```

### `routes.allocation.js`

Router factory. Non contiene logica di business: delega tutto a `getService()` (istanza di `CapitalManager`). Gestisce: validazione parametri request, status code HTTP, serializzazione response.

### `modules/main.js` — `CapitalManager`

Estende `BaseService`. Metodi pubblici:
- `computeQuote(params)` — orchestra fetch + formula + risposta
- `createReservation(params)` — delega a store
- `releaseReservation(reservationId, userId, reason)` — delega a store
- `listReservations(userId)` — delega a store

### `modules/allocation/decisionEngine.js`

Funzioni pure, nessuna dipendenza I/O:
- `computeReservedCashPct(liquidity)` → `{ reservedCashPct, reasons, usedFallback }`
- `computeAllocationDecision({ cashAvailable, openOrdersReserved, reservationsReserved, liquidity, symbol, market, logger })` → `{ ok, decision, error }`

### `modules/allocation/exposureCalculator.js`

Funzione pura:
- `computeOpenOrdersReserved(openOrders, priceHint)` → `number`

Somma i notional degli ordini BUY aperti (`lmtPrice × totalQuantity`). Accetta `priceHint` come fallback se un ordine non ha prezzo.

### `modules/adapters/ibkrBridge.js`

HTTP client leggero (no axios, usa `http`/`https` Node built-in):
- `fetchAccountSummary()` → `{ cashAvailable, netLiq, buyingPower, currency }`
- `fetchPositions()` → `Array`
- `fetchOpenOrders()` → `Array`

Legge URL e path da env vars. Timeout configurabile via `IBKR_ADAPTER_TIMEOUT_MS`.

### `modules/adapters/liquidityManager.js`

HTTP client leggero:
- `fetchLiquidityScore(market)` → `{ score, riskRegime, volatility, confidence }`

Normalizza `riskRegime` anche da forme alternative (`"ON"` → viene passato così come viene; la formula verifica `"OFF"` vs qualsiasi altro valore).

### `modules/store/reservationsStore.js`

Accede a Redis tramite `bus` (istanza `RedisBus` di BaseService, `bus.pub` per SCAN):
- `createReservation(params, bus)` — idempotente su `clientRequestId`
- `releaseReservation(reservationId, userId, bus)` → `boolean`
- `listReservations(userId, bus)` → `Array`
- `getTotalReservedAmount(userId, bus)` → `number`

Usa `scanIterator` (node-redis v4) per il listing, evita `KEYS *` bloccante.

### `modules/utils/clamp.js`

```javascript
clamp(value, min, max) → Math.min(Math.max(value, min), max)
```

### `modules/utils/hash.js`

```javascript
generateReservationId() → "res_{timestamp_base36}_{4bytes_hex}"
```
