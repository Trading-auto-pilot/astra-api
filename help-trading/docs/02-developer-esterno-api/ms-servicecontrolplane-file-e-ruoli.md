---
sidebar_position: 3
---

# Implementazione per file

## Struttura principale

- `serviceControlPlane/server.js`
- `serviceControlPlane/modules/main.js`
- `serviceControlPlane/serviceFlags.js`
- `serviceControlPlane/modules/serviceFlags.js`

## Ruolo dei file

### `server.js`

- avvia servizio con `createMicroserviceServer`;
- monta router custom `/service-flags`;
- eredita endpoint standard e `/status/*` dal serverFactory.

### `modules/main.js`

- implementa `ServiceControlPlane` estendendo `BaseService`;
- inizializza URL dei servizi interni e hook `_onInit`.

### `serviceFlags.js`

Router REST business:

- implementa CRUD `service_flags`;
- valida campi richiesti per create/update;
- normalizza codici errore (`404`, `409`, `500`).

### `modules/serviceFlags.js`

Client repository:

- usa `datahubAdapter` su `/api/table/service_flags`;
- espone metodi `list/get/create/update/remove`.

## Note implementative utili

- compatibilita datahub: `DATAHUB_URL`/`DBMANAGER_URL` via `BaseService`;
- il router e montato con `protected: true`, quindi passa dal layer auth-forward;
- il servizio riusa il pattern standard platform per status/metriche/log channels.
