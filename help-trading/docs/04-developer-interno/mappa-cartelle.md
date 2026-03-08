---
sidebar_position: 2
---

# Mappa Cartelle (trading-system)

La documentazione interna segue la struttura reale del repository.

## Struttura macro

```text
trading-system/
  authService/
  decision-engine/
  market-data-service/
  scheduler/
  tickerScanner/
  brokerExecutor-ibkr/
  ibkr-bridge/
  liquidity-manager/
  cacheManager/
  datahub/
  serviceControlPlane/
  alertingService/
  shared/
  db/
  doc/
  docker-compose*.yml
```

## Regole di organizzazione docs interne

- Ogni microservizio avra una pagina dedicata in `04-developer-interno/servizi/`.
- Le dipendenze trasversali vanno in `04-developer-interno/shared/`.
- Runbook di deploy e recovery vanno in `03-amministratore/`.
- Contratti API pubblici restano in `02-developer-esterno-api/`.

## Prossimi documenti consigliati

- `servizi/decision-engine.md`
- `servizi/market-data-service.md`
- `servizi/scheduler.md`
- `shared/autenticazione-interna.md`
- `shared/event-bus-e-cache.md`
