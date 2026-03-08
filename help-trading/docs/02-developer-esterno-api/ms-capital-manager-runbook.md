---
sidebar_position: 5
---

# capital-manager — Runbook

## Avvio rapido (local)

```bash
docker compose -f docker-compose.local.yml --env-file .env.local build capital-manager
docker compose -f docker-compose.local.yml --env-file .env.local up -d --no-deps capital-manager
docker compose -f docker-compose.local.yml logs -f capital-manager
```

## Check operativi

```bash
# Health
curl -f http://localhost:3010/status/health

# Info + versione
curl http://localhost:3010/status/info
curl http://localhost:3010/release

# Test quote (con ibkr-bridge e liquidity-manager attivi)
curl -X POST http://localhost:3010/allocation/quote \
  -H "Content-Type: application/json" \
  -d '{"userId":7,"symbol":"AAPL","market":"US","clientRequestId":"test-001"}'
```

## Problemi comuni

| Sintomo | Causa probabile | Recovery |
|---|---|---|
| `maxInvestable = 0` sempre | ibkr-bridge non raggiungibile → `cashAvailable = 0` | Verificare `GET /ibkr-bridge/status/health` e che il container sia attivo |
| `usedFallback: true` sempre | liquidity-manager non raggiungibile o `confidence = 0` | Verificare `GET /liquidity-manager/status/health`; controllare `FRED_API_KEY` nel liquidity-manager |
| `ok: false, code: INSUFFICIENT_CAPITAL` | Cash disponibile insufficiente o riserva troppo alta | Verificare cash IBKR; se necessario abbassare `SCORE_RESERVED_MAX` |
| Prenotazioni non scadono | Redis non disponibile | Verificare connessione Redis (`REDIS_URL`); le prenotazioni usano TTL Redis nativo |
| `listReservations` restituisce array vuoto | Prenotazioni scadute o userId errato | Normale dopo TTL; controllare `userId` nella query |

## Osservabilità

```bash
# Metriche runtime
curl http://localhost:3010/status/metrics

# Canali comunicazione Redis
curl http://localhost:3010/status/communicationChannels

# Log live
docker compose -f docker-compose.local.yml logs -f capital-manager

# Prenotazioni attive per utente
curl "http://localhost:3010/allocation/reservations?userId=7"
```

## Verifica integrazione con decision-engine

Il `decision-engine` chiama il `capital-manager` in modalità fire-and-forget. Per testare l'integrazione end-to-end:

1. Avviare `capital-manager`, `ibkr-bridge`, `liquidity-manager`
2. Attivare il live mode del decision-engine (`GET /decision-engine/spot-finder/live/0`)
3. Quando arriva un segnale, nei log del `decision-engine` verificare:
   ```
   [capitalManager] AAPL dollars=3240.50 qty=17
   ```
4. Nei log del `capital-manager` verificare:
   ```
   [computeQuote] userId=7 symbol=AAPL market=US
   [decisionEngine] AAPL maxInvestable=3240.50 (cash=5000, reservedPct=0.350, ...)
   ```

## Tuning in produzione

| Scenario | Parametro da modificare |
|---|---|
| Investire più aggressivamente in bull market | Abbassare `SCORE_RESERVED_MAX` (es. `0.50`) |
| Maggiore prudenza in tutti i regimi | Alzare `FALLBACK_RESERVED_CASH_PCT` (es. `0.70`) |
| Prenotazioni più brevi (segnali veloci) | Abbassare `RESERVATION_TTL_SEC` (es. `60`) |
| Ignorare la volatilità nel calcolo | Impostare `VOL_SCALE=99999` |
| Soglia minima ordine più alta | Alzare `MIN_ORDER_NOTIONAL` (es. `100`) |
