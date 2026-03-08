---
sidebar_position: 6
---

# traefik

## Cosa fa

Reverse proxy e API gateway del sistema: routing, TLS e middleware (CORS, auth-forward).

## Ruoli e responsabilita

- ingresso unico HTTP/HTTPS (`:80`, `:443`);
- routing host/path verso microservizi;
- middleware `auth-forward` verso `authservice`;
- gestione certificati Let's Encrypt.

## Porta esposta

- `80:80`
- `443:443`

## Gestione CORS con i microservizi

Il CORS e gestito in modo centralizzato da Traefik tramite il middleware `cors-default` definito a livello gateway.

Come funziona nel progetto:

- Traefik espone un middleware headers con `accessControlAllowOriginList`, metodi e headers consentiti.
- Ogni router microservizio include `cors-default@docker` nella catena middleware.
- Per le richieste browser `OPTIONS` (preflight), molti servizi hanno router dedicati `*-preflight` che applicano solo `stripPrefix + cors`, evitando `auth-forward`.

Questo approccio evita duplicazioni CORS nei singoli servizi e mantiene policy uniforme.

## Routing interno con nome microservizio nel path

Il routing avviene usando host + prefisso path che include il nome del microservizio.

Pattern usato:

- URL esterna: `https://api.trading.expovin.it/<microservizio>/...`
- Regola Traefik: `PathPrefix('/<microservizio>')`
- Middleware: `stripPrefix` rimuove `/<microservizio>` prima di inoltrare la richiesta al container.

Esempio `tickerscanner`:

- client chiama: `https://api.trading.expovin.it/tickerscanner/status/health`
- router matcha `PathPrefix('/tickerscanner')`
- `tickerscanner-stripprefix` rimuove `/tickerscanner`
- servizio riceve internamente: `/status/health` sulla porta `3013`

Vantaggi del pattern:

- namespace chiaro per ogni servizio;
- nessun conflitto tra route uguali su servizi diversi;
- endpoint interni semplici (i servizi non devono conoscere il prefisso esterno).

## Configurazione (docker-compose.paper.yml)

```yaml
traefik:
  image: traefik:v3.1
  command:
    - "--providers.docker=true"
    - "--providers.docker.exposedByDefault=false"
    - "--entrypoints.web.address=:80"
    - "--entrypoints.websecure.address=:443"
    - "--certificatesresolvers.le.acme.httpchallenge=true"
  ports:
    - "80:80"
    - "443:443"
  labels:
    - "traefik.enable=true"
    - "traefik.http.middlewares.auth-forward.forwardauth.address=http://authservice:3015/auth/validate"
    - "traefik.http.middlewares.cors-default.headers.accessControlAllowOriginList=https://trading.expovin.it,https://api.trading.expovin.it"
```
