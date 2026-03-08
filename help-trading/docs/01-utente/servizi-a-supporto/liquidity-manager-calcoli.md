---
sidebar_position: 4
---

# Calcoli e logica di scoring

## 1) Normalizzazione componenti

Ogni componente viene convertito su scala `0-100` (alto = contesto piu favorevole al rischio).

Esempi:

- VIX alto -> normalizzato piu basso (maggiore stress).
- Trend SPY positivo -> normalizzato piu alto.
- DXY e credit spread vengono trasformati con normalizzatori dedicati.

## 2) Aggregazione pesata

Lo score finale e calcolato **solo sui componenti disponibili**:

```text
effectiveScore = sum(normalized_i * weight_i) / sum(weight_i disponibili)
```

Se nessun componente e disponibile:

- `score = null`
- `confidence = 0`
- `riskRegime = UNKNOWN`

## 3) Confidence

La confidenza misura quanta parte del peso totale e coperta da dati validi:

```text
confidence = availableWeight / totalWeight
```

Soglia di regime: `LIQ_MIN_CONFIDENCE_FOR_REGIME` (default `0.60`).

Se `confidence` e sotto soglia, il regime viene forzato a `UNKNOWN`.

## 3b) Confidence e fallback

La `confidence` indica quanta parte del modello e coperta da dati effettivamente disponibili.

Formula:

```text
confidence = availableWeight / totalWeight
```

- `availableWeight`: somma dei pesi dei componenti con stato `OK`.
- `totalWeight`: somma dei pesi configurati (`vix + spyTrend + dxy + credit`).

Esempio rapido:

- Se sono disponibili solo `vix` (0.35) e `spyTrend` (0.35), allora:
  `confidence = 0.70`.

### Soglia configurabile

La soglia minima e configurata da:

- `LIQ_MIN_CONFIDENCE_FOR_REGIME` (default `0.60`)

### Cosa succede sotto soglia (fallback)

Quando `confidence` e sotto soglia:

- il `riskRegime` viene forzato a `UNKNOWN` (fallback prudente);
- il sistema evita di considerare affidabile il contesto macro;
- i servizi a valle (es. `capital-manager`) tendono a comportamenti piu conservativi.

In questo modo il sistema rimane operativo anche con dati parziali, ma senza prendere decisioni aggressive con informazione incompleta.

## 4) Regimi

### Risk Regime

| Condizione | Output |
|---|---|
| `score < 30` e confidence sufficiente | `RISK_OFF` |
| `score > 60` e confidence sufficiente | `RISK_ON` |
| tra `30` e `60` con confidence sufficiente | `NEUTRAL` |
| score non valido o confidence bassa | `UNKNOWN` |

Interpretazione operativa (quando il contesto e piu favorevole):

- `RISK_ON`: e il contesto **piu favorevole** a nuovi ingressi long. In genere coincide con mercato piu "bullish" (propensione al rischio alta).
- `NEUTRAL`: contesto intermedio. Possibili ingressi, ma con selezione/timing piu rigidi.
- `RISK_OFF`: contesto difensivo, in genere piu "bearish" o instabile. Nuovi ingressi andrebbero ridotti o evitati.
- `UNKNOWN`: mancano dati affidabili; in pratica va trattato in modo prudente come `RISK_OFF` finche la confidenza non torna sufficiente.

### Volatility Regime

Derivato dalla componente VIX:

| Condizione VIX | Output |
|---|---|
| `VIX <= 15` | `LOW` |
| `15 < VIX < 25` | `NORMAL` |
| `VIX >= 25` | `HIGH` |
| componente VIX non disponibile | `UNKNOWN` |

Il VIX (CBOE Volatility Index) misura la volatilita implicita attesa sull'azionario USA nel breve periodo (spesso chiamato "indice della paura").

Lettura pratica per contesto di mercato:

- VIX basso (tipicamente `<= 15`): mercato piu stabile, spesso associato a fase **bullish**.
- VIX medio (`15-25`): fase di transizione/normalita, mercato non chiaramente bullish o bearish.
- VIX alto (`>= 25`): stress e incertezza elevati, piu spesso associati a fase **bearish** o risk-off.

Nota: il VIX da solo non basta per definire il trend. Per questo il `liquidity-manager` lo combina con trend SPY, DXY e credit spread.

## 5) Come viene usato a livello utente

- In fasi live, aiuta a filtrare segnali in base al regime macro.
- Nel sizing (`capital-manager`) influisce sulla quota di capitale da mantenere in riserva.

Quindi non decide "quale ticker comprare", ma **in quale contesto di rischio ci troviamo** e con quanta confidenza.
