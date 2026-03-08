---
sidebar_position: 4
---

# Configurazione

## Parametri operativi

| Parametro | Valore |
|---|---|
| Servizio | `decision-engine` |
| Porta interna | `3018` |
| Prefisso API | `/decision-engine` |

## Variabili chiave

- `DATAHUB_URL` (o fallback legacy `DBMANAGER_URL`)
- `REDIS_URL`
- `LOG_LEVEL`
- `ENV`
- `TZ`

## Variabili per il live mode (Fase 6)

| Variabile | Default | Descrizione |
|---|---|---|
| `LIQUIDITYMANAGER_URL` | `http://liquidity-manager:3001` | URL del servizio di regime macro. Usato nel check riskOn prima di emettere un segnale live. |
| `RISK_ON_TTL_MS` | `60000` | Durata (ms) della cache in-memory per la risposta del liquidity-manager. Riduce la frequenza di chiamate HTTP su ogni tick. |
| `LIVE_INTRADAY_TF` | `1min` | Timeframe dell'ultima candela intraday usata nel candle range check (solo breakout). Deve corrispondere a un timeframe disponibile in cachemanager. |
| `ALERT_COOLDOWN_MS` | `300000` | Finestra (ms) di blocco anti-duplicati per lo stesso segnale `(ticker, entryMode, entryLimit)`. Evita notifiche ripetute sullo stesso livello. |

## Compose e profili

- servizio definito in `docker-compose*.yml`
- profile compose dedicato al microservizio
- healthcheck su `.../status/health`
