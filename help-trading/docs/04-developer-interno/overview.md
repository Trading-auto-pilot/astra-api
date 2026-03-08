---
sidebar_position: 1
---

# API

Sezione tecnica per il team che mantiene il codice nel repository `trading-system`.

## Obiettivo

- Rendere esplicita la struttura a cartelle e le responsabilita dei moduli.
- Standardizzare onboarding tecnico, contribuzione e review.
- Mantenere un inventario API per microservizio con metodo/path/parametri.

## Documenti iniziali

- [Mappa cartelle](./mappa-cartelle.md)
- `convenzioni-codice.md` (da aggiungere)
- `workflow-release.md` (da aggiungere)

## API Microservizi

Questa sezione elenca le API interne per ogni microservizio.

### Elenco servizi

- [authservice](./servizi/01-authservice.md)
- [datahub](./servizi/02-datahub.md)
- [cachemanager](./servizi/03-cachemanager.md)
- [decision-engine](./servizi/04-decision-engine.md)
- [market-data-service](./servizi/05-market-data-service.md)
- [redis-ws-bridge](./servizi/06-redis-ws-bridge.md)
- [ibkr-bridge](./servizi/07-ibkr-bridge.md)
- [ibkr-keepalive](./servizi/08-ibkr-keepalive.md)
- [alertingservice](./servizi/09-alertingservice.md)
- [scheduler](./servizi/10-scheduler.md)
- [tickerscanner](./servizi/11-tickerscanner.md)
- [servicecontrolplane](./servizi/12-servicecontrolplane.md)
- [broker-executor-ibkr](./servizi/13-broker-executor-ibkr.md)
- [liquidity-manager](./servizi/14-liquidity-manager.md)

### Nota formato

Le tabelle usano:

- `METODO`: verbo HTTP.
- `PATH`: path esposto (normalmente via Traefik).
- `Parametri`: path/query/body principali con descrizione.
