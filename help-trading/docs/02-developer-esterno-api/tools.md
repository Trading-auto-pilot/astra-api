---
sidebar_position: 4
---

# Tools

Questa pagina descrive i tool di sviluppo per creare ed eliminare microservizi in modo standardizzato.

## Tool principale: creazione microservizio

Script: `create-microservice-v2.js`
Documentazione sorgente: `trading-system/CREATE_MICROSERVICE_V2_README.md`

### Cosa fa

- genera un microservizio nuovo usando le librerie condivise (`BaseService`, `serverFactory`);
- crea struttura minima del servizio (`modules/main.js`, `server.js`, `Dockerfile`, `README`, ecc.);
- aggiorna file di sistema (`doc/ports.json`, `docker-compose*.yml`, variabili in `.env*`, workflow deploy).

### Shared Library coinvolte

Durante lo scaffolding e nella successiva implementazione, il microservizio creato usa queste librerie condivise:

- [BaseService](./shared-base-service.md): classe base comune per lifecycle, status, channels e integrazioni standard.
- [serverFactory](./shared-server-factory.md): bootstrap server Express con route standard e wiring del servizio.
- [statusRouterFactory](./shared-status-router-factory.md): endpoint `/status/*` uniformi (health, info, metrics, log level, channels).
- [logger](./shared-logger.md): logging strutturato console/DB/Redis con livelli runtime.
- [loadSettings](./shared-load-settings.md): caricamento/reload dei settings centralizzati in cache runtime.
- [redisBus](./shared-redis-bus.md): bus Redis per pub/sub, canali telemetry/metrics/data/logs/events.
- [eventsManifestRegistry](./shared-events-manifest-registry.md): registrazione del manifest eventi del microservizio.

### Perche usarlo

- riduce boilerplate (approccio centralizzato su `shared/`);
- mantiene coerenza tra microservizi;
- velocizza onboarding e manutenzione.

### Uso rapido

```bash
node create-microservice-v2.js MyService --port=3025

node create-microservice-v2.js OrderRouter \
  --port=3020 \
  --version=1.0.0 \
  --description="Order routing microservice"
```

## Tool principale: eliminazione microservizio

Script: `delete-microservice.js`
Documentazione sorgente: `trading-system/DELETE_MICROSERVICE_README.md`

### Cosa fa

- rimuove il servizio dalle configurazioni (`docker-compose`, env, deploy workflow);
- pulisce il record su DB (`service_flags`);
- aggiorna gli agganci frontend dove presenti;
- **non elimina definitivamente** la cartella del servizio: la rinomina in `.DELETED_<service>_<timestamp>`.

### Sicurezza operativa

- richiede conferma esplicita `yes`;
- mantiene backup automatico via rename cartella;
- logga ogni step e prosegue in modo resiliente in caso di warning non bloccanti.

### Uso rapido

```bash
node delete-microservice.js MyService
node delete-microservice.js liquidity-manager
```

## Workflow consigliato

1. Crea il nuovo servizio con `create-microservice-v2.js`.
2. Implementa logica business in `modules/main.js` e route custom in `server.js`.
3. Verifica compose/env/porta assegnata.
4. Se il servizio va dismesso, usa `delete-microservice.js` invece di rimuovere file manualmente.

## Riferimenti

- `trading-system/CREATE_MICROSERVICE_V2_README.md`
- `trading-system/DELETE_MICROSERVICE_README.md`
- `trading-system/shared/BaseService.README.md`
- `trading-system/shared/FACTORIES_README.md`

## Collegamenti

- [Torna alla pagina Backend](./backend.md)
- [Torna alla overview Developer](./overview.md)
