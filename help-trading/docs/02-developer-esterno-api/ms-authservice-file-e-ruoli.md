---
sidebar_position: 13
---

# authservice - Struttura File e Ruoli

## File principali

- `server.js`
  Entrypoint HTTP. Crea server via `createMicroserviceServer` e monta `/auth`.

- `modules/main.js`
  Classe `AuthService` (estende `BaseService`), lifecycle e init custom.

- `auth.js`
  Router principale. Implementa:
  - `/auth/login`
  - `/auth/renew`
  - `/auth/validate` (Traefik ForwardAuth)
  - endpoint admin/users/permissions/api-keys.

## Moduli funzionali

- `modules/auth.js`
  Logica auth core (login, verifica password, sign/renew JWT, validate forward auth).

- `modules/authorization.js`
  Decision engine permessi (pattern path + metodo + regole `is_allowed`).

- `modules/user.js`
  Client HTTP per utenti/permessi/navigation verso layer dati (`datahub`).

- `modules/apiKeys.js`
  Client HTTP per API keys e permessi API key verso layer dati.

## File di supporto

- `Dockerfile`
  Build immagine del microservizio.

- `package.json`
  Dipendenze runtime (`express`, `jsonwebtoken`, `bcrypt`, `axios`, `minimatch`).

- `events.manifest.json`
  Manifest eventi del servizio.

- `release.json`
  Metadata release/versioning.

- `openTunel.sh`
  Utility locale di supporto (tunnel).

## Pattern implementativo

`authservice` adotta un pattern modulare:

1. **server layer** (`server.js`)
2. **router layer** (`auth.js`)
3. **domain logic** (`modules/auth.js`, `modules/authorization.js`)
4. **data client layer** (`modules/user.js`, `modules/apiKeys.js`)
5. **shared framework** (`BaseService`, `serverFactory`, `datahubAdapter`).
