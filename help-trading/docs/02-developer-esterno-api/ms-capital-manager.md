---
sidebar_position: 45
---

# capital-manager

## Cosa fa

`capital-manager` calcola il capitale massimo investibile per ogni richiesta di acquisto, prevenendo l'over-allocation e adattando l'esposizione al regime macro corrente.

## Ruoli e responsabilità

- calcola `reservedCashPct` in funzione di score macro, regime e volatilità (formula lineare + aggiustamenti);
- interroga `ibkr-bridge` per cash disponibile e ordini aperti;
- interroga `liquidity-manager` per il risk score;
- gestisce prenotazioni Redis con TTL per prevenire race condition tra segnali concorrenti;
- garantisce idempotenza delle prenotazioni tramite `clientRequestId`.

## Porta esposta

- Porta interna servizio: `3010`
- Prefisso API: `/allocation`

## Configurazione compose

```yaml
capital-manager:
  build:
    context: .
    dockerfile: capital-manager/Dockerfile
  ports:
    - "3010:3010"
  environment:
    - DATAHUB_URL=http://datahub:3000
    - REDIS_URL=redis://redis:6379
    - IBKR_BRIDGE_URL=http://ibkr-bridge:3017
    - LIQUIDITY_MANAGER_URL=http://liquidity-manager:3001
    - RESERVATION_TTL_SEC=180
    - VOL_SCALE=100
    - FALLBACK_RESERVED_CASH_PCT=0.60
    - MIN_ORDER_NOTIONAL=50
    - TZ=${TIMEZONE}
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3010/status/health"]
    interval: 30s
    timeout: 10s
    retries: 3
```

## Variabili d'ambiente

### Infrastruttura

| Variabile | Default | Descrizione |
|---|---|---|
| `DATAHUB_URL` | `http://datahub:3000` | URL del servizio datahub (alias `DBMANAGER_URL` ancora accettato). |
| `REDIS_URL` | — | URI Redis. Obbligatorio per prenotazioni e bus eventi. |
| `LOG_LEVEL` | `info` | Livello di log: `trace`, `debug`, `info`, `warning`, `error`. |
| `ENV` | — | Ambiente (`local`, `paper`, `prod`). Usato come prefisso canali Redis. |
| `TZ` | — | Timezone del container. |

### Formula di allocazione

| Variabile | Default | Descrizione |
|---|---|---|
| `FALLBACK_RESERVED_CASH_PCT` | `0.60` | Riserva in caso di bassa confidenza macro. |
| `CONFIDENCE_THRESHOLD` | `69` | Soglia minima di confidenza del liquidity-manager. |
| `SCORE_RESERVED_MAX` | `0.70` | Riserva massima (score=0). |
| `SCORE_RESERVED_MIN` | `0.20` | Riserva minima (score=100). |
| `RISK_OFF_ADD_PCT` | `0.10` | Aggiustamento addizionale in regime RISK_OFF. |
| `VOL_ADD_MAX_PCT` | `0.10` | Massimo aggiustamento per volatilità. |
| `VOL_SCALE` | `100` | Divisore normalizzazione volatilità. |
| `MIN_ORDER_NOTIONAL` | `50` | Importo minimo investibile (USD). Sotto questa soglia → `ok: false`. |

### Prenotazioni

| Variabile | Default | Descrizione |
|---|---|---|
| `RESERVATION_TTL_SEC` | `180` | TTL delle prenotazioni Redis in secondi. |

### Integrazione ibkr-bridge

| Variabile | Default | Descrizione |
|---|---|---|
| `IBKR_BRIDGE_URL` | `http://ibkr-bridge:3017` | URL ibkr-bridge. |
| `IBKR_ACCOUNT_SUMMARY_PATH` | `/account/summary` | Path sommario conto. |
| `IBKR_POSITIONS_PATH` | `/positions` | Path posizioni. |
| `IBKR_OPEN_ORDERS_PATH` | `/orders/open` | Path ordini aperti. |
| `IBKR_ADAPTER_TIMEOUT_MS` | `5000` | Timeout HTTP verso ibkr-bridge. |

### Integrazione liquidity-manager

| Variabile | Default | Descrizione |
|---|---|---|
| `LIQUIDITY_MANAGER_URL` | `http://liquidity-manager:3001` | URL liquidity-manager. |
| `LIQUIDITY_SCORE_PATH` | `/risk/score` | Path risk score. |
| `LIQUIDITY_ADAPTER_TIMEOUT_MS` | `5000` | Timeout HTTP verso liquidity-manager. |

## Pagine dedicate

- [Architettura e flussi](./ms-capital-manager-architettura)
- [Endpoint dettagliati](./ms-capital-manager-endpoint)
- [Implementazione per file](./ms-capital-manager-file-e-ruoli)
- [Configurazione](./ms-capital-manager-configurazione)
- [Runbook operativo](./ms-capital-manager-runbook)
