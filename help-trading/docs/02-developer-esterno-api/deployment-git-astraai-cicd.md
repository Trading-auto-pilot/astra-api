---
sidebar_position: 2
---

# CI/CD astraai

Workflow di riferimento:

- `astraai/.github/workflows/deploy.yml`

Trigger:

- push su branch `PAPER`
- push su branch `LIVE`

## Passaggi principali del workflow

1. Checkout repository.
2. Setup Docker Buildx.
3. Login DockerHub.
4. Gate su `LIVE`: deploy consentito solo da PR `PAPER -> LIVE`.
5. Lettura versione da `public/release.json` (campo `version`).
6. Build/push immagine frontend (solo `PAPER`) con:
   - `VITE_API_BASE_URL`
   - `VITE_FMP_API_KEY`
   - `VITE_HELP_BASE`
   - `VITE_ENV`
7. Deploy su server: update `ASTRAAI_VERSION` nel file `.env`, `docker compose pull`, `up -d --force-recreate`.

## Attenzioni importanti

- Le variabili `VITE_*` vengono risolte a build-time.
- Se il valore e sbagliato in `Environment secrets/vars`, viene "baked" nel bundle.
- Per evitare drift, mantenere allineati:
  - versione letta da `public/release.json`;
  - `ASTRAAI_VERSION` usata nel deploy server.

