---
sidebar_position: 5
---

# Runbook

## Avvio rapido

```bash
# Build e avvio
docker compose -f docker-compose.local.yml --env-file .env.local \
  build market-simulator

docker compose -f docker-compose.local.yml --env-file .env.local \
  up -d --no-deps market-simulator

# Log in tempo reale
docker compose -f docker-compose.local.yml logs -f market-simulator
```

## Verifica salute

```bash
# Health check
curl http://localhost:3010/status/health

# Info versione
curl http://localhost:3010/release

# Stato sessione corrente
curl http://localhost:3010/session
```

## Flusso operativo tipo

```bash
# 1. Configura sessione
curl -X POST http://localhost:3010/session \
  -H "Content-Type: application/json" \
  -d '{"startDate":"2024-01-01","endDate":"2024-03-31","tf":"1Day"}'

# 2. Avvia decision-engine in modalità simulata
#    (MARKETDATASERVICE_URL=http://market-simulator:3010)
#    → il decision-engine chiama POST /subscriptions con i ticker del pipe

# 3. Avanza di un giorno (pubblica snapshot per tutti i ticker iscritti)
curl -X POST http://localhost:3010/session/tick

# 4. Controlla lo stato
curl http://localhost:3010/session

# 5. Ripeti il tick fino a hasMore: false
```

## Ispezione e modifica candele dal frontend

```bash
# Recupera una candela specifica
curl "http://localhost:3010/candle?symbol=MRNA&date=2024-01-15&tf=1Day"

# Inietta una candela modificata come snapshot
curl -X POST http://localhost:3010/candle/push \
  -H "Content-Type: application/json" \
  -d '{"symbol":"MRNA","candle":{"t":"2024-01-15","o":53.00,"h":56.00,"l":52.50,"c":54.67,"v":2000000}}'
```

## Problemi comuni

| Sintomo | Diagnosi | Azione correttiva |
|---|---|---|
| `POST /session/tick` → `No active session` | Sessione non configurata | Chiamare prima `POST /session` |
| `POST /session/tick` → `No tickers subscribed` | Nessuna sottoscrizione | Chiamare `POST /subscriptions` o verificare che decision-engine abbia chiamato il simulatore |
| `results[ticker].ok: false, error: candle not found` | Cachemanager non ha dati per quel ticker/data | Verificare range date, tf, e disponibilità dati su cachemanager |
| Decision-engine non riceve snapshot | Canale Redis errato | Verificare che `ENV` sia uguale tra market-simulator e decision-engine |
| Health check non risponde | Container non avviato o porta errata | Verificare `docker ps`, porta `3010`, variabile `DATAHUB_URL` |

## Osservabilità

```bash
# Log live
docker compose logs -f market-simulator

# Metriche
curl http://localhost:3010/status/metrics

# Canali Redis attivi
curl http://localhost:3010/status/communicationChannels
```

### Log attesi durante un tick

```
[tick] AAPL date=2024-01-15T00:00:00.000Z close=185.92 channel=DEV.market-data-service.data
[tick] MRNA date=2024-01-15T00:00:00.000Z close=54.66 channel=DEV.market-data-service.data
[tick] no candle for NVDA at 2024-01-15T00:00:00.000Z
```
