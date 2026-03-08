---
sidebar_position: 13
---

# datahub - Endpoint Interni (Refresh/Reload)

Questi endpoint servono a introspezione e ricarica schema/route.

## Endpoint principali

- `GET /api/schema`
  Restituisce tabelle/viste caricate, route manuali e metadata refresh.

- `POST /api/refresh`
  Rilegge lo schema dal DB, sincronizza `__caching` e rigenera route dinamiche + manuali.

## Endpoint cache per tabella

- `GET /api/caching`
- `GET /api/caching/{tableName}`
- `PUT /api/caching/{tableName}`

Permettono di leggere/aggiornare configurazioni cache per singola tabella.

## Endpoint standard servizio (framework)

Ereditati da `serverFactory` / `BaseService`:

- `GET /status/health`
- `GET /status/info`
- `POST /settings/reload` (endpoint standard servizio, non rigenera lo schema tabelle)

Nota importante:

- per ricaricare **tabelle/route dinamiche** usare `POST /api/refresh`.
- `POST /settings/reload` riguarda la configurazione servizio, non la discovery schema.
