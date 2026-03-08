---
sidebar_position: 11
---

# authservice - Architettura e Flussi

## Flusso login

1. `POST /auth/login` arriva al router `auth.js`.
2. `modules/auth.js` usa `findUserByUsername` (via `modules/user.js`).
3. Password verificata con `bcrypt`.
4. Emissione JWT (`jsonwebtoken`) con `sub`, `username`, `type`.
5. Aggiornamento `last_login_at` via client dati.

## Flusso validazione Traefik (ForwardAuth)

1. Traefik chiama `/auth/validate` su `authservice`.
2. `auth.js` legge `X-Forwarded-*` (path/metodo originali).
3. Supporta due modalita:
   - Bearer JWT
   - API key (`X-API-Key`)
4. Recupera permessi utente/API key via client dati (`datahub` endpoint dinamici/legacy).
5. Valuta regole `resource_pattern` + `http_method`.
6. Risponde:
   - `200` se consentito (con header `X-User-Id` o `X-Api-Key-Id`)
   - `401/403` se negato.

## Flusso autorizzazione

`modules/authorization.js` implementa il matcher:

- metodo (`ANY` o HTTP method specifica);
- path match con `minimatch` su pattern;
- bypass `ADMIN_ALL` quando presente e abilitato.

## Accesso ai dati

`authservice` non interroga direttamente MySQL.
Usa client HTTP (`modules/user.js`, `modules/apiKeys.js`) verso layer dati:

- preferenza: `DATAHUB_URL`
- fallback: `DBMANAGER_URL`

Questi client sfruttano `shared/datahubAdapter` per normalizzare i payload.
