---
sidebar_position: 2
title: ibkr-login-desktop
---

# ibkr-login-desktop (nuovo microservizio)

In questa release `3.5.0` e stato introdotto il microservizio `ibkr-login-desktop`.

## Scopo

`ibkr-login-desktop` fornisce un desktop remoto containerizzato per eseguire il login alla piattaforma IBKR Client Portal Gateway da qualsiasi dispositivo, inclusi dispositivi mobili, senza richiedere l'installazione di software locale.

Il problema che risolve: IBKR richiede un login interattivo tramite browser sul Client Portal Gateway. Questo non e possibile direttamente dal trading system automatizzato. `ibkr-login-desktop` espone un desktop virtuale (via VNC/noVNC) accessibile da browser, permettendo all'operatore di autenticarsi su IBKR in modo sicuro dalla stessa interfaccia web del sistema.

## Architettura

Il microservizio combina due componenti principali in un unico container:

| Porta | Componente | Scopo |
| --- | --- | --- |
| `3009` | Node.js REST API | General Settings, gestione credenziali salvate, endpoint `/credentials/fill` per auto-compilazione form |
| `6080` | noVNC + websockify | Desktop remoto accessibile via browser su `/ibkr-login/vnc.html` |

Il container condivide il network namespace con `ibkrgw-paper` (`network_mode: "service:ibkrgw-paper"`), cosi da poter raggiungere direttamente il Client Portal Gateway sulla porta `5000` in localhost.

## Funzionamento generale

1. L'operatore naviga su `/ibkr-login/vnc.html` dal browser (desktop o mobile).
2. Il noVNC mostra il desktop virtuale del container.
3. Nel desktop virtuale e aperto un browser con il Client Portal Gateway (`http://localhost:5000`).
4. L'operatore inserisce le credenziali IBKR e completa il login.
5. Una volta autenticato, il gateway rilascia un token di sessione valido per `ibkr-bridge` e `ibkr-keepalive`.

## Funzionalita REST API (porta 3009)

- `GET /ibkr-login-desktop/credentials` — legge username salvato (la password non viene mai restituita)
- `POST /ibkr-login-desktop/credentials` — salva username e/o password cifrata
- `POST /ibkr-login-desktop/credentials/fill` — compila automaticamente il form di login nel browser del desktop remoto

## Integrazione con la pagina Mobile

Il bottone **"Apri Desktop IBKR"** sulla pagina mobile (`#/mobile`) apre direttamente la URL noVNC in una nuova scheda del browser del dispositivo mobile, permettendo il login IBKR anche da smartphone.

## Routing Traefik (ambiente PAPER)

| Path | Destinazione | Auth |
| --- | --- | --- |
| `trading.expovin.it/ibkr-login-desktop/*` | API Node.js porta 3009 | `auth-forward` richiesta |
| `trading.expovin.it/ibkr-login/*` | noVNC porta 6080 | Nessuna auth (accesso diretto) |

## Benefici introdotti in release 3.5.0

- accesso al login IBKR da qualsiasi dispositivo senza software aggiuntivo;
- possibilita di salvare e auto-compilare le credenziali IBKR;
- integrazione con la nuova pagina mobile per operativita da smartphone;
- nessun impatto sull'infrastruttura esistente (container aggiuntivo opzionale via Docker profile `ibkr-login-desktop`).
