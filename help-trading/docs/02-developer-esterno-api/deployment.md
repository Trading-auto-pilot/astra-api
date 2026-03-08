---
sidebar_position: 3
---

# Deployment

Questa sezione descrive gli ambienti di esecuzione del sistema.

## Variabile `ENV`

L'ambiente attivo e definito dalla variabile:

- `ENV=LOCAL`
- `ENV=PAPER`
- `ENV=LIVE`

`ENV` viene letta dai microservizi per:

- selezionare configurazioni runtime e endpoint esterni;
- separare canali/log/eventi per ambiente;
- applicare comportamenti diversi su integrazioni broker e automazioni.

## Ambienti disponibili

### `LOCAL`

Ambiente di sviluppo locale.

Uso tipico:

- sviluppo feature;
- debug e test manuali;
- avvio parziale o completo con profili Docker locali.

Caratteristiche principali:

- servizi esposti su host locale;
- configurazioni orientate a velocita di iterazione;
- dati e integrazioni spesso mock/stub o di test.

### `PAPER`

Ambiente di simulazione operativa (paper trading).

Uso tipico:

- test end-to-end realistici senza capitale reale;
- validazione workflow scheduler/decision engine/execution;
- verifica monitoraggio, alerting e stabilita.

Caratteristiche principali:

- integrazione con account/sistemi paper;
- comportamento vicino alla produzione;
- rischio operativo ridotto rispetto a LIVE.

### `LIVE`

Ambiente di produzione con operativita reale.

Uso tipico:

- esecuzione ordini reali;
- monitoraggio continuo del sistema;
- gestione incident e runbook operativi.

Caratteristiche principali:

- integrazioni reali broker/provider;
- policy di sicurezza e controllo piu restrittive;
- rilascio controllato e osservabilita completa.

## Flusso LOCAL -> main -> PAPER

Il deployment verso PAPER e gestito da GitHub Actions nel file:

- `trading-system/.github/workflows/deploy.yml`

Flusso operativo richiesto:

1. Sviluppo e test in `LOCAL`.
2. Commit/push su branch organizzativo `main`.
3. Merge del codice su branch `PAPER`.
4. Il push su `PAPER` attiva automaticamente la pipeline CI/CD.

## Cosa fa la pipeline CI/CD su `PAPER`

Quando c'e un push su branch `PAPER`, il workflow esegue:

1. **Checkout e setup build**
- checkout repository;
- setup Docker Buildx;
- login DockerHub con secret.

2. **Build e publish immagini Docker**
- build di tutti i microservizi con `Dockerfile` presente;
- tagging immagine `latest` e, se presente, anche versione da `release.json`;
- push su DockerHub.

3. **Build specifica IBKR API Gateway sul server**
- copia file necessari (`Dockerfile`, `release.json`, config) sul server;
- build/push dell'immagine `ibkr-clientportal` lato server;
- verifica presenza artefatti richiesti (`SW/clientportal.gw.zip`).

4. **Generazione file `.env` ambiente PAPER**
- crea `.env` nel runner combinando `vars` e `secrets` GitHub;
- imposta `ENV=PAPER` (tramite `github.ref_name`).

5. **Distribuzione asset di deploy sul server PAPER**
- copia `.env` su server;
- copia `docker-compose.paper.yml` e `docker-compose.build.yml`;
- copia script/artefatti restore DB.

6. **Restore DB condizionale**
- cerca dump `Trading_PAPER_*.tar.gz`;
- se dump nuovo: esegue restore;
- se dump gia ripristinato: salta restore e avvia solo servizi core.

7. **Avvio servizi con profili dinamici**
- esegue `deploy-with-profiles.sh` su server;
- lo script legge i microservizi abilitati e compone `COMPOSE_PROFILES`;
- avvia i container con `docker compose` e i profili calcolati.

8. **Allineamento finale container e cleanup**
- `docker compose up -d --remove-orphans --no-recreate` con file compose previsti;
- prune immagini Docker non usate;
- rimozione `.env` dal server a fine run.

## Nota pratica

In sintesi: il merge su `PAPER` e il trigger del deploy. La pipeline prende il codice, costruisce/pusha le immagini, prepara configurazione ambiente e riallinea i container sul server PAPER in modo automatizzato.

## Pagine della sezione

- [LOCAL -> PAPER](./deployment-local-to-paper.md)
- [Variabili d'ambiente](./deployment-variabili-ambiente.md)
- [Git Deployment](./deployment-git.md)

## Raccomandazioni

- Non condividere segreti tra ambienti diversi.
- Validare sempre in `PAPER` prima di promuovere in `LIVE`.
- Tenere `ENV` coerente con file compose/env caricati in fase di bootstrap.
