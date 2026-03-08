---
sidebar_position: 15
---

# textResolver.js

## Utilizzo nei microservizi

[scheduler](./ms-scheduler).

## Funzioni e utilizzo

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `resolveText(text, vars={}, opts={})` | `text template; vars placeholder; opts now/timezone` | [scheduler](./ms-scheduler) |
| `formatDate(date, format="YYYY-MM-DD")` | `date JS; formato output` | [scheduler](./ms-scheduler) |

## Dettaglio funzioni

### `resolveText(text, vars={}, opts={})`

- Cosa fa: Risoluzione placeholder dinamici in testo (date, variabili runtime).
- Parametri: `text template; vars placeholder; opts now/timezone`

### `formatDate(date, format="YYYY-MM-DD")`

- Cosa fa: Formatta date per placeholder e query runtime.
- Parametri: `date JS; formato output`

## Percorso

- `trading-system/shared/textResolver.js`
