---
sidebar_position: 1
---

# Architettura e flussi

## Componenti principali

- `server.js`: avvio via `shared/serverFactory`;
- `modules/main.js`: classe `ServiceControlPlane` (estende `BaseService`);
- `serviceFlags.js`: router REST `/service-flags`;
- `modules/serviceFlags.js`: client data access verso `datahub` (`service_flags`).

## Flusso operativo dei flag

1. Client autenticato invoca endpoint `/service-flags/*`.
2. Router valida payload minimo (`env`, `microservice`) per create/update.
3. Il client `createServiceFlagsClient` chiama datahub su `/api/table/service_flags`.
4. Risposta adattata e ritornata al chiamante (`items`, `item`, esito).

## Dati e integrazioni

- persistenza principale: tabella `service_flags` in datahub;
- infrastruttura runtime: RedisBus/Logger gestiti da `BaseService`;
- routing e protezione: Traefik + `auth-forward` middleware.

## Scope del servizio

`servicecontrolplane` in questa versione e focalizzato su feature flags;
altre capability control-plane possono essere aggiunte come nuovi router montati in `server.js`.
