---
sidebar_position: 2
---

# Endpoint dettagliati

## Endpoint regole e stato alerting

Esposti da proxy verso datahub (formato compatibile DBManager):

- `ALL /alerting-rules`
- `ALL /alerting-rules/:id`
- `ALL /alerting-state`
- `ALL /alerting-state/:id`
- `ALL /alerting-deliveries`
- `ALL /alerting-deliveries/:id`

## Endpoint operativi alerting

### `POST /alerting/rules/reload`

Ricarica regole e stato nel RuleEngine senza restart.

### `GET /events/catalog`

Legge catalogo `EVENTS:*` da Redis.

Query:

- `includeManifests=true|false` (default `true`)

## Endpoint notifiche

### `POST /email/send`

Invio email diretto (test/manuale).

### `POST /whatsapp/send`

Invio WhatsApp diretto.

### `POST /whatsapp/template`

Invio WhatsApp template.

## Endpoint standard microservizio

- `GET /release`
- `GET /settings`
- `PUT /settings`
- `POST /settings/reload`
- `PUT /connect`
- `DELETE /connect`
- `GET /dbLogger`
- `PUT /dbLogger/:status`

## Endpoint status

Prefisso: `/status`.

- `GET /status/health`
- `GET /status/info`
- `GET /status/metrics`
- `GET /status/logLevel`
- `PUT /status/logLevel`
- `GET /status/communicationChannels`
- `PUT /status/communicationChannels`
