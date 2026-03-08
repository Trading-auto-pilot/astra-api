---
sidebar_position: 9
---

# Fase 7 — Guardrail multi-livello e invio ordine a broker

La Fase 7 è la parte finale della pipeline di esecuzione. Quando la Fase 6 rileva un segnale `ENTRY_SIGNAL` (tutte le condizioni tecniche e macro soddisfatte), la Fase 7 applica una serie di **guardrail anti-volatilità** prima di inviare l'ordine bracket al broker.

L'obiettivo è proteggere il portafoglio da eventi ad alto impatto che possono aumentare la volatilità in modo imprevedibile e rendere l'ingresso rischioso indipendentemente dalla qualità del segnale tecnico.

**Frequenza:** in-process, contestuale al segnale live di Fase 6 (fire-and-forget, non blocca il loop di monitoraggio).

**Ambiente:** solo account PAPER (verifica fail-closed). Gli account LIVE sono bloccati a livello di guardrail.

---

## Scheda operativa

| Voce | Dettaglio |
|---|---|
| Scopo | Verificare che nessun evento di rischio sia imminente prima di eseguire un ordine, poi inviare l'ordine bracket al broker. |
| Punto di partenza | Segnale `ENTRY_SIGNAL` dalla Fase 6 (livelli `entryLimit`, `stopLoss`, `takeProfit1`, `takeProfit2`). |
| Deliverable | Ordine bracket (`BUY` + stop-loss + take-profit) inviato a `brokerExecutor-ibkr`. |
| Microservizi coinvolti | `decision-engine` (orchestrazione), `brokerExecutor-ibkr` (esecuzione), `ibkr-bridge` (verifica account), `capital-manager` (sizing), `liquidity-manager` (regime macro, cache dalla Fase 6). |

---

## Catena di guardrail

I guardrail sono applicati **in sequenza** prima dell'invio dell'ordine. Se uno qualsiasi fallisce, l'ordine viene bloccato e il segnale rimane **attivo** per essere rivalutato al tick successivo (nessun cooldown applicato sul segnale).

```text
ENTRY_SIGNAL (Fase 6)
       |
       v
[G1] Risk Regime Check
       |
       v
[G2] Earnings Proximity
       |
       v
[G3] FOMC Proximity
       |
       v
[G4] Macro Event Proximity (CPI / NFP)
       |
       v
[G5] Dividend Ex-Date Proximity
       |
       v
[G6] Candle Range (solo breakout)
       |
       v
[G7] Opening Window (solo breakout)
       |
       v
[G8] IBKR Account Check (fail-closed)
       |
       v
[G9] Capital Manager (sizing)
       |
       v
  ORDINE BRACKET → brokerExecutor-ibkr
```

:::info Nota: guardrail G1–G7 in Fase 6
I guardrail G1–G7 sono tecnicamente eseguiti alla fine della Fase 6, come precondizioni per l'emissione del segnale stesso. G8 e G9 sono eseguiti in Fase 7 come parte del processo di esecuzione dell'ordine (fire-and-forget asincrono).
:::

---

## Dettaglio guardrail

### G1 — Risk Regime Check

**Applicabile a:** breakout e pullback.

Il motore verifica che il regime macro sia **RISK_ON** tramite `liquidity-manager`:

```http
GET /liquidity-manager/liquidity-score
```

Il risultato è **cachato in memoria per `RISK_ON_TTL_MS`** (default 60 secondi) per limitare le chiamate HTTP.

| Campo | Valori possibili |
|---|---|
| `riskRegime` | `RISK_ON` / `RISK_OFF` / `NEUTRAL` / `UNKNOWN` |
| `score` | Numero 0–100 |

**Condizione richiesta:** `riskRegime === "RISK_ON"`.

Se il regime è diverso da `RISK_ON` il segnale viene bloccato con log WARNING. Il sistema **non invia notifica hook** per questo blocco (il cambio di regime è già segnalato separatamente).

---

### G2 — Earnings Proximity

**Applicabile a:** breakout e pullback.

Blocca i segnali se la data di earnings più vicina (passata o futura) è entro la finestra di blocco.

```http
GET https://financialmodelingprep.com/stable/earnings?symbol={TICKER}&apikey={FMP_API_KEY}
```

Il risultato è **cachato per 24 ore** per simbolo (1 ora in caso di errore).

| Parametro | Env var | Default |
|---|---|---|
| Abilita/disabilita | `DE_EARNINGS_GUARD_ENABLED` | `true` |
| Finestra di blocco | `EARNINGS_BLOCK_WEEKS` | `2` settimane (14 giorni) |

