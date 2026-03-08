---
sidebar_position: 3
---


# datahub

Questa pagina e l'hub API del microservizio `datahub`.

## Endpoint disponibili

| Metodo | Path | Descrizione | Dettaglio |
|---|---|---|---|
| `GET` | `/datahub/api/schema` | Nessuno; ritorna schema caricato (tabelle, viste, route manuali). | [Apri](./datahub-endpoint-01-get-datahub-api-schema.md) |
| `POST` | `/datahub/api/refresh` | Nessuno; ricarica schema e rigenera endpoint dinamici. | [Apri](./datahub-endpoint-02-post-datahub-api-refresh.md) |
| `GET` | `/datahub/api/caching` | Nessuno; configurazioni cache per tabella. | [Apri](./datahub-endpoint-03-get-datahub-api-caching.md) |
| `GET` | `/datahub/api/caching/:tableName` | Path `tableName`; configurazione tabella specifica. | [Apri](./datahub-endpoint-04-get-datahub-api-caching-tablename.md) |
| `PUT` | `/datahub/api/caching/:tableName` | Path `tableName`; body `enabled` (bool), `ttl` (numero). | [Apri](./datahub-endpoint-05-put-datahub-api-caching-tablename.md) |
| `GET` | `/datahub/api/table/:tableName` | Query filtri + `limit` + `offset`; lista record tabella. | [Apri](./datahub-endpoint-06-get-datahub-api-table-tablename.md) |
| `GET` | `/datahub/api/table/:tableName/:pk...` | Path PK (anche composta); singolo record. | [Apri](./datahub-endpoint-07-get-datahub-api-table-tablename-pk.md) |
| `POST` | `/datahub/api/table/:tableName` | Body record da inserire. | [Apri](./datahub-endpoint-08-post-datahub-api-table-tablename.md) |
| `PUT` | `/datahub/api/table/:tableName/:pk...` | Path PK; body campi da aggiornare. | [Apri](./datahub-endpoint-09-put-datahub-api-table-tablename-pk.md) |
| `DELETE` | `/datahub/api/table/:tableName/:pk...` | Path PK; elimina record. | [Apri](./datahub-endpoint-10-delete-datahub-api-table-tablename-pk.md) |
| `ALL` | `/datahub/api/custom/*` | Route manuali registrate nel servizio (dipendono dal progetto). | [Apri](./datahub-endpoint-11-all-datahub-api-custom.md) |
| `GET` | `/datahub/auth/users` | Query opzionali; lista utenti auth. | [Apri](./datahub-endpoint-12-get-datahub-auth-users.md) |
| `GET` | `/datahub/auth/users/:id` | Path `id` utente. | [Apri](./datahub-endpoint-13-get-datahub-auth-users-id.md) |
| `POST` | `/datahub/auth/users` | Body nuovo utente. | [Apri](./datahub-endpoint-14-post-datahub-auth-users.md) |
| `PUT` | `/datahub/auth/users/:id` | Path `id`; body update utente. | [Apri](./datahub-endpoint-15-put-datahub-auth-users-id.md) |
| `DELETE` | `/datahub/auth/users/:id` | Path `id`; delete utente. | [Apri](./datahub-endpoint-16-delete-datahub-auth-users-id.md) |
