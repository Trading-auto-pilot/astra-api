---
sidebar_position: 3
---

# Implementazione per file

## Struttura tipica

- `ibkr-keepalive/server.js`
- `ibkr-keepalive/modules/main.js`
- `ibkr-keepalive/routes/*`
- `ibkr-keepalive/modules/*`

## Ruolo dei file

| File | Ruolo | Note implementative |
|---|---|---|
| `server.js` | Bootstrap HTTP | Monta route e endpoint standard. |
| `modules/main.js` | Runtime servizio | Lifecycle, settings, integrazione bus/cache. |
| `routes/*` | API layer | Validazione input e mapping verso moduli dominio. |
| `modules/*` | Business logic | Logica applicativa, adapter esterni, orchestrazione. |
