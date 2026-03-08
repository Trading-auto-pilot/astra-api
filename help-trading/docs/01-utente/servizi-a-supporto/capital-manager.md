---
sidebar_position: 1
---

# capital-manager

Il `capital-manager` è il servizio che **decide quanta liquidità può essere investita per ogni operazione di acquisto**.

Prima che il `decision-engine` invii un ordine a broker, interroga il `capital-manager` per sapere il massimo importo disponibile per quel trade, tenendo conto del conto IBKR, degli ordini aperti e del regime di mercato corrente.

---

## In sintesi

| Voce | Dettaglio |
|---|---|
| **Scopo** | Calcolare il capitale massimo investibile per ogni segnale di acquisto |
| **Input principali** | Cash disponibile (IBKR) + regime macro (liquidity-manager) + ordini aperti + prenotazioni attive |
| **Output** | `maxInvestable` — importo in USD che può essere usato per l'ordine |
| **Porta** | `3010` |
| **Prefisso API** | `/allocation` |

---

## Perché esiste

Senza il `capital-manager`, il sistema non avrebbe un meccanismo centralizzato per:

1. **Evitare l'over-allocation** — più segnali possono attivarsi contemporaneamente; senza prenotazioni ogni trade potrebbe "credere" di avere il conto pieno.
2. **Calibrare l'esposizione al rischio di mercato** — in regime RISK_OFF o con volatilità alta, il sistema è automaticamente più conservativo.
3. **Adattarsi alla liquidità disponibile** — se il `liquidity-manager` riporta uno score basso, si tiene più cash di riserva.

---

## Come si inserisce nel flusso (Fase 7)

```text
[Fase 6: ENTRY_SIGNAL]
       |
       v
[decision-engine: guardrail G1-G8]
       |
       v
[capital-manager: POST /allocation/quote]  ← qui
       |
       v
maxInvestable → quantità = floor(maxInvestable / entryLimit)
       |
       v
[broker-executor-ibkr: ordine bracket]
```

---

## Argomenti in questa sezione

- [Come funziona l'allocazione](./capital-manager-allocazione) — la formula che determina quanta liquidità può essere investita
- [Sistema di prenotazioni](./capital-manager-prenotazioni) — come il sistema previene l'over-allocation in parallelo
- [Parametri e configurazione](./capital-manager-parametri) — le variabili d'ambiente che controllano il comportamento