**Condizione di blocco:** `abs(oggi – dataEarnings) ≤ blockDays`.

Viene considerata sia la data di earnings imminente che quella più recente (la più vicina al giorno corrente in valore assoluto).

**Su blocco:** log WARNING + evento `ENTRY.EARNINGS_PROXIMITY_BLOCKED` + hook `ENTRY_SIGNAL_BLOCKED_EARNINGS`.

---

### G3 — FOMC Proximity

**Applicabile a:** breakout e pullback.

Blocca i segnali nelle 48 ore precedenti/successive a una riunione FOMC (Federal Open Market Committee).

```http
GET https://financialmodelingprep.com/stable/economic-calendar?from={da}&to={a}&apikey={FMP_API_KEY}
```

Il calendario economico è **cachato globalmente per 6 ore** (30 minuti in caso di errore) e riutilizzato da tutti i ticker — una sola chiamata FMP per tutti i simboli.

| Parametro | Env var | Default |
|---|---|---|
| Abilita/disabilita | `DE_FOMC_GUARD_ENABLED` | `true` |
| Finestra di blocco | `DE_FOMC_BLOCK_DAYS` | `2` giorni |

**Keyword riconosciute:** `fomc`, `federal open market`, `fed rate`, `federal reserve rate`.

**Condizione di blocco:** `abs(oggi – dataFOMC) ≤ blockDays`.

**Su blocco:** log WARNING + evento `ENTRY.FOMC_PROXIMITY_BLOCKED` + hook `ENTRY_SIGNAL_BLOCKED_FOMC`.

---

### G4 — Macro Event Proximity (CPI / NFP)

**Applicabile a:** breakout e pullback.

Blocca i segnali in prossimità di dati macro ad alto impatto: CPI (Consumer Price Index) e NFP (Non-Farm Payroll). Utilizza lo stesso calendario economico già scaricato per il guardrail G3 (nessuna chiamata aggiuntiva).

| Parametro | Env var | Default |
|---|---|---|
| Abilita/disabilita | `DE_MACRO_GUARD_ENABLED` | `true` |
| Finestra di blocco | `DE_MACRO_BLOCK_DAYS` | `1` giorno |

**Keyword riconosciute:** `cpi`, `consumer price`, `non-farm`, `nonfarm`, `nfp`, `payroll`.

**Filtro impatto:** solo eventi con `impact: "High"` nel calendario FMP.

**Condizione di blocco:** `abs(oggi – dataEvento) ≤ blockDays`.

**Su blocco:** log WARNING + evento `ENTRY.MACRO_EVENT_PROXIMITY_BLOCKED` + hook `ENTRY_SIGNAL_BLOCKED_MACRO`.

---

### G5 — Dividend Ex-Date Proximity

**Applicabile a:** breakout e pullback.

Blocca i segnali prima della data di stacco dividendo (ex-dividend date) per evitare il gap-down tecnico che si verifica il giorno dell'ex-date.

```http
GET https://financialmodelingprep.com/stable/stock-dividends?symbol={TICKER}&apikey={FMP_API_KEY}
```

Il risultato è **cachato per 24 ore** per simbolo (1 ora in caso di errore). Vengono considerate solo le date di ex-dividend **future** (>= oggi).

| Parametro | Env var | Default |
|---|---|---|
| Abilita/disabilita | `DE_DIVIDEND_GUARD_ENABLED` | `true` |
| Finestra di blocco | `DE_DIVIDEND_BLOCK_DAYS` | `3` giorni |

**Condizione di blocco:** `0 ≤ giorniAllExDate ≤ blockDays`.

**Su blocco:** log WARNING + evento `ENTRY.DIVIDEND_PROXIMITY_BLOCKED` + hook `ENTRY_SIGNAL_BLOCKED_DIVIDEND`.

---

### G6 — Candle Range Check

**Applicabile a:** solo breakout.

Verifica che l'ultima candela intraday non sia troppo ampia (segnale di volatilità elevata = rischio slippage sull'entry).

```http
GET /cachemanager/candles/latest?symbol={TICKER}&tf={LIVE_INTRADAY_TF}
```

```
candleRange = candle.high - candle.low
maxRange    = flagAtrK × atrLast

Blocco se: candleRange > maxRange
```

| Parametro | Env var | Default |
|---|---|---|
| Timeframe candle | `LIVE_INTRADAY_TF` | `1min` |

`atrLast` e `flagAtrK` provengono dallo snapshot Fase 5.

**Su blocco:** log WARNING. Nessun hook/evento emesso (blocco tecnico puro, non richiede notifica utente).

