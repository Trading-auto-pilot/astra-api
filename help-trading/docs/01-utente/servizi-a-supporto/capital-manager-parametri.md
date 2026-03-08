---
sidebar_position: 4
---

# Parametri e configurazione

Tutti i parametri si impostano via variabili d'ambiente. I valori di default sono pensati per un uso conservativo in modalità PAPER.

---

## Formula di allocazione

| Variabile | Default | Descrizione |
|---|---|---|
| `FALLBACK_RESERVED_CASH_PCT` | `0.60` | Percentuale di cash bloccata quando la confidenza macro è troppo bassa (< `CONFIDENCE_THRESHOLD`). |
| `CONFIDENCE_THRESHOLD` | `69` | Soglia di confidenza del `liquidity-manager`. Sotto questa soglia, si usa il fallback. |
| `SCORE_RESERVED_MAX` | `0.70` | Percentuale di riserva massima (quando score=0, mercato illiquido). |
| `SCORE_RESERVED_MIN` | `0.20` | Percentuale di riserva minima (quando score=100, mercato molto liquido). |
| `RISK_OFF_ADD_PCT` | `0.10` | Percentuale aggiuntiva bloccata quando il regime è RISK_OFF. |
| `VOL_ADD_MAX_PCT` | `0.10` | Percentuale massima aggiuntiva dovuta alla volatilità. |
| `VOL_SCALE` | `100` | Divisore per normalizzare la volatilità: `adj = clamp(vol / VOL_SCALE, 0, VOL_ADD_MAX_PCT)`. |
| `MIN_ORDER_NOTIONAL` | `50` | Importo minimo investibile in USD. Se `maxInvestable < MIN_ORDER_NOTIONAL`, risposta `ok: false`. |

---

## Prenotazioni

| Variabile | Default | Descrizione |
|---|---|---|
| `RESERVATION_TTL_SEC` | `180` | Durata in secondi di ogni prenotazione. Scade automaticamente su Redis. |

---

## Integrazione ibkr-bridge

| Variabile | Default | Descrizione |
|---|---|---|
| `IBKR_BRIDGE_URL` | `http://ibkr-bridge:3017` | URL del servizio ibkr-bridge. |
| `IBKR_ACCOUNT_SUMMARY_PATH` | `/account/summary` | Path per il sommario del conto. |
| `IBKR_POSITIONS_PATH` | `/positions` | Path per le posizioni aperte. |
| `IBKR_OPEN_ORDERS_PATH` | `/orders/open` | Path per gli ordini aperti. |
| `IBKR_ADAPTER_TIMEOUT_MS` | `5000` | Timeout in ms per le chiamate a ibkr-bridge. |

---

## Integrazione liquidity-manager

| Variabile | Default | Descrizione |
|---|---|---|
| `LIQUIDITY_MANAGER_URL` | `http://liquidity-manager:3001` | URL del servizio liquidity-manager. |
| `LIQUIDITY_SCORE_PATH` | `/risk/score` | Path per il risk score. |
| `LIQUIDITY_ADAPTER_TIMEOUT_MS` | `5000` | Timeout in ms per le chiamate al liquidity-manager. |

---

## Esempi di tuning

### Scenario: voglio investire di più in fase di mercato bull

Abbassare la riserva massima:
```
SCORE_RESERVED_MAX=0.50
SCORE_RESERVED_MIN=0.10
```

### Scenario: voglio comportamento più conservativo sempre

Alzare il fallback e la soglia di confidenza:
```
FALLBACK_RESERVED_CASH_PCT=0.75
CONFIDENCE_THRESHOLD=80
```

### Scenario: voglio prenotazioni più brevi (segnali molto rapidi)

```
RESERVATION_TTL_SEC=60
```
