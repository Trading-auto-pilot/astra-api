---
sidebar_position: 1
---

# Architettura e flussi

## Componenti

- `server.js`: bootstrap con `createMicroserviceServer`.
- `modules/main.js`: service base (`BaseService`) + avvio connectivity loop.
- `modules/connectivity.js`: logica di health/auth/tickle/ssodh e proxy HTTP.
- `ibkrRoutes.js`: routing API esposte ai microservizi.

## Flusso connettivita

Il loop in `connectivity.js` esegue periodicamente:

1. check auth status (`/v1/api/iserver/auth/status`);
2. tickle sessione (`/v1/api/tickle`);
3. init bridge (`/v1/api/iserver/auth/ssodh/init`) a intervalli configurati;
4. pubblicazione telemetria combinata su Redis.

Se riceve `401`, tenta reauth verso dispatcher SSO (`IBKRGW_SSO_URL`) e riprova.

## Flusso proxy API

Le richieste applicative passano da:

- `GET/POST/... /mirror/*` -> `/v1/api/*` su IBKR Gateway.

Sono disponibili anche endpoint semplificati:

- `/accounts`
- `/account?accountId=...`

## Integrazione con il sistema

- consumer principali: `market-data-service`, `brokerExecutor-ibkr`, altri servizi broker-facing;
- settings/log gestiti via `datahub` (BaseService + logger shared);
- telemetria pubblicata su Redis bus del microservizio.
