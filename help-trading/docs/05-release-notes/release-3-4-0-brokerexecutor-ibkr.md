---
sidebar_position: 3
title: brokerExecutor-ibkr
---

# brokerExecutor-ibkr (nuovo microservizio)

In questa release `3.4.0` e stato introdotto il microservizio `brokerExecutor-ibkr`.

## Scopo

`brokerExecutor-ibkr` centralizza l'esecuzione ordini verso IBKR, separando la logica di trading decisionale dalla logica di broker execution.

## Funzionamento generale

1. Riceve richieste operative dai servizi interni (in particolare `decision-engine`).
2. Valida il payload ordine (strumento, lato, quantita, vincoli base).
3. Interagisce con i layer IBKR (`ibkr-bridge` / gateway) per invio e gestione ordini.
4. Espone stato ordini e posizioni per monitoraggio e riconciliazione.
5. Pubblica eventi/log su Redis bus per tracciabilita e alerting.

## Benefici introdotti in release 3.4.0

- separazione chiara tra decisione e esecuzione;
- punto unico per gestione lifecycle ordine;
- maggiore osservabilita su ordini aperti, update e errori broker.
