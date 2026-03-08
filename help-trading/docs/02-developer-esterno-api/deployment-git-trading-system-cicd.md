---
sidebar_position: 1
---

# CI/CD trading-system

Workflow di riferimento:

- `trading-system/.github/workflows/deploy.yml`

Trigger:

- push su branch `PAPER`
- push su branch `LIVE`

## Passaggi principali del workflow

1. Checkout repository.
2. Setup Docker Buildx.
3. Login DockerHub.
4. Gate su `LIVE`: deploy consentito solo da PR `PAPER -> LIVE`.
5. Build/push immagini Docker (solo su `PAPER`) per i microservizi elencati nello script `services=(...)`.
6. Build specifica di `ibkr-clientportal` sul server e push su DockerHub.
7. Creazione release GitHub (solo su `LIVE`, se `CREATE_RELEASE=true`).
8. Generazione `.env` server da `vars` e `secrets` GitHub Environment.
9. Validazione variabili obbligatorie.
10. Copia file su server (`.env`, compose, script deploy/restore).
11. Restore DB condizionale da dump `Trading_PAPER_*.tar.gz`.
12. Deploy con `deploy-with-profiles.sh` e riallineamento container.

## Note operative

- Su `LIVE` il workflow non deve ricostruire immagini: usa immagini gia pubblicate.
- Le versioni delle immagini sono prese dai rispettivi `release.json` (quando presenti).
- `COMPOSE_PROFILES` guida quali servizi vengono avviati.