---

### G7 — Opening Window Block

**Applicabile a:** solo breakout.

Blocca i segnali di breakout durante i primi N minuti dall'apertura del mercato, quando la volatilità di apertura può generare falsi breakout.

| Parametro | Env var | Default |
|---|---|---|
| Finestra di blocco | `BREAKOUT_OPEN_BLOCK_MINUTES` | `25` minuti |
| Orario apertura mercato (UTC) | `MARKET_OPEN_UTC` | `14:30` (NYSE, ora standard) |

:::tip Orario DST
In ora legale USA, NYSE apre alle 13:30 UTC. Impostare `MARKET_OPEN_UTC=13:30` durante il periodo di DST.
:::

Il segnale è **differito** (non scartato): rimane attivo e viene rivalutato al tick successivo.

**Su blocco:** log INFO + evento `ENTRY.BREAKOUT_OPEN_BLOCKED` + hook `ENTRY_SIGNAL_DEFERRED` (rate-limited: max 1 notifica per `alertKey` ogni 5 minuti).

---

### G8 — IBKR Account Check (fail-closed)

**Applicabile a:** breakout e pullback (eseguito prima dell'invio ordine).

Verifica che l'account IBKR attivo sia un account **PAPER** (ID con prefisso `DU`). Gli account LIVE (ID con prefisso `U`) sono **bloccati permanentemente**.

```http
GET /ibkr-bridge/accounts
```

Il risultato è **cachato per 5 minuti** in memoria.

| Condizione account | Comportamento |
|---|---|
| ID inizia con `DU` (PAPER) | Ordine permesso |
| ID inizia con `U` (LIVE) | Ordine bloccato (log ERROR) |
| Chiamata fallita | Ordine bloccato (fail-closed — si preferisce non agire in caso di incertezza) |

:::danger Sicurezza
Questo guardrail è **fail-closed**: se il microservizio `ibkr-bridge` non risponde, l'ordine viene bloccato. Non vengono mai usati fallback o default. Il sistema non opererà su account LIVE in nessuna circostanza.
:::

---

### G9 — Position Sizing (Capital Manager)

Non è un guardrail bloccante, ma il passaggio di sizing prima dell'ordine.

Il motore chiede al `capital-manager` la quantità in dollari da allocare per il ticker:

```http
GET /capital-manager/capital?symbol={TICKER}
```

La quantità in contratti viene calcolata come:

```
quantity = max(1, floor(dollars / entryLimit))
```

Se il `capital-manager` non è configurato o non risponde, viene usato il fallback da env var:

| Parametro | Env var | Default |
|---|---|---|
| Dollari per trade (fallback) | `DE_DOLLARS_PER_TRADE` | `5000` |

:::note
Il fallback da `$5000` si applica solo su account PAPER (G8 blocca prima per gli account LIVE).
:::

---

## Struttura dell'ordine bracket

L'ordine inviato a `brokerExecutor-ibkr` è un **ordine bracket** composto da:

| Campo | Valore |
|---|---|
| `symbol` | Ticker (es. `AAPL`) |
| `side` | `BUY` |
| `quantity` | Calcolato dal capital manager (G9) |
| `limitPrice` | `entryLimit` dallo snapshot Fase 5 |
| `stopLossPrice` | `stopLoss` dallo snapshot Fase 5 |
| `stopLossLimitPrice` | `stopLoss × 0.998` (0.2% di slippage SL) |
| `takeProfitPrice` | `takeProfit1` (se disponibile) |
| `timeInForce` | `DAY` (configurabile via `DE_ORDER_TIF`) |
| `externalCorrelationId` | UUID del segnale (tracciabilità end-to-end) |

L'ordine è **fire-and-forget**: il loop di monitoraggio non attende la risposta del broker per continuare a elaborare tick.

---

## Gestione runtime dei guardrail (senza riavvio)

I guardrail G2–G5 sono configurabili **a caldo** tramite API, senza riavviare il `decision-engine`:

```http
GET /decision-engine/guards/config
```

Risposta:

```json
{
  "ok": true,
  "data": {
    "earnings":  { "enabled": true,  "blockDays": 14 },
    "fomc":      { "enabled": true,  "blockDays": 2  },
    "macro":     { "enabled": true,  "blockDays": 1  },
    "dividend":  { "enabled": true,  "blockDays": 3  }
  }
}
```

Per modificare in tempo reale:

```http
PATCH /decision-engine/guards/config
Content-Type: application/json

{
  "earnings": { "blockDays": 7 },
  "fomc":     { "enabled": false },
  "macro":    { "blockDays": 2 },
  "dividend": { "enabled": true, "blockDays": 5 }
}
```

Solo i campi specificati vengono aggiornati. Gli altri restano invariati.

Per il guardrail earnings è supportata anche l'unità settimane come convenienza:

```json
{ "earnings": { "blockWeeks": 3 } }
```

:::warning Persistenza
Le modifiche runtime sono **in-memory** e si perdono al riavvio del servizio. Per rendere permanenti le modifiche, aggiornare le variabili d'ambiente nel file `.env` o nel Docker Compose.
:::

---

## Catalogo eventi e notifiche

Ogni blocco pubblica un evento sul canale Redis `{ENV}.decision-engine.events` e (con rate-limit di 5 minuti per `alertKey`) un messaggio sul canale `{ENV}.hooks` consumato dall'`alertingservice`.

| Guardrail | Hook event | Events channel eventId | Segnale rimane attivo? |
|---|---|---|---|
| G1 Risk Regime | — | — | No (bloccato fino a cambio regime) |
| G2 Earnings | `ENTRY_SIGNAL_BLOCKED_EARNINGS` | `ENTRY.EARNINGS_PROXIMITY_BLOCKED` | Sì |
| G3 FOMC | `ENTRY_SIGNAL_BLOCKED_FOMC` | `ENTRY.FOMC_PROXIMITY_BLOCKED` | Sì |
| G4 Macro CPI/NFP | `ENTRY_SIGNAL_BLOCKED_MACRO` | `ENTRY.MACRO_EVENT_PROXIMITY_BLOCKED` | Sì |
| G5 Dividend | `ENTRY_SIGNAL_BLOCKED_DIVIDEND` | `ENTRY.DIVIDEND_PROXIMITY_BLOCKED` | Sì |
| G6 Candle Range | — | — | Sì |
| G7 Opening Window | `ENTRY_SIGNAL_DEFERRED` | `ENTRY.BREAKOUT_OPEN_BLOCKED` | Sì |
| G8 IBKR Account | — | — | No (errore strutturale) |

**"Segnale rimane attivo"** significa che `lastAlertByKey` non viene aggiornato: il segnale sarà rivalutato al tick successivo senza attendere `ALERT_COOLDOWN_MS`.

---

## Parametri di pilotaggio

### Guardrail eventi (G2–G5)

| Parametro | Env var | Default | Modifica runtime |
|---|---|---|---|
| Earnings: abilita | `DE_EARNINGS_GUARD_ENABLED` | `true` | `PATCH /guards/config` |
| Earnings: finestra | `EARNINGS_BLOCK_WEEKS` | `2` settimane | `PATCH /guards/config` |
| FOMC: abilita | `DE_FOMC_GUARD_ENABLED` | `true` | `PATCH /guards/config` |
| FOMC: finestra | `DE_FOMC_BLOCK_DAYS` | `2` giorni | `PATCH /guards/config` |
| Macro: abilita | `DE_MACRO_GUARD_ENABLED` | `true` | `PATCH /guards/config` |
| Macro: finestra | `DE_MACRO_BLOCK_DAYS` | `1` giorno | `PATCH /guards/config` |
| Dividend: abilita | `DE_DIVIDEND_GUARD_ENABLED` | `true` | `PATCH /guards/config` |
| Dividend: finestra | `DE_DIVIDEND_BLOCK_DAYS` | `3` giorni | `PATCH /guards/config` |

### Guardrail tecnici (G6–G7)

| Parametro | Env var | Default |
|---|---|---|
| Timeframe candle intraday | `LIVE_INTRADAY_TF` | `1min` |
| Opening window (minuti) | `BREAKOUT_OPEN_BLOCK_MINUTES` | `25` |
| Orario apertura mercato UTC | `MARKET_OPEN_UTC` | `14:30` |

### Esecuzione ordine (G8–G9)

| Parametro | Env var | Default |
|---|---|---|
| URL broker executor | `BROKER_EXECUTOR_URL` | `http://broker-executor-ibkr:3003` |
| URL ibkr bridge | `IBKRBRIDGE_URL` | `http://ibkr-bridge:3017` |
| URL capital manager | `CAPITALMANAGER_URL` | _(vuoto = solo fallback)_ |
| Dollari per trade (fallback) | `DE_DOLLARS_PER_TRADE` | `5000` |
| Time-in-force ordine | `DE_ORDER_TIF` | `DAY` |
| TTL cache account IBKR | _(hardcoded)_ | `5 min` |
| FMP API Key (guardrail G2–G5) | `FMP_API_KEY` | obbligatorio per guardrail |

---

## Microservizi coinvolti

| Microservizio | Ruolo nella Fase 7 |
|---|---|
| `decision-engine` | Orchestrazione guardrail, sizing, invio ordine (fire-and-forget) |
| `brokerExecutor-ibkr` | Ricezione e trasmissione dell'ordine bracket a IBKR via `ibkr-bridge` |
| `ibkr-bridge` | Verifica account (G8) e canale di comunicazione con TWS/Gateway IBKR |
| `capital-manager` | Position sizing (G9) — opzionale, con fallback |
| `liquidity-manager` | Regime macro (G1) — cache dalla Fase 6, non ricalcolato |
| `alertingservice` | Consumatore del canale `{ENV}.hooks` — notifica i blocchi all'utente |

---

## Avvio manuale e monitoraggio

La Fase 7 non ha un endpoint di avvio dedicato: è embedded nel loop live della Fase 6 e si attiva automaticamente quando la Fase 6 è in esecuzione.

### Leggere la configurazione guardrail corrente

```http
GET /decision-engine/guards/config
```

### Modificare un guardrail a runtime

```http
PATCH /decision-engine/guards/config
Content-Type: application/json

{ "earnings": { "enabled": false } }
```

### Verificare lo stato dell'account IBKR

```http
GET /ibkr-bridge/accounts
```

L'account paper ha ID che inizia con `DU` (es. `DU1234567`).

### Log attesi durante l'esecuzione

| Log | Livello | Significato |
|---|---|---|
| `[live] BUY SIGNAL: ticker=... mode=...` | INFO | Tutti i guardrail superati, segnale emesso |
| `[live] EARNINGS PROXIMITY BLOCK ticker=...` | WARNING | Blocco per earnings imminenti |
| `[live] FOMC PROXIMITY BLOCK ticker=...` | WARNING | Blocco per FOMC imminente |
| `[live] MACRO EVENT PROXIMITY BLOCK ticker=...` | WARNING | Blocco per CPI/NFP imminente |
| `[live] DIVIDEND EX-DATE BLOCK ticker=...` | WARNING | Blocco per ex-dividend date imminente |
| `[live] BUY SIGNAL BLOCKED ... riskRegime=RISK_OFF` | WARNING | Blocco per regime macro |
| `[live] BREAKOUT OPEN BLOCK ticker=...` | INFO | Segnale differito (alta volatilità apertura) |
| `[live] ORDER BLOCKED ... not PAPER` | ERROR | Account non PAPER — ordine bloccato |
| `[live] broker order placed orderId=...` | INFO | Ordine accettato dal broker |
| `[live] broker order rejected status=...` | WARNING | Ordine rifiutato dal broker |
| `[live] capitalManager dollars=...` | INFO | Sizing ricevuto dal capital manager |

---

## Errori comuni e recovery

| Errore | Causa probabile | Recovery |
|---|---|---|
| Nessun ordine inviato nonostante segnali Fase 6 | Guardrail attivo (earnings/FOMC/macro/dividend) | Verificare log WARNING + `GET /guards/config`. Disabilitare il guardrail specifico se necessario con `PATCH /guards/config`. |
| `ORDER BLOCKED ... not PAPER` nei log | Account IBKR configurato come LIVE o `ibkr-bridge` non raggiungibile | Verificare `GET /ibkr-bridge/accounts`. Se l'account è corretto, verificare lo stato di `ibkr-bridge`. |
| `earnings fetch failed` nei log | `FMP_API_KEY` non configurata o limite API raggiunto | Verificare che `FMP_API_KEY` sia presente nel file `.env`. L'errore causa retry dopo 1 ora. |
| `economic calendar fetch failed` | `FMP_API_KEY` non configurata o FMP non raggiungibile | I guardrail G3 e G4 vengono saltati. Il sistema continua a operare. Retry dopo 30 minuti. |
| Segnale bloccato in apertura da ore | `MARKET_OPEN_UTC` configurato con fuso orario errato | Verificare e correggere `MARKET_OPEN_UTC` (14:30 ora solare, 13:30 ora legale USA). |
| Ordini con quantità = 1 sempre | `capital-manager` non raggiungibile e `DE_DOLLARS_PER_TRADE` troppo basso rispetto al prezzo | Aumentare `DE_DOLLARS_PER_TRADE` o configurare il `capital-manager`. |
| `capitalManager fetch failed` | `CAPITALMANAGER_URL` non configurata o servizio non avviato | Atteso se il `capital-manager` non è deployato. Il fallback `DE_DOLLARS_PER_TRADE` viene usato. |
