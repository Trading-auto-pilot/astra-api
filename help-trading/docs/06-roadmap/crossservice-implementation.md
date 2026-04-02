---
title: CrossService implementation
sidebar_position: 1
---

# CrossService implementation

## Obiettivo

Uniformare la lettura della configurazione applicativa su tutti i microservizi con questa precedence:

1. valore presente nella tabella `settings`
2. fallback su variabile d'ambiente `process.env`
3. fallback su default hardcoded nel codice

L'obiettivo e permettere una migrazione graduale microservizio per microservizio, senza rompere i servizi che continuano a usare il pattern storico basato solo su `process.env`.

## Libreria condivisa aggiornata

La libreria condivisa coinvolta e `shared/loadSettings`. Per il dettaglio completo della libreria vedi la documentazione [Shared Library — loadSettings](/docs/developer-esterno-api/shared-load-settings).

Le primitive gia esistenti sono rimaste invariate e quindi retrocompatibili:

- `initializeSettings`
- `getSetting`
- `reloadSettings`
- `getAllSettings`
- `setSetting`
- `persistSetting`

Sono stati aggiunti nuovi helper per la risoluzione centralizzata della configurazione:

- `getConfigValue`
- `getConfigString`
- `getConfigNumber`
- `getConfigInt`
- `getConfigBoolean`

## Comportamento dei nuovi helper

I nuovi helper applicano la stessa logica in tutti i servizi migrati:

1. cercano il valore nella cache dei `settings`
2. se assente, cercano il valore in `process.env`
3. se ancora assente, usano il fallback passato dal chiamante

Questo approccio consente di:

- non modificare il contratto dei servizi non ancora migrati
- non forzare una migrazione big-bang
- centralizzare la precedence in un solo punto
- supportare alias multipli per la stessa configurazione, quando necessario

## Esempio di migrazione

Prima:

```js
this.dbmanagerUrl = process.env.DATAHUB_URL || process.env.DBMANAGER_URL || "http://datahub:3000";
```

Dopo:

```js
const { getConfigString } = require("../../shared/loadSettings");

this.dbmanagerUrl = getConfigString(
  ["DATAHUB_URL", "DBMANAGER_URL"],
  "http://datahub:3000"
);
```

## Cosa e stato gia fatto

E stata introdotta nella shared library una patch retrocompatibile che aggiunge i nuovi helper senza cambiare il comportamento delle primitive storiche.

E stato inoltre migrato il microservizio `liquidity-manager` nei principali punti di lettura configurazione:

- bootstrap del servizio
- engine di calcolo score
- provider esterni
- repository
- client HTTP
- rate limiter Yahoo
- circuit breaker Yahoo

## Microservizi gia migrati

- `liquidity-manager`

## Microservizi non ancora migrati

- `authservice`
- `alertingservice`
- `broker-executor-ibkr`
- `cachemanager`
- `capital-manager`
- `datahub`
- `decision-engine`
- `help-trading`
- `ibkr-bridge`
- `ibkr-keepalive`
- `market-data-service`
- `market-simulator`
- `mcp-gateway`
- `redis-ws-bridge`
- `scheduler`
- `servicecontrolplane`
- `tickerscanner`

## Strategia di rollout

La strategia prevista e incrementale:

1. estendere la shared library
2. migrare un microservizio per volta
3. verificare che ogni servizio continui a supportare sia `settings` sia `env`
4. lasciare inalterati i servizi non ancora migrati fino alla loro conversione

## Benefici attesi

- configurazione centralizzata
- fallback compatibile con l'attuale modello basato su env
- riduzione della duplicazione di codice
- maggiore coerenza cross-microservizio
- base tecnica per future modifiche runtime dei parametri via `settings`
