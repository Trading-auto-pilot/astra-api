---
sidebar_position: 16
---

# tradeDbHelpers.js

## Utilizzo nei microservizi

Nessun utilizzo diretto rilevato.

## Funzioni e utilizzo

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `tradeDbHelpers(dbManagerUrl)` | `dbManagerUrl: endpoint DB/[datahub](./ms-datahub)` | Nessun utilizzo diretto rilevato |
| `buildPositionFromOrder(order, strategy, context, bar)` | `dati ordine/strategia/contesto` | Nessun utilizzo diretto rilevato |
| `buildPositionFromClose(data, strategy, context, bar)` | `dati chiusura/strategia/contesto` | Nessun utilizzo diretto rilevato |
| `updateStrategies(order, strategy, additionalData)` | `ordine + strategia + extra` | Nessun utilizzo diretto rilevato |
| `insertOrder(orderRes)` | `payload ordine broker` | Nessun utilizzo diretto rilevato |
| `insertBuyTransaction(orderRes, strategy)` | `ordine BUY + strategia` | Nessun utilizzo diretto rilevato |

## Dettaglio funzioni

### `tradeDbHelpers(dbManagerUrl)`

- Cosa fa: Factory che restituisce utility CRUD dominio trade.
- Parametri: `dbManagerUrl: endpoint DB/datahub`

### `buildPositionFromOrder(order, strategy, context, bar)`

- Cosa fa: Costruisce e persiste posizione da evento BUY.
- Parametri: `dati ordine/strategia/contesto`

### `buildPositionFromClose(data, strategy, context, bar)`

- Cosa fa: Costruisce e persiste posizione da close manuale/forzato.
- Parametri: `dati chiusura/strategia/contesto`

### `updateStrategies(order, strategy, additionalData)`

- Cosa fa: Aggiorna stato strategia collegata all'ordine.
- Parametri: `ordine + strategia + extra`

### `insertOrder(orderRes)`

- Cosa fa: Inserisce ordine nel backend trade.
- Parametri: `payload ordine broker`

### `insertBuyTransaction(orderRes, strategy)`

- Cosa fa: Inserisce transazione BUY nello storico transazioni.
- Parametri: `ordine BUY + strategia`

## Percorso

- `trading-system/shared/tradeDbHelpers.js`
