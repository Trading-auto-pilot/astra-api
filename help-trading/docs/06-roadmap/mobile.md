---
sidebar_position: 3
---

# Mobile

## Obiettivo

Realizzare una pagina frontend dedicata alla navigazione da dispositivi mobili (cellulare), esposta su dominio dedicato `mobile.*`.

## Riconoscimento automatico client mobile

La versione mobile deve essere selezionata automaticamente quando lo user agent appartiene a un dispositivo mobile.

Linee guida:

- rilevazione user agent lato frontend con fallback lato edge/proxy;
- redirect automatico verso `mobile.*` quando il client e mobile;
- possibilità di override manuale per forzare desktop/mobile in caso di rilevazione non corretta.

## Ambito funzionale minimo della pagina mobile

La pagina mobile deve mostrare solo le funzioni essenziali, con UI semplificata:

1. Login IBKR
   - accesso rapido al login IBKR dalla versione mobile.

2. Overview mobile
   - versione compatta della pagina overview con i KPI principali.

3. Stato schedulazione
   - vista minima dello scheduler: cosa è andato a buon fine e cosa è fallito.

4. Stato live update decision-engine
   - stato del live update;
   - lista ticker attualmente in ascolto;
   - indicatori sintetici su dati in arrivo (presenza/assenza aggiornamenti).

## Note di implementazione

- design mobile-first, componenti ottimizzati per touch;
- ridurre al minimo le tabelle complesse;
- privilegiare card e stati sintetici con drill-down opzionale;
- aggiornamento near real-time per scheduler/live update, con fallback polling.

## Implementazione (Mar 2026)

### Rotta

- Route hash: `#/mobile` — `RouteId = "mobile"` in `routing.ts`
- Rotta protetta: richiede autenticazione (`PROTECTED_ROUTES` in `App.tsx`)
- Permesso: accessibile a tutti gli utenti con accesso a `overview` (non richiede permesso separato nel DB)

### Rilevamento mobile automatico

Al termine del login (`LoginPage.tsx`) viene verificato:

```ts
const isMobileDevice = () =>
  /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
```

Se `true`, il redirect post-login va a `#/mobile` invece di `#/overview`. Funziona sia per il login normale che per il reset forzato della password al primo accesso.

### Componente `MobilePage.tsx`

Layout standalone (nessuna sidebar) con le seguenti sezioni:

| Sezione | Fonte dati | Dettaglio |
|---|---|---|
| **IBKR Login** | `GET /ibkr-bridge/mirror/portfolio/accounts` | Stato connessione IBKR; bottone "Apri Desktop IBKR" se non autenticato |
| **Liquidity** | `GET /liquidity-manager/liquidity-score` | Score, risk regime, volatilità, confidence in griglia 2×2 |
| **Scheduler** | `fetchSchedulerJobs()` | Contatore job abilitati / totale |
| **Live Events** | WebSocket via `redisWsBridgeClient` | Ultimi 30 eventi con canale, sorgente e timestamp |

Header: Logo + bottone Logout. Footer: link "Passa alla versione desktop" (`#/overview`).
