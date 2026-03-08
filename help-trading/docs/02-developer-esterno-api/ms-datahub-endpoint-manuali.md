---
sidebar_position: 14
---

# datahub - Endpoint Manuali Attuali

Gli endpoint manuali provengono da due sorgenti:

1. route custom in `datahub/routes/*.js` caricate da `ManualRoutesLoader` (namespace `/api/custom/{file}`);
2. route montate esplicitamente in `server.js` per compatibilita legacy.

## A) Route custom (`/api/custom/*`)

### `routes/example.js`

- `GET /api/custom/example/hello`
- `GET /api/custom/example/database-stats`
- `POST /api/custom/example/query`

### `routes/marketDaily.js`

- `POST /api/custom/marketDaily/bulk`

## B) Route legacy esplicite (server.js)

### Settings legacy

- `GET /settings`
- `GET /settings/:key`

### Logs legacy

- `POST /logs`

### Auth legacy (`routes/auth.js` montato su `/auth`)

- `GET /auth/users`
- `GET /auth/users/:id`
- `POST /auth/users`
- `PUT /auth/users/:id`
- `DELETE /auth/users/:id`
- `GET /auth/users/:id/score-weights`
- `GET /auth/users/:id/score-weights/:pipeId`
- `PUT /auth/users/:id/score-weights`
- `POST /auth/users/:id/last-login`
- `GET /auth/users/:id/client-nav`
- `POST /auth/users/:id/client-nav`
- `PUT /auth/users/:userId/client-nav/:navId`
- `DELETE /auth/users/:userId/client-nav/:navId`
- `GET /auth/roles`
- `GET /auth/roles/:id`
- `GET /auth/users/:userId/permissions`
- `POST /auth/users/:userId/permissions`
- `PUT /auth/users/:userId/permissions/:permId`
- `DELETE /auth/users/:userId/permissions/:permId`
- `GET /auth/permissions`
- `GET /auth/permissions/user/:userId`
- `GET /auth/api-keys`
- `GET /auth/api-keys/user/:userId`
- `GET /auth/api-keys/:key`

## Come aggiungere nuovi endpoint manuali

- crea un file in `datahub/routes/<nome>.js` che esporta una factory `({ logger, schemaReader }) => router`;
- richiama `POST /api/refresh` per ricaricare route/schema;
- i nuovi endpoint saranno disponibili sotto `/api/custom/<nome>/*`.
