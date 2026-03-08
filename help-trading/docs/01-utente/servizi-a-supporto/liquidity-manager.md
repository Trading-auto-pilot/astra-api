---
sidebar_position: 2
---

# liquidity-manager

Il `liquidity-manager` e il servizio che misura in tempo reale la "qualita" del contesto macro/mercato e restituisce un indicatore sintetico usato dagli altri microservizi.

In pratica risponde alla domanda: **il mercato e in una fase favorevole al rischio oppure in una fase di difesa?**

---

## In sintesi

| Voce | Dettaglio |
|---|---|
| **Scopo** | Calcolare uno score di liquidita/rischio e un regime operativo (`RISK_ON`, `NEUTRAL`, `RISK_OFF`, `UNKNOWN`) |
| **Output principale** | `score` (0-100), `riskRegime`, `volatilityRegime`, `confidence` |
| **Chi lo usa** | `decision-engine` (guardrail macro), `capital-manager` (quanto investire), processi live |
| **Porta** | `3001` |
| **Prefisso API** | `/liquidity-score` (via Traefik: `/liquidity-manager/liquidity-score`) |

---

## Come funziona (alto livello)

1. Raccoglie dati da piu fonti di mercato (VIX, trend SPY, DXY, credit spread).
2. Normalizza ogni componente su scala `0-100`.
3. Applica pesi fissi ai componenti disponibili.
4. Calcola uno `score` aggregato e la `confidence` del risultato.
5. Deriva `riskRegime` e `volatilityRegime`.

Se una o piu fonti non sono disponibili, il servizio continua comunque in **fail-soft**: abbassa la confidenza e, se necessario, imposta regime `UNKNOWN`.

---

## Argomenti in questa sezione

- [Fonti dati considerate](./liquidity-manager-fonti-dati)
- [Calcoli e logica di scoring](./liquidity-manager-calcoli)
