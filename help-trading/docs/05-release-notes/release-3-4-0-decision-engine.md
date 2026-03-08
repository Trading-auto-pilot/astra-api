---
sidebar_position: 6
title: decision-engine
---

# decision-engine

In release `3.4.0` questa e la prima versione in cui `decision-engine` integra il nuovo flusso con `capital-manager` e i controlli calendario pre-acquisto.

## Novita principali in questa release

1. Richiesta capitale da investire a `capital-manager`.
2. Controlli sul calendario per evitare acquisti vicino a date sensibili (eventi di rischio).

## Funzionamento generale

1. `decision-engine` valuta il segnale operativo sul ticker.
2. Prima dell'invio ordine richiede a `capital-manager` il capitale investibile (`se` e `quanto` investire).
3. Esegue i controlli calendario per bloccare/ritardare acquisti in prossimita di date critiche.
4. Solo se entrambi i controlli sono superati, prosegue nel flusso operativo.

## Approfondimento capitale da investire

Per i dettagli funzionali e operativi di `capital-manager` vedi:

- [Guida utente - capital-manager](/docs/utente/servizi-a-supporto/capital-manager)
