---
sidebar_position: 2
title: Strategy to Enter
---

# Strategy to Enter

## Obiettivo

Introdurre nel sistema una strategia di ingresso riusabile chiamata `time-confirmation-entry`, progettata per individuare setup di entrata con logica:

1. livello tecnico `support/resistance`
2. sweep di liquidita oltre il livello
3. reclaim del livello
4. conferma temporale sopra/sotto il livello
5. stop loss basato su ATR

La strategia deve essere deterministica, senza dipendenze esterne e pronta per uso in live trading con valutazione a ogni chiusura candela.

## Modulo da implementare

Percorso previsto:

```text
/strategy/timeConfirmationEntry.js
```

API principale:

```js
detectTimeConfirmationEntry(input) => signal
```

Funzioni interne richieste:

- `detectSweep()`
- `detectReclaim()`
- `detectConfirmation()`
- `computeStop()`

## Input richiesto

Il modulo riceve:

- `level`: livello di supporto/resistenza
- `direction`: `"long"` oppure `"short"`
- `timeframeMinutes`
- `candles: Candle[]` (OHLCV con timestamp)
- `atr` (fornito da servizio indicatori esterno)
- `config` con:
  - `sweepThresholdPct`
  - `confirmationCandles`
  - `maxReclaimDistancePct`
  - `atrStopMultiplier`

Esempio config operativo:

```json
{
  "sweepThresholdPct": 0.5,
  "confirmationCandles": 1,
  "maxReclaimDistancePct": 0.4,
  "atrStopMultiplier": 1.2
}
```

## Flusso logico LONG

### 1) Sweep del supporto

Sweep valido se:

```text
low < level * (1 - sweepThresholdPct/100)
```

### 2) Reclaim

Dopo la candela di sweep, il prezzo deve chiudere sopra livello:

```text
close > level
```

Se non avviene reclaim entro 3 candele dal sweep, setup annullato.

### 3) Time confirmation

Il prezzo deve restare sopra livello per `N` candele complete (`confirmationCandles`), filtrando falsi breakout.

### 4) Entry

Ingresso su rottura del massimo della candela di conferma:

```text
entryPrice = confirmationCandle.high
```

### 5) Stop loss ATR-based

```text
stopCandidate1 = sweepLow - (ATR * atrStopMultiplier)
stopCandidate2 = sweepLow
stopLoss = min(stopCandidate1, stopCandidate2)
```

### 6) Validazione rischio

Regola opzionale:

```text
risk = entryPrice - stopLoss
se risk > ATR * 2 => setup rifiutato
```

## Flusso logico SHORT

Versione simmetrica:

1. sweep sopra la resistenza
2. reclaim sotto livello
3. conferma temporale sotto livello
4. entry su break del minimo della candela di conferma
5. stop ATR simmetrico al caso long

## Output atteso

Se setup valido:

```json
{
  "signal": "long",
  "entryPrice": 0,
  "stopLoss": 0,
  "supportLevel": 0,
  "sweepLow": 0,
  "confirmationCandleTime": 0
}
```

Se non valido:

```json
{
  "signal": "none"
}
```

Vincolo operativo: restituire un solo segnale per ogni ciclo di sweep.

## Edge cases da gestire

- sweep multipli consecutivi
- gap candles
- dati candela mancanti o null
- ATR non disponibile

Con ATR mancante il modulo non deve produrre errori runtime: ritorna `signal: "none"` e passa da hook di logging.

## Requisiti non funzionali

- complessita `O(n)` su array candele
- esecuzione su stream candle-by-candle
- output deterministico a parita di input
- safe null checks su tutti i campi
- logging hooks per tracing e debug
- pronto per unit test (funzioni pure e isolate)

## Integrazione dati mercato

Le candele arrivano dal market data provider (es. feed storico/snapshot IBKR via layer interno `market-data-service`/`ibkr-bridge`).  
L'ATR (14 periodi) e fornito da un servizio indicatori esterno: la strategia non calcola ATR internamente.

## Test case di riferimento

Input di esempio:

- `support = 65`
- sequenza close (semplificata): `64.9`, `63.5` (sweep), `65.2` (reclaim), `65.4` (confirmation), `66.1`

Output atteso:

```json
{
  "signal": "long",
  "entryPrice": 65.4,
  "stopLoss": 62.9
}
```
