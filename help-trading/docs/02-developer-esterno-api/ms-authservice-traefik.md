---
sidebar_position: 12
---

# authservice - Integrazione Traefik

## Modello di esposizione

Nel `docker-compose.paper.yml` ci sono due router principali:

- `auth-public`: login/validate/renew esposti senza `auth-forward`.
- `auth-admin`: path `/auth/admin/*` protetti con `auth-forward`.

Entrambi puntano al service `auth-svc` porta interna `3015`.

## Come viene usato da altri microservizi

Traefik definisce middleware globale:

- `auth-forward.forwardauth.address=http://authservice:3015/auth/validate`

I router dei microservizi applicativi includono:

- `...,auth-forward@docker`

Risultato:

1. richiesta arriva su `api.trading.expovin.it/<servizio>/...`
2. Traefik invia sub-request a `/auth/validate`
3. `authservice` decide ALLOW/DENY
4. solo se ALLOW Traefik inoltra al servizio target.

## Header ForwardAuth rilevanti

`authservice` usa soprattutto:

- `X-Forwarded-Uri`
- `X-Forwarded-Method`
- `Authorization`
- `X-API-Key`

e restituisce (se valido):

- `X-User-Id`
- `X-Auth-Subject-Type`
- `X-Api-Key-Id`

## CORS e preflight

Per browser `OPTIONS` i router preflight dedicati in Traefik bypassano `auth-forward`.
Inoltre `auth.js` gestisce esplicitamente `OPTIONS` in `/auth/validate` con `200`.
