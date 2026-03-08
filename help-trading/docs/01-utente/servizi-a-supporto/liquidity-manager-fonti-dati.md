---
sidebar_position: 3
---

# Fonti dati considerate

Il `liquidity-manager` combina quattro componenti principali.

## Componenti

| Componente | Cosa misura | Peso default |
|---|---|---|
| `vix` | Stress/paura implicita del mercato | `0.35` |
| `spyTrend` | Forza del trend azionario US (SPY) | `0.35` |
| `dxy` | Forza del dollaro (proxy condizioni finanziarie) | `0.15` |
| `credit` | Stress nel credito | `0.15` |

## Sorgenti usate

| Componente | Sorgenti principali | Note |
|---|---|---|
| `vix` | Stooq, fallback FRED (`VIXCLS`) | Chain provider con fallback automatico |
| `spyTrend` | Storico SPY da Stooq | Usato per SMA/trend |
| `dxy` | FRED / Yahoo / Stooq (configurabile) | Supporta fallback e retry |
| `credit` | FRED (serie default `BAA10Y`) | Puo essere disabilitato via config |

## Qualita della fonte e fallback

Per ogni componente viene tracciato uno stato (`OK`, `MISSING`, `ERROR`) con dettaglio errore. Se una fonte fallisce:

- il componente non contribuisce allo score;
- la confidenza totale si riduce;
- il sistema puo degradare a regime `UNKNOWN`.

Questo evita blocchi completi del servizio quando una singola API esterna non e disponibile.
