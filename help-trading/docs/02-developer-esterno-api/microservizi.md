---
sidebar_position: 5
---

# Microservizi

Questa sezione raccoglie la documentazione dei servizi orchestrati tramite Docker Compose.

## Profili Docker Compose

Nel progetto i servizi applicativi sono gestiti con `profiles` (es. `tickerscanner`, `scheduler`, `decision-engine`).

Variabile principale per abilitare/disabilitare i profili:

- `COMPOSE_PROFILES`

Esempio:

```bash
COMPOSE_PROFILES="tickerscanner,scheduler" docker compose -f docker-compose.paper.yml --env-file .env up -d
```

Nota operativa:

- Lo script `deploy-with-profiles.sh` calcola i profili da DB (`service_flags`) in base all'ambiente (`PAPER`/`LIVE`) e poi imposta `COMPOSE_PROFILES`.

## Avvio e spegnimento servizi

### Avvio stack completo (compose file selezionato)

```bash
docker compose -f docker-compose.paper.yml --env-file .env up -d
```

### Avvio solo alcuni profili

```bash
COMPOSE_PROFILES="cachemanager,decision-engine,tickerscanner" \
  docker compose -f docker-compose.paper.yml --env-file .env up -d
```

### Avvio singolo servizio

```bash
docker compose -f docker-compose.paper.yml --env-file .env up -d tickerscanner
```

### Stop singolo servizio

```bash
docker compose -f docker-compose.paper.yml --env-file .env stop tickerscanner
```

### Stop e rimozione stack

```bash
docker compose -f docker-compose.paper.yml --env-file .env down
```

## Rebuild / ricompilazione

### Rebuild singolo servizio (da sorgente)

```bash
docker compose -f docker-compose.local.yml --env-file .env build --no-cache tickerscanner
docker compose -f docker-compose.local.yml --env-file .env up -d --force-recreate tickerscanner
```

### Rebuild tutti i servizi (da sorgente)

```bash
docker compose -f docker-compose.local.yml --env-file .env build --no-cache
docker compose -f docker-compose.local.yml --env-file .env up -d --force-recreate
```

### In ambiente paper/live con immagini versionate

```bash
./deploy-with-profiles.sh PAPER
# oppure
./deploy-with-profiles.sh LIVE
```

Lo script effettua pull/refresh delle immagini e riallinea i servizi in base ai profili attivi.

## Organizzazione directory e Dockerfile

Pattern usato nel repository:

- ogni microservizio ha una directory dedicata;
- nella root del servizio e presente un `Dockerfile`;
- i file compose (`docker-compose.local.yml`, `docker-compose.paper.yml`) referenziano immagine/build e variabili env.

Esempio struttura:

```text
trading-system/
  authService/Dockerfile
  datahub/Dockerfile
  cacheManager/Dockerfile
  decision-engine/Dockerfile
  market-data-service/Dockerfile
  redisWsBridge/Dockerfile
  ibkr-bridge/Dockerfile
  ibkr-keepalive/Dockerfile
  alertingService/Dockerfile
  scheduler/Dockerfile
  tickerScanner/Dockerfile
  serviceControlPlane/Dockerfile
  docker-compose.local.yml
  docker-compose.paper.yml
```

## Gruppi documentati

1. **Microservizi a supporto**: Traefik, MySQL, Redis.
2. **Microservizi specifici**: servizi applicativi sviluppati nel progetto (incluso datahub).
