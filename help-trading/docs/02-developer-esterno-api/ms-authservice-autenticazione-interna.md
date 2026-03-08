---
sidebar_position: 4
---

# Autenticazione interna tra microservizi

## Obiettivo

Oltre all'autenticazione utente (JWT/API key), la piattaforma usa una **autenticazione service-to-service** per le chiamate su endpoint `/internal/*`.

Questo meccanismo garantisce che solo microservizi trusted possano avviare flussi interni, inclusi job schedulati con contesto utente.

## Modello crittografico

- Firma: chiave privata (`INTERNAL_JWT_PRIVATE_KEY`) nel servizio chiamante.
- Verifica: chiave pubblica (`INTERNAL_JWT_PUBLIC_KEY`) nei servizi destinatari.
- Algoritmo: `EdDSA` (libreria `jose`), issuer di default `astraai-internal`.
- Header HTTP usato: `x-internal-token`.

Implementazione condivisa: `shared/internalAuth.js`.

## Flusso operativo

1. Lo `scheduler` riconosce URL interni (`/internal/...`).
2. Firma un JWT breve (TTL tipico 60s) con claim tecnici (`scp`, `svc`, `jobKey`, ecc.).
3. Invia il token nel header `x-internal-token`.
4. Il microservizio target valida firma, issuer, audience e scope.
5. Solo se il token e valido, la route interna prosegue.

## Scheduler e processi user-scoped

Nel flusso scheduler:

- per `/internal/fundamentals/user-daily-scores` usa audience `tickerscanner` e scope `fundamentals:update-user-daily-scores`;
- per `/internal/spot-finder/...` usa audience `decision-engine` e scope `decision-engine:spot-finder`.

Il contesto utente (`userId`) puo essere passato nel body/query/header del job; in aggiunta, i servizi possono leggere anche claim utente presenti nel token interno (`req.internalAuth.userId`) quando valorizzati.

## Validazione lato microservizi

Esempi attuali:

- `tickerScanner/routes/userScores.js`: verifica issuer `astraai-internal` + audience `tickerscanner`.
- `decision-engine/modules/decision-engine.js`: verifica issuer + audience `decision-engine` + scope `decision-engine:spot-finder`.
- `brokerExecutor-ibkr/middlewares/requireInternalToken.js`: verifica parametrica via env (`INTERNAL_JWT_ISSUER`, `INTERNAL_JWT_AUDIENCE`, `INTERNAL_JWT_SCOPE`).

In caso di token mancante/non valido la risposta e `403`.

## Configurazione consigliata

### Servizio chiamante (es. scheduler)

- `INTERNAL_JWT_PRIVATE_KEY`: chiave privata PKCS8 usata per firmare.

### Servizi destinatari

- `INTERNAL_JWT_PUBLIC_KEY`: chiave pubblica SPKI usata per verificare.
Variabili opzionali supportate:
- `INTERNAL_JWT_ISSUER`
- `INTERNAL_JWT_AUDIENCE`
- `INTERNAL_JWT_SCOPE`

## Note di sicurezza

- Non condividere mai la chiave privata tra servizi che fanno solo verifica.
- Usare TTL breve per minimizzare il rischio replay.
- Limitare audience/scope per endpoint interni specifici.
- Mascherare sempre `x-internal-token` nei log applicativi.
