---
sidebar_position: 3
---

# Backend

Questa pagina descrive l'architettura backend del progetto `trading-system`.

## Architettura a microservizi

Il backend e organizzato come insieme di microservizi Node.js/Express, ciascuno con responsabilita specifiche.
I servizi comunicano via HTTP interno, eventi e canali condivisi.

Schema logico semplificato:

```text
Client / Frontend
  -> Traefik (routing + middleware sicurezza)
    -> Microservizi backend (auth, scanner, decisione, scheduler, execution, ecc.)
      -> MySQL (persistenza)
      -> Redis (cache, stato volatile, pub/sub)
```

## Componenti infrastrutturali chiave

### Traefik (routing interno + security layer)

Traefik e l'entrypoint per il traffico interno/edge dei servizi.

- Applica routing per host/path verso i microservizi.
- Gestisce middleware di `stripPrefix` e CORS.
- Integra `forwardAuth` verso `authService` (`/auth/validate`) per proteggere le route.
- Consente regole differenziate per endpoint applicativi e preflight `OPTIONS`.

In pratica, Traefik e il layer che standardizza esposizione API e enforcement di policy di accesso.

### Redis

Redis viene usato come datastore in-memory e bus eventi per:

- cache condivisa tra servizi;
- stato runtime veloce/temporaneo;
- comunicazione asincrona/pub-sub (dove previsto);
- bridge verso stream WebSocket (`redisWsBridge`).

### MySQL

MySQL e il database relazionale principale del sistema.

- persistenza dati applicativi e configurazioni;
- base dati condivisa (con ownership logica per dominio);
- integrazione con i servizi che richiedono storage consistente e query strutturate.

## Elenco microservizi e descrizione

- `authService`: autenticazione/autorizzazione, validazione token/API key e supporto al `forwardAuth` di Traefik.
- `serviceControlPlane`: controllo operativo dei servizi, stato e operazioni di orchestrazione applicativa.
- `tickerScanner`: scansione mercato, ranking/selezione ticker e pubblicazione risultati.
- `market-data-service`: acquisizione/normalizzazione dati di mercato per gli altri domini.
- `decision-engine`: logica decisionale trading (segnali, regole operative, valutazioni).
- `scheduler`: pianificazione job periodici e trigger di workflow backend.
- `brokerExecutor-ibkr`: esecuzione ordini verso broker (IBKR) con gestione lifecycle ordini.
- `ibkr-bridge`: adapter verso endpoint/gateway IBKR, astrazione del layer broker.
- `ibkr-keepalive`: mantenimento sessione/heartbeat verso integrazione IBKR.
- `liquidity-manager`: gestione logiche di liquidita, allocazione e vincoli operativi.
- `cacheManager`: servizio di accesso/gestione cache condivisa su Redis.
- `alertingService`: gestione e dispatch alert/eventi notificabili.
- `datahub`: aggregazione e distribuzione dati tra fonti e servizi interni.
- `redisWsBridge`: bridge tra eventi Redis e canali WebSocket per consumer realtime.
- `DBManager`: utilita amministrative su database e operazioni di supporto dati.

## Shared Library

La documentazione dettagliata delle librerie condivise e stata spostata nel nuovo capitolo dedicato:

- [Shared Library](./shared-library.md)

## Riferimenti utili

- Root backend: `trading-system/`
- Compose: `docker-compose.local.yml`, `docker-compose.paper.yml`
- Shared libs: `shared/`
- Mappa tecnica: `Schema.md`

## Collegamenti

- [Torna alla overview Developer](./overview.md)
- [Vai alla sezione Frontend](./frontend.md)
