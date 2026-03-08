---
sidebar_position: 9
title: tickerScanner
---

# tickerScanner

In release `3.4.0` e stato fatto un grosso refactoring del `tickerScanner` per migliorare la selezione di ticker e, come novita, includere anche ETF con profilo di volatilita piu contenuto.

## Cosa cambia in questa versione

- Refactoring importante del motore di calcolo/filtraggio per favorire strumenti meno volatili.
- Introduzione del supporto ETF nel processo di selezione.
- Disabilitazione temporanea della gestione pipe per utente.

## Nota su pipe per utente

In questa release la gestione delle pipe utente e stata temporaneamente sospesa.
Nelle prossime versioni il comportamento verra reintrodotto come pipe dedicata, con possibilita di customizzazione.

## Approfondimento flusso operativo

Per il dettaglio completo del processo end-to-end:

- [Guida utente - Flusso di lavoro](/docs/utente/flusso-di-lavoro)
