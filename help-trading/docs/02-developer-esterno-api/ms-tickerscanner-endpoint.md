---
sidebar_position: 2
---

# Endpoint dettagliati

Prefisso esterno via Traefik: `/tickerscanner`.

---

## Endpoint universe (Fase 1)

Sotto prefisso `/tickerscanner/universe`.

### CRUD universe

| Metodo | Path | Descrizione |
|---|---|---|
| `GET` | `/tickerscanner/universe` | Lista tutti i simboli in `universe`. Supporta `?limit=&offset=`. |
| `GET` | `/tickerscanner/universe/:symbol` | Record singolo (es. `/universe/AAPL`). |

### Scan jobs

| Metodo | Path | Descrizione |
|---|---|---|
| `POST` | `/tickerscanner/universe/scan` | Avvia scan solo sui simboli non ancora in `universe`. |
| `POST` | `/tickerscanner/universe/scan/force` | Forza ricalcolo su tutti i simboli (anche esistenti). |
| `GET` | `/tickerscanner/universe/scan/jobs` | Lista i job universe attivi. |
| `GET` | `/tickerscanner/universe/scan/status/:jobId` | Stato di un job specifico. |
| `DELETE` | `/tickerscanner/universe/scan/jobs/:jobId` | Cancella un job in corso. |

Risposta avvio job:
```json
{ "ok": true, "type": "async", "jobId": "scan_1741000000_abc123", "status": "queued" }
```

---

## Endpoint scanner (legacy)

:::caution Deprecazione pianificata
Gli endpoint `/scan` e `/scan/force` eseguono ancora il vecchio flusso unificato. Saranno sostituiti dagli endpoint di Fase 1 (`/universe/scan`) e Fase 2 (`daily_scores`).
:::

- `GET /tickerscanner/screener`
- `GET /tickerscanner/scan`
- `GET /tickerscanner/scan/force`
- `GET /tickerscanner/scan/status/:jobId`
- `GET /tickerscanner/scan/jobs`
- `DELETE /tickerscanner/scan/jobs/:jobId`
- `POST /tickerscanner/momentum/refresh`
- `GET /tickerscanner/glossary/:fileName`

---

## Endpoint fundamentals e job tables

Sotto prefisso `/tickerscanner/fundamentals`:

**Job market daily (Fase 2a — prezzi EOD):**
- `POST /update-market-daily`
- `GET /update-market-daily`
- `DELETE /update-market-daily/:jobId`
- `GET /market-daily/compare`
- CRUD `market-daily-jobs`

**Job user daily score (Fase 3):**
- `POST /user-daily-scores`
- `GET /user-daily-scores`
- `DELETE /user-daily-scores/:jobId`
- `GET /jobs` (aggregato active jobs)
- CRUD `user-daily-score-jobs`

**Ranking giornaliero di sistema (Fase 4):**
- `POST /ranking/daily` — genera snapshot ranking da `daily_scores` → `AST_RANKING_DAILY`
- `GET /ranking/daily?score_date=YYYY-MM-DD` — legge snapshot per una data

Body POST:
```json
{
  "score_date": "2026-03-15",
  "mode": "normal",
  "limits": { "LARGECAP": 50, "MIDCAP": 30, "SMALLCAP": 20, "ETF_GENERAL": 30 },
  "filters": { "min_dollar_vol": 500000, "min_total_score": 40 }
}
```

**Scan jobs/history:**
- CRUD `ticker-scan-jobs`
- `GET /history`
- `GET /scores-daily/counts/:pipeId`
- `GET /scores-daily/by-user/:pipeId/:scoreDate`

---

## Endpoint user data/filter/order

Sotto `/tickerscanner/fundamentals` (router `userData.js`):

- `user-order` CRUD e bulk update
- `user-filters` CRUD e bulk update
- endpoint utente/pipeline (`users/pipes`, score weights, recalculate, ecc.)
- endpoint lookup simbolo e ultime candele

Nota: `userData.js` contiene route con path dinamico `/:symbol`, quindi è montato per ultimo.

---

## Endpoint interni

- `POST /tickerscanner/internal/fundamentals/user-daily-scores`

Richiede header `x-internal-token` valido.

Riferimento: [Autenticazione interna tra microservizi](./ms-authservice-autenticazione-interna.md)

---

## Endpoint standard microservizio

- `GET /tickerscanner/release`
- `GET /tickerscanner/settings`
- `PUT /tickerscanner/settings`
- `POST /tickerscanner/settings/reload`
- `PUT /tickerscanner/connect`
- `DELETE /tickerscanner/connect`
- `GET /tickerscanner/dbLogger`
- `PUT /tickerscanner/dbLogger/:status`

---

## Endpoint status

Prefisso: `/tickerscanner/status`.

- `GET /status/health`
- `GET /status/info`
- `GET /status/metrics`
- `GET /status/logLevel`
- `PUT /status/logLevel`
- `GET /status/communicationChannels`
- `PUT /status/communicationChannels`
