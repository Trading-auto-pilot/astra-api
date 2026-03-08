---
sidebar_position: 2
---

# Endpoint dettagliati

Prefisso esterno via Traefik: `/scheduler`.

## Endpoint scheduler jobs

### `POST /scheduler/reload`

Ricarica job da datahub e ricrea il planning cron in memoria.

### `GET /scheduler/jobs`

Restituisce snapshot job in memoria.

Query supportate:

- `include_disabled=true|1` (o `includeDisabled`) per leggere tutti i job da datahub.

### `POST /scheduler/jobs`

Crea un job (pass-through verso datahub) e ricarica lo scheduler.

### `PUT /scheduler/jobs/:id`

Aggiorna un job e ricarica lo scheduler.

### `PUT /scheduler/jobs/:id/last-run`

Aggiorna metadati ultima esecuzione (`last_run_at`, `last_status`).

### `DELETE /scheduler/job/:id`

Cancella un job e ricarica lo scheduler.

Nota: path al singolare (`/job/:id`) come implementato nel servizio.

### `GET /scheduler/jobs/:jobKey/last-run`

Legge l'ultimo stato da Redis KV (`scheduler:lastrun:<jobKey>`).

### `POST /scheduler/jobs/:jobKey/run`

Esecuzione manuale immediata del job per `jobKey`.

Body opzionale:

- `headers` override request headers;
- `body` override payload.

## Endpoint standard microservizio

- `GET /scheduler/release`
- `GET /scheduler/settings`
- `PUT /scheduler/settings`
- `POST /scheduler/settings/reload`
- `PUT /scheduler/connect`
- `DELETE /scheduler/connect`
- `GET /scheduler/dbLogger`
- `PUT /scheduler/dbLogger/:status`

## Endpoint status

Prefisso: `/scheduler/status`.

- `GET /status/health`
- `GET /status/info`
- `GET /status/metrics`
- `GET /status/logLevel`
- `PUT /status/logLevel`
- `GET /status/communicationChannels`
- `PUT /status/communicationChannels`

## Endpoint interni verso altri servizi

`scheduler` non espone route `/internal/*`, ma le invoca in uscita durante i job verso altri microservizi.

Quando richiesto, aggiunge `x-internal-token` firmato.

Riferimento:

- [Autenticazione interna tra microservizi](./ms-authservice-autenticazione-interna.md)
