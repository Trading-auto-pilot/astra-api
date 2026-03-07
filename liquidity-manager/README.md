# liquidity-manager

Liquidity / Market Risk regime scoring service.

Produces a composite **Liquidity Exposure Score (0..100)**:
- `0`: max fear / risk-off (reduce exposure)
- `100`: high liquidity / risk-on (increase exposure)

## Endpoints

- `GET /health`
- `GET /status/health`
- `GET /liquidity-score`
  - Returns latest computed snapshot.
- `POST /liquidity-score/recompute`
  - Starts async recompute task and returns immediately (`started`, `taskId`, `status`).
- `GET /liquidity-score/tasks`
  - Returns task list (running + recent), with execution details.
- `GET /liquidity-score/tasks/:taskId`
  - Returns single task execution detail.
- `GET /liquidity-score/history?days=30`
  - Returns historical snapshots (default `days=30`).
- `GET /liquidity-score/providers/status`
  - Quick provider health check (`OK|MISSING|ERROR`) with `lastError` and `lastSuccessTimestamp`.

## Response Contract

`GET /liquidity-score` and `POST /liquidity-score/recompute` return:

```json
{
  "ok": true,
  "timestamp": "2026-02-16T12:00:00.000Z",
  "score": 63.4,
  "riskRegime": "NEUTRAL",
  "volatilityRegime": "NORMAL",
  "confidence": 0.85,
  "components": {
    "vix": {
      "raw": 17.2,
      "normalized": 74.4,
      "weight": 0.35,
      "status": "OK",
      "timestamp": "ISO",
      "source": "...",
      "error": null
    },
    "spyTrend": { "raw": 604.1, "normalized": 70.0, "weight": 0.35, "status": "OK", "timestamp": "ISO", "source": "...", "error": null },
    "dxy": { "raw": null, "normalized": null, "weight": 0.15, "status": "MISSING", "timestamp": "ISO", "source": "missing", "error": { "code": "CONFIG_MISSING", "message": "..." } },
    "credit": { "raw": null, "normalized": null, "weight": 0.15, "status": "ERROR", "timestamp": "ISO", "source": "missing", "error": { "code": "HTTP_ERROR", "message": "..." } }
  },
  "weights": { "vix": 0.35, "spyTrend": 0.35, "dxy": 0.15, "credit": 0.15 },
  "notes": []
}
```

## Score and Confidence Rules

- `score` is computed only on available components:
  - `effectiveScore = sum(normalized_i * weight_i) / sum(weight_i for OK components)`
- if no component is available: `score = null`, `confidence = 0`, `riskRegime = UNKNOWN`.
- `confidence = availableWeight / totalWeight`.
- if `confidence < LIQ_MIN_CONFIDENCE_FOR_REGIME` (default `0.60`), then `riskRegime = UNKNOWN`.
- `volatilityRegime = UNKNOWN` when VIX component is not `OK`.

## Components

- `vix`: piecewise normalizer (`modules/normalizers/vixNormalizer.js`)
- `spyTrend`: SPY trend proxy with SMA50/SMA200 + slope (`modules/normalizers/spyTrendNormalizer.js`)
- `dxy`: optional USD strength (z-score 60d)
- `credit`: optional credit stress proxy

When providers are unavailable, each component exposes `status` and `error`, `notes` explain the reason, and `confidence` is reduced.

## Scheduling

This microservice does **not** auto-schedule recomputations by default.
Use your dedicated external scheduler/orchestrator to call:

- `POST /liquidity-score/recompute`

History pruning is still applied on every recompute using `LIQUIDITY_HISTORY_DAYS`.

## Storage

Repository abstraction:
- `repositories/liquidityScoreRepository.js`

Implementations:
- `repositories/impl/inMemoryLiquidityScoreRepository.js`
- `repositories/impl/fileLiquidityScoreRepository.js`

Configure with `LIQUIDITY_REPOSITORY_MODE`:
- `memory` (default)
- `file` (stores snapshots in `data/liquidity-score-history.json` unless custom path is set)

## Environment Variables

- `LIQUIDITY_HISTORY_DAYS=365`
- `LIQUIDITY_PROVIDER_MODE=live|mock` (default `live`)
- `LIQUIDITY_REPOSITORY_MODE=memory|file` (default `memory`)
- `LIQUIDITY_HISTORY_FILE_PATH=/absolute/path.json` (only if repository mode = `file`)
- `LIQUIDITY_HTTP_TIMEOUT_MS=10000`
- `LIQ_MIN_CONFIDENCE_FOR_REGIME=0.60`
- `LIQ_PROVIDER_TIMEOUT_MS=5000`
- `LIQ_VIX_PROVIDER=stooq|fred|auto` (default `auto`)
- `LIQ_DXY_PROVIDER=stooq|yahoo|fred|auto` (default `auto`; order is fred -> yahoo -> stooq)
- `LIQ_DXY_FRED_SERIES=DTWEXBGS` (default `DTWEXBGS`)
- `LIQ_CREDIT_PROVIDER=fred|none` (default `fred`)
- `LIQ_CREDIT_SERIES=BAA10Y` (default `BAA10Y`)
- `FRED_API_KEY=...` (used by FRED calls as `api_key` query parameter)
- `YAHOO_TIMEOUT_MS=8000`
- `YAHOO_RATE_LIMIT_RPS=1`
- `YAHOO_RATE_LIMIT_RPM=30`
- `YAHOO_JITTER_MIN_MS=200`
- `YAHOO_JITTER_MAX_MS=800`
- `YAHOO_RETRY_MAX_ATTEMPTS=5`
- `YAHOO_RETRY_BASE_MS=1000`
- `YAHOO_RETRY_MAX_MS=15000`
- `YAHOO_CIRCUIT_FAILS=3`
- `YAHOO_CIRCUIT_COOLDOWN_MIN=30`
- `YAHOO_CACHE_TTL_MIN=360`

## Run

```bash
cd liquidity-manager
npm run dev
```

Service default port: `3001`.
