---
sidebar_position: 5
---

# alertmanager

L'`alertmanager` (microservizio `alertingService`) e il componente che trasforma eventi operativi in notifiche (email/WhatsApp) tramite regole.

## Come arrivano i messaggi

Nel flusso operativo i microservizi pubblicano eventi su Redis:

- canale dedicato **HOOK** (tipicamente `${ENV}.hooks`) per messaggi operativi pronti per notifica;
- canali `events` per eventi strutturati di microservizio (`${ENV}.{service}.events...`).

L'alertmanager applica regole e decide se inviare o meno una notifica.

## Catalogo messaggi per creare alert

Esiste un catalogo eventi (manifest) che descrive gli `eventKey` disponibili per ogni microservizio. Questo catalogo e la base consigliata per creare alert stabili e versionabili.

## Alert da logs

E possibile creare alert anche a partire dai logs (match su livello, servizio, modulo, funzione, messaggio regex).

:::warning Uso consigliato dei log-alert
Gli alert basati su logs dovrebbero essere una **eccezione temporanea**. Tenerli sempre attivi significa restare in ascolto su una coda molto busy (`*.logs.*`), con impatto su rumore, costi e manutenzione.
Per alert permanenti, preferire eventi strutturati (`eventKey`) nel catalogo.
:::

## Guida rapida creazione alert

- [Come creare un alert (step-by-step con screenshot)](./alertmanager-creare-alert)

## Catalogo eventi

La lista completa degli alert disponibili e stata spostata in una pagina dedicata:

- [Catalogo eventi (alert disponibili)](./alertmanager-catalogo-eventi)

## Nota pratica

Per i segnali live e blocchi guardrail, i messaggi HOOK principali arrivano tipicamente da `decision-engine` e `capital-manager`.

