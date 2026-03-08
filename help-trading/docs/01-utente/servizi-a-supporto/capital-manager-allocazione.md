---
sidebar_position: 2
---

# Come funziona l'allocazione

Quando arriva una richiesta di quota (`POST /allocation/quote`), il `capital-manager` esegue questi passi in sequenza:

---

## 1. Raccolta dati in parallelo

Il servizio interroga tre sorgenti in parallelo (fail-soft: se una non risponde, usa un valore conservativo):

| Sorgente | Dato recuperato | Fallback |
|---|---|---|
| `ibkr-bridge` | Cash disponibile nel conto | `cashAvailable = 0` |
| `liquidity-manager` | Score macro, regime, volatilità, confidenza | `confidence = 0` (→ fallback conservativo) |
| `ibkr-bridge` | Lista ordini aperti BUY | `openOrdersReserved = 0` |

---

## 2. Calcolo della riserva di liquidità (`reservedCashPct`)

Il cuore del servizio è questa formula che determina **quanta parte del cash disponibile deve restare "bloccata"**:

### Caso A: confidenza bassa (< 69)

Se il `liquidity-manager` risponde con `confidence < 69` (o non risponde), i dati macro sono considerati inaffidabili:

```
reservedCashPct = 0.60   (60% del cash rimane bloccato)
```

Il servizio logga: `Liquidity confidence low, using fallback`.

### Caso B: confidenza sufficiente (≥ 69)

La riserva dipende dallo score (0–100), dal regime e dalla volatilità:

```
base = 0.70 - (score / 100) × 0.50
```

**Esempi:**

| Score liquidity | `base` |
|---|---|
| 0 (mercato illiquido) | 0.70 (70% bloccato) |
| 50 (neutro) | 0.45 (45% bloccato) |
| 100 (mercato molto liquido) | 0.20 (20% bloccato) |

**Aggiustamento regime:**

Se `riskRegime = "OFF"` → viene aggiunto +0.10 (maggiore prudenza):

```
base += 0.10   (se RISK_OFF)
```

**Aggiustamento volatilità:**

```
base += clamp(volatility / VOL_SCALE, 0, 0.10)
```

dove `VOL_SCALE = 100` per default. Una volatilità di 50 aggiunge +0.05.

**Clamp finale:** il valore è sempre compreso tra `[0.20, 0.85]`.

---

## 3. Calcolo del capitale investibile (vincoli di liquidità)

```
reservedCash       = cashAvailable × reservedCashPct
maxInvestable      = cashAvailable
                   - reservedCash
                   - reservationsReserved    (prenotazioni attive)
                   - openOrdersReserved      (ordini aperti BUY)
```

Se `maxInvestable < MIN_ORDER_NOTIONAL` (default: $50), la risposta è `ok: false` con codice `INSUFFICIENT_CAPITAL`.

---

## 3b. Limiti di concentrazione

Dopo il calcolo cash, il servizio applica un secondo livello di vincoli basato sull'**esposizione già presente in portafoglio**. Per ogni dimensione viene calcolato quanto è già investito e quanto residuo è disponibile:

| Limite | Cosa controlla | Come si calcola |
|---|---|---|
| `MAX_TICKER` | Massimo investibile su un singolo titolo (es. MSFT) | `MAX_PERC_TICKER × MAX_INVESTMENT` |
| `MAX_SECTOR` | Massimo investibile in un settore (es. Technology) | `MAX_PERC_SECTOR × MAX_INVESTMENT` |
| `MAX_INDUSTRY` | Massimo investibile in un'industria (es. Software - Infrastructure) | `MAX_PERC_INDUSTRY × MAX_INVESTMENT` |
| `MAX_AREA` | Massimo investibile in un'area geografica (es. North America) | `MAX_PERC_AREA × MAX_INVESTMENT` |

I limiti vengono applicati in sequenza (ticker → settore → industria → area): il `maxInvestable` viene ridotto se il residuo disponibile per una qualunque dimensione è inferiore al valore calcolato dal passo precedente.

