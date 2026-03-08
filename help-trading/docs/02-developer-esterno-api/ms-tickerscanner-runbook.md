---
sidebar_position: 5
---

# Runbook

## Avvio rapido

```bash
# Avvio servizio tickerscanner (con profilo)
docker compose --profile tickerscanner up -d tickerscanner

# Log live
docker compose logs -f tickerscanner
```

## Verifiche base

```bash
curl -f http://localhost:3013/status/health
curl http://localhost:3013/status/info
curl http://localhost:3013/tickerscanner/scan/jobs
```

## Troubleshooting

### Errori FMP (429 / timeout)

- Riduci `SCAN_FMP_CONCURRENCY` e `MARKET_DAILY_CONCURRENCY`.
- Verifica `FMP_API_KEY` e quota piano.
- Controlla retry/backoff nei log dei job.

### Job asincroni bloccati

- Controlla stato job su endpoint `.../status/:jobId`.
- Verifica publish su canali telemetry/status.
- Controlla eventuali errori datahub write.

### Endpoint interno rifiuta chiamata

- Verifica presenza/coerenza `INTERNAL_JWT_PUBLIC_KEY`.
- Verifica token `x-internal-token` emesso dallo scheduler.

## Osservabilita

- Endpoint metriche: `GET /status/metrics`
- Canali: `GET /status/communicationChannels`
- Telemetry job: `ENV.tickerscanner.telemetry`
- Eventi servizio: `ENV.tickerscanner.events`
