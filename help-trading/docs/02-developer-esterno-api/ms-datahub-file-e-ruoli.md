---
sidebar_position: 3
---

# Implementazione per file

## Struttura tipica

- `datahub/server.js`
- `datahub/modules/main.js`
- `datahub/routes/*`
- `datahub/modules/*`

## Ruolo dei file

| File | Ruolo | Note implementative |
|---|---|---|
| `server.js` | Bootstrap HTTP | Monta route e endpoint standard. |
| `modules/main.js` | Runtime servizio | Lifecycle, settings, integrazione bus/cache. |
| `routes/*` | API layer | Validazione input e mapping verso moduli dominio. |
| `modules/*` | Business logic | Logica applicativa, adapter esterni, orchestrazione. |
