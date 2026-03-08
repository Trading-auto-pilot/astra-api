---
sidebar_position: 18
---

import AlertingServiceArchitectureDiagram from '@site/src/components/AlertingServiceArchitectureDiagram';

# alertingservice

## Cosa fa

`alertingservice` valuta regole su eventi/log in tempo reale e invia notifiche (email/whatsapp), registrando stato e delivery.

## Ruoli e responsabilita

- engine di regole con dedup e throttle per finestra temporale;
- subscribe Redis su pattern logs/events;
- integrazione provider notifiche (`SMTP`, `Twilio`);
- persistenza su datahub di regole/stato/delivery.

## Porta esposta

- Porta interna servizio: `3008`
- Esposizione via Traefik: `https://api.trading.expovin.it/alertingservice/*`

## Architettura grafica

<AlertingServiceArchitectureDiagram />

## Configurazione (docker-compose.paper.yml)

```yaml
alertingservice:
  image: expovin/alertingservice:${ALERTINGSERVICE_VERSION}
  restart: unless-stopped
  profiles: ["alertingservice"]
  environment:
    - DBMANAGER_URL=${DBMANAGER_URL}
    - REDIS_URL=${REDIS_URL}
    - PORT=3008
    - TWILIO_ACCOUNT_SID=${TWILIO_ACCOUNT_SID}
    - SMTP_HOST=${SMTP_HOST}
    - SMTP_PORT=${SMTP_PORT}
    - SMTP_USER=${SMTP_USER}
    - SMTP_PASSWORD=${SMTP_PASSWORD}
    - ENV=${ENV}
    - TZ=${TIMEZONE}
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.alertingservice.rule=Host(`api.trading.expovin.it`) && PathPrefix(`/alertingservice`)"
    - "traefik.http.services.alertingservice.loadbalancer.server.port=3008"
    - "traefik.http.routers.alertingservice.middlewares=alertingservice-stripprefix,cors-default@docker,auth-forward@docker"
```

## Variabili d'ambiente

### Infrastruttura

Variabili obbligatorie gestite da `BaseService` (comune a tutti i microservizi).

| Variabile | Default | Descrizione |
|---|---|---|
| `DATAHUB_URL` | `http://datahub:3000` | URL del servizio `datahub` (ex `DBMANAGER_URL`, ancora accettato come alias). |
| `CACHEMANAGER_URL` | `http://cachemanager:3006` | URL del `cachemanager`. Disponibile tramite `BaseService` anche se non usato attivamente dal servizio. |
| `REDIS_URL` | — | URI Redis (es. `redis://redis:6379`). Obbligatorio per il bus eventi e la sottoscrizione ai canali di log/events. |
| `LOG_LEVEL` | `info` | Livello di log: `trace`, `debug`, `info`, `warning`, `error`. |
| `ENV` | `DEV` | Ambiente di esecuzione (`local`, `paper`, `prod`). Usato nel prefisso dei canali Redis e nei pattern di sottoscrizione. |
| `LOG_BATCH_MAX_BYTES` | — | Dimensione massima batch per il log su DB (funzionalità `dbLogger`). |
| `ENABLE_DB_LOG` | — | Se `true`, abilita la scrittura dei log su DB via `datahub`. |
| `TZ` | — | Timezone di sistema del container (es. `America/New_York`). |

### Server HTTP

| Variabile | Default | Descrizione |
|---|---|---|
| `PORT` | `3008` | Porta su cui il server Express è in ascolto. |
| `CORS_ORIGIN` | `http://localhost:5173` | Origin (o lista separata da virgola) ammessa per le richieste CORS. |
| `MAX_RETRY_DELAY` | `60000` | Intervallo massimo (ms) per il retry di riconnessione nel router `/status/*`. |

### SMTP (notifiche email)

| Variabile | Default | Descrizione |
|---|---|---|
| `SMTP_HOST` | — | Hostname del server SMTP. Obbligatorio per l'invio email. |
| `SMTP_PORT` | — | Porta del server SMTP (es. `465`, `587`). Se `465`, viene abilitata la connessione `secure`. |
| `SMTP_USER` | — | Username di autenticazione SMTP. |
| `SMTP_PASSWORD` | — | Password di autenticazione SMTP. |
| `SMTP_FROM` | — | Indirizzo mittente usato nelle email inviate (es. `noreply@trading.expovin.it`). |

### Twilio (notifiche WhatsApp)

| Variabile | Default | Descrizione |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | — | Account SID Twilio. Obbligatorio per l'invio di messaggi WhatsApp. |
| `TWILIO_AUTH_TOKEN` | — | Auth token Twilio. Obbligatorio per l'invio di messaggi WhatsApp. |
| `TWILIO_CONTENT_SID` | — | SID del template di contenuto Twilio usato nei messaggi template WhatsApp. |

### Rule Engine

Le seguenti variabili controllano il comportamento del motore di regole (dedup, throttle, pattern Redis). Non è necessario aggiungerle al `docker-compose` se si accettano i valori di default.

| Variabile | Default | Descrizione |
|---|---|---|
| `ALERTING_LOGS_PATTERN` | `{ENV}.*.*.logs.*` | Pattern Redis Pub/Sub per la sottoscrizione ai canali di log. Il placeholder `{ENV}` viene sostituito con il valore di `ENV`. |
| `ALERTING_EVENTS_PATTERN` | `{ENV}.*.events*` | Pattern Redis Pub/Sub per la sottoscrizione ai canali eventi. |
| `ALERTING_WINDOW_SECONDS` | `300` | Finestra temporale (secondi) entro cui si conta il numero di alert per throttle. |
| `ALERTING_MAX_PER_WINDOW` | `3` | Numero massimo di alert consentiti nella finestra `ALERTING_WINDOW_SECONDS` per la stessa regola. |
| `ALERTING_DEDUP_SECONDS` | `0` | Secondi di deduplicazione: se > 0, alert identici dentro questo intervallo vengono soppressi. |
| `ALERTING_DEFAULT_EMAIL_TO` | — | Indirizzo email di destinazione di fallback usato quando una regola non specifica il campo `to`. |

:::caution
Se `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` o `SMTP_PORT` non sono configurati, il client email non sarà inizializzato e qualsiasi tentativo di invio di notifica email fallirà con errore. Analogamente, se `TWILIO_ACCOUNT_SID` o `TWILIO_AUTH_TOKEN` sono assenti, il client WhatsApp non sarà disponibile.
:::

## Pagine dedicate

- [Architettura e flussi](./ms-alertingservice-architettura.md)
- [Endpoint dettagliati](./ms-alertingservice-endpoint.md)
- [Implementazione per file](./ms-alertingservice-file-e-ruoli.md)
- [Configurazione](./ms-alertingservice-configurazione.md)
- [Runbook operativo](./ms-alertingservice-runbook.md)
