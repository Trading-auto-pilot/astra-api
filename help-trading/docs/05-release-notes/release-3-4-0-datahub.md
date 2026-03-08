---
sidebar_position: 5
title: datahub
---

# datahub (refactoring completo di DBManager)

In release `3.4.0` `datahub` sostituisce `DBManager` con un refactoring completo orientato a endpoint dinamici e manutenzione semplificata.

## Cosa cambia rispetto a DBManager

Con `DBManager` gli endpoint per tabella venivano creati/adattati manualmente.
Con `datahub` il servizio si collega al repository dati (MySQL), legge lo schema e genera automaticamente gli endpoint CRUD per ogni tabella/vista.

## Generazione automatica endpoint (5 per tabella)

Per ogni tabella vengono creati automaticamente 5 endpoint:

1. `GET /api/table/{table}` (lista)
2. `GET /api/table/{table}/{pk}` (dettaglio)
3. `POST /api/table/{table}` (creazione)
4. `PUT /api/table/{table}/{pk}` (aggiornamento)
5. `DELETE /api/table/{table}/{pk}` (cancellazione)

## Endpoint custom automontati

Oltre agli endpoint generati, `datahub` supporta endpoint manuali custom.

- Direttorio custom route: `trading-system/datahub/routes/`
- Caricamento automatico tramite `ManualRoutesLoader`
- Montaggio automatico sotto prefisso: `/api/custom/{nome-file}`

Esempio: `routes/marketDaily.js` viene montato su `/api/custom/marketDaily/*`.

## Endpoint datahub per rigenerare API senza restart

`datahub` espone endpoint interni per ricaricare schema e route a runtime:

- `GET /api/schema` -> stato schema, tabelle e manual routes caricate
- `POST /api/refresh` -> refresh schema + rigenerazione endpoint dinamici + reload route manuali

Questo permette di rigenerare le API senza riavviare il microservizio.
