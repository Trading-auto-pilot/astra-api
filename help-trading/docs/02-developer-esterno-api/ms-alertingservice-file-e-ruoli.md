---
sidebar_position: 3
---

# Implementazione per file

## Struttura principale

- `alertingservice/server.js`
- `alertingservice/modules/main.js`
- `alertingservice/modules/RuleEngine.js`
- `alertingservice/alertingRulesProxy.js`
- `alertingservice/email.js`
- `alertingservice/whatsapp.js`
- `alertingservice/modules/email.js`
- `alertingservice/modules/twilio.js`
- `alertingservice/status.js`

## Ruolo dei file

### `server.js`

Entry point REST:

- bootstrap servizio;
- mount router status, proxy regole, email/whatsapp;
- endpoint tecnici (`settings`, `release`, `dbLogger`, `events/catalog`);
- endpoint reload regole (`/alerting/rules/reload`).

### `modules/main.js`

Core del servizio:

- init Redis bus + settings + logger;
- inizializza e avvia `RuleEngine`;
- espone `reloadAlertingRules()` per reload dinamico.

### `modules/RuleEngine.js`

Motore regole:

- carica regole/stato da datahub;
- subscribe pattern logs/events su Redis;
- match eventi (`match_json`);
- applica dedup/throttle;
- invia notifiche e registra delivery/stato su datahub.

### `alertingRulesProxy.js`

Proxy CRUD verso datahub:

- route `alerting-rules`, `alerting-state`, `alerting-deliveries`;
- adattamento response datahub -> formato frontend compatibile.

### `email.js` e `modules/email.js`

Router email + client SMTP (nodemailer).

### `whatsapp.js` e `modules/twilio.js`

Router whatsapp + client Twilio.

### `status.js`

Router `/status/*` per health/info/metrics/log-level/channels.