:::info Come viene misurata l'esposizione
L'esposizione esistente include:
- **Posizioni aperte** (market value corrente)
- **Ordini BUY attivi** (limitPrice × quantità)

Questi dati vengono aggregati da `ibkr-bridge` in tempo reale ad ogni richiesta di quota.
:::

Il servizio recupera settore, industria e area geografica del simbolo richiesto dal servizio `datahub` (o dalla cache Redis) e li usa per identificare a quale bucket di esposizione appartiene l'operazione.

---

## 4. Risposta

La risposta include ora tre sezioni aggiuntive rispetto al solo `maxInvestable`:

```json
{
  "ok": true,
  "decision": {
    "symbol": "MSFT",
    "market": "US",
    "maxInvestable": 2450.00,
    "reservedCashPct": 0.35,
    "reservedCash": 1750.00,
    "riskRegime": "RISK_ON",
    "liquidityScore": 72,
    "confidence": 85,
    "volatility": 18.5,
    "constraints": {
      "cashAvailable": 5000.00,
      "openOrdersReserved": 9.50,
      "reservationsReserved": 0
    },
    "tickerInfo": {
      "sector": "Technology",
      "industry": "Software - Infrastructure",
      "area": "North America"
    },
    "concentrationDetail": {
      "ticker":   { "limit": 8133.49, "invested": 0,        "residual": 8133.49 },
      "sector":   { "name": "Technology",               "limit": 34567.34, "invested": 22000.00, "residual": 12567.34 },
      "industry": { "name": "Software - Infrastructure", "limit": 24400.48, "invested": 17000.00, "residual": 7400.48  },
      "area":     { "name": "North America",             "limit": 76251.49, "invested": 45000.00, "residual": 31251.49 }
    },
    "reasoning": [
      "score=72 → base=0.340",
      "volatility=18.5 / volScale=100 → +0.019",
      "cashAvailable=5000 reservedCash=1750 openOrders=9.50 reservations=0 → cashMaxInvestable=3240.50",
      "MAX_TICKER[MSFT]: existing=0 limit=8133.49 avail=8133.49 ✓ ok",
      "MAX_SECTOR[Technology]: existing=22000 limit=34567.34 avail=12567.34 ✓ ok",
      "MAX_INDUSTRY[Software - Infrastructure]: existing=17000 limit=24400.48 avail=7400.48 ⚠ BINDING",
      "MAX_AREA[North America]: existing=45000 limit=76251.49 avail=31251.49 ✓ ok",
      "→ maxInvestable=2450.00 (limited by MAX_INDUSTRY)"
    ],
    "ts": "2026-03-05T14:32:00.000Z"
  }
}
```

| Campo | Descrizione |
|---|---|
| `tickerInfo` | Settore, industria e area geografica classificati per il simbolo richiesto |
| `concentrationDetail` | Per ogni dimensione: limite assoluto in $, già investito, residuo disponibile |
| `reasoning` | Traccia completa di tutti i passi della formula (liquidità + concentrazione) |
| `limitedBy` | Se il `maxInvestable` è stato ridotto da un limite di concentrazione, indica quale (`MAX_TICKER`, `MAX_SECTOR`, `MAX_INDUSTRY`, `MAX_AREA`) |

---

## Comportamento fail-soft

Il servizio è progettato per non bloccare il flusso in caso di errori delle dipendenze:

| Dipendenza non raggiungibile | Comportamento |
|---|---|
| `ibkr-bridge` (account summary) | `cashAvailable = 0` → `maxInvestable = 0` → ordine non parte |
| `liquidity-manager` | `confidence = 0` → fallback `reservedCashPct = 0.60` |
| `ibkr-bridge` (open orders) | `openOrdersReserved = 0` (stima ottimistica) |
| Redis (prenotazioni) | `reservationsReserved = 0` (stima ottimistica) |
