---
sidebar_position: 1
---

# Architettura e flussi

## Componenti principali

- `server.js`: bootstrap HTTP e route principali;
- `modules/main.js`: orchestrazione runtime e integrazione shared libraries;
- moduli dominio: logica business specifica del servizio;
- integrazioni esterne: datahub/redis/servizi target.

## Flussi principali

1. Richiesta in ingresso su prefisso `/datahub`.
2. Validazione + orchestration interna del servizio.
3. Eventuale chiamata a dipendenze (`datahub`, Redis, servizi esterni).
4. Risposta HTTP e publish event/telemetry su bus quando previsto.

## Canali e stato

- Health: `GET /datahub/status/health`
- Info: `GET /datahub/status/info`
- Metrics: `GET /datahub/status/metrics`
- Canali Redis: `telemetry`, `metrics`, `data`, `logs`, `events`
