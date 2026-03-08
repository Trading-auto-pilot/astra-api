---
sidebar_position: 3
title: serviceControlPlane — controllo runtime Docker
---

# serviceControlPlane v.2.0.0 — Controllo runtime Docker

In questa release `3.5.0` il microservizio `serviceControlPlane` e stato aggiornato alla versione `2.0.0` con l'aggiunta del controllo runtime dei container Docker.

## Contesto

Nella versione precedente (`1.0.1`) il `serviceControlPlane` gestiva i **service flags** (configurazione abilitazione/disabilitazione microservizi) ma non aveva alcuna capacita di intervenire direttamente sullo stato dei container a runtime.

Con la versione `2.0.0` viene aggiunto il supporto al controllo diretto dei container tramite **Docker Socket API**.

## Come funziona

Il microservizio comunica con il Docker daemon locale tramite il socket Unix `/var/run/docker.sock`, montato in sola lettura nel container (`ro`). Utilizza il modulo Node.js nativo `http` senza dipendenze aggiuntive, con `socketPath` per puntare al socket.

Le chiamate passano attraverso le Docker Engine API:

| Operazione | Docker API | Nota |
| --- | --- | --- |
| Lista container | `GET /containers/json?all=1` | Restituisce tutti i container, anche fermi |
| Avvio | `POST /containers/{name}/start` | No-op se gia in running (204) |
| Arresto | `POST /containers/{name}/stop` | Graceful stop con SIGTERM |
| Riavvio | `POST /containers/{name}/restart` | Stop + Start in sequenza |

## Nuovi endpoint REST

Tutti gli endpoint sono protetti da autenticazione (`auth-forward` via Traefik).

### `GET /servicecontrolplane/containers`

Restituisce la lista completa dei container con stato attuale.

```json
{
  "containers": [
    {
      "id": "abc123",
      "name": "trading-system-decision-engine-1",
      "image": "expovin/decision-engine:2.0.1",
      "state": "running",
      "status": "Up 2 hours"
    }
  ]
}
```

### `POST /servicecontrolplane/containers/{name}/start`
### `POST /servicecontrolplane/containers/{name}/stop`
### `POST /servicecontrolplane/containers/{name}/restart`

Eseguono l'azione corrispondente sul container identificato per nome.

```json
{ "ok": true }
```

## Integrazione frontend (AdminMicroservicePage)

La pagina `/admin/microservice` ora mostra per ogni servizio:

- **badge di stato** del container (`RUNNING`, `STOPPED`, `EXITED`, ecc.) con codifica colore;
- **icone azione** Start / Stop / Restart direttamente nella riga della tabella;
- **tabella container non abbinati** — container rilevati nel Docker host ma non presenti nei service flags (e.g. container di infrastruttura come Redis, MySQL, Traefik).

Il matching tra service flags e container e fatto per nome fuzzy: un container di nome `trading-system-decision-engine-1` viene abbinato al flag `decision-engine`.

## Configurazione Docker

Il socket Docker deve essere montato nel container `servicecontrolplane`:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

Il flag `:ro` (read-only) garantisce che il microservizio possa solo chiamare le API Docker, senza poter modificare la configurazione del daemon.

## Benefici introdotti in release 3.5.0

- visibilita immediata dello stato runtime di ogni microservizio dall'interfaccia admin;
- possibilita di riavviare un servizio bloccato direttamente dalla UI senza accesso SSH;
- nessuna dipendenza esterna aggiuntiva (usa il modulo `http` di Node.js nativo);
- architettura sicura: socket montato in read-only, azioni limitate a start/stop/restart.
