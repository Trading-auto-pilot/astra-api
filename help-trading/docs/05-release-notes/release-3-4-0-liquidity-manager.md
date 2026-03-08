---
sidebar_position: 7
title: liquidity-manager
---

# liquidity-manager

In release `3.4.0` `liquidity-manager` entra nel flusso operativo come servizio dedicato alla valutazione del contesto di liquidita/mercato.

## Scopo

`liquidity-manager` fornisce un indicatore sintetico di stato mercato (score/regime) usato dai servizi decisionali per modulare il rischio operativo.

## Cosa fa (overview)

1. Raccoglie segnali e metriche da fonti dati di mercato.
2. Calcola indicatori aggregati (es. regime rischio/volatilita e confidence).
3. Espone un output normalizzato che puo essere consumato da altri microservizi (es. `decision-engine`, `capital-manager`).
4. Supporta fallback quando la qualita dati non e sufficiente.

## Approfondimento funzionale

Per la descrizione completa del funzionamento e dei calcoli:

- [Guida utente - liquidity-manager](/docs/utente/servizi-a-supporto/liquidity-manager)
