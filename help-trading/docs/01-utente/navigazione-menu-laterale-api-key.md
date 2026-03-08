---
sidebar_position: 3
---

# API Key

La sezione **API Key** permette di creare, modificare e revocare chiavi per accesso programmatico alle API.

## Lista API key e creazione

<img
  src="/img/utente/navigazione/api-key-lista.png"
  alt="Lista API key e creazione"
  style={{ width: "100%", maxWidth: "950px", display: "block", margin: "0 auto" }}
/>

Funzioni principali:

- creare una nuova API key;
- vedere lista chiavi con stato attivo/non attivo;
- impostare `Owner User ID` (facoltativo);
- impostare data di scadenza (`expires_at`, facoltativa).

Attenzione importante:

- dopo la creazione il valore completo della chiave e mostrato una sola volta;
- la chiave va copiata subito e salvata in modo sicuro;
- nelle viste successive la chiave risulta mascherata.

## Modifica API key e permessi

<img
  src="/img/utente/navigazione/api-key-modifica.png"
  alt="Modifica API key e permessi"
  style={{ width: "100%", maxWidth: "950px", display: "block", margin: "0 auto" }}
/>

In modifica puoi:

- aggiornare nome, owner, scadenza, stato attivo;
- eliminare la API key;
- configurare i permessi API con la stessa logica usata per gli utenti:
  - `HTTP METHOD`
  - `RESOURCE PATTERN` (path, con supporto wildcard `*`)
  - `is_allowed`

## Come usare la API key (dal codice)

L'autenticazione API key avviene passando la chiave negli header:

- `X-API-Key` (supportato)
- `X-API_Key` (supportato per compatibilita)

Nel flusso di validazione forward-auth:

- il sistema verifica chiave attiva/non scaduta;
- controlla i permessi su metodo + path;
- espone `X-Api-Key-Id` come identita tecnica.

## Owner User ID e token: cosa succede

In base all'implementazione attuale:

- `owner_user_id` e un metadato della API key (utile per ownership/tracciamento);
- usando `X-API-Key` non viene emesso automaticamente un JWT utente;
- quindi lo `userId` non viene estratto da un token JWT in questo flusso;
- viene identificata la chiave (`X-Api-Key-Id`) e autorizzata tramite permessi associati alla chiave.

