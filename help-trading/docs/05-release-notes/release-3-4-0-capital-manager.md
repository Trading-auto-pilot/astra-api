---
sidebar_position: 4
title: capital-manager
---

# capital-manager (nuovo microservizio)

In questa release `3.4.0` e stato introdotto il microservizio `capital-manager`.

## Scopo

`capital-manager` calcola se e quanto capitale allocare su un'operazione, applicando regole di rischio, concentrazione e disponibilita cassa.

## Funzionamento generale

1. Riceve il contesto richiesta (utente, ticker, prezzo, metadati operativi).
2. Recupera stato portfolio e limiti configurati (via servizi interni/datahub).
3. Applica vincoli di allocazione (ticker, settore, industry, area, budget disponibile).
4. Restituisce una decisione quantitativa (`allowed / amount`) usata da `decision-engine`.
5. Supporta prenotazioni capitale per evitare over-allocation in presenza di ordini concorrenti.

## Benefici introdotti in release 3.4.0

- controllo centralizzato del capitale investibile;
- riduzione rischio di sovraesposizione per dimensione;
- base tecnica per policy di allocazione piu evolute.
