---
sidebar_position: 1
---

# Architettura e flussi

## Flusso principale

1. `RuleEngine` carica regole e stato da datahub (`alerting-rules`, `alerting-state`).
2. Si sottoscrive ai pattern Redis:
3. logs (`ENV.*.*.logs.*`) e/o events (`ENV.*.events*`).
4. Per ogni messaggio valuta `match_json` della regola.
5. Applica dedup e rate limit per finestra temporale.
6. Esegue azioni (`email`, `whatsapp`) e registra delivery su datahub.

## Da chi viene richiamato

- da microservizi interni via eventi/log Redis (trigger passivo/event-driven);
- da operatori/API client via endpoint REST:
- gestione regole/stato/delivery;
- test invio notifiche (`/email/send`, `/whatsapp/send`);
- reload regole (`/alerting/rules/reload`).

## Cosa utilizza

- Redis Bus per subscribe/publish e catalogo eventi;
- datahub per persistenza regole/stato/delivery;
- provider esterni:
- SMTP (`nodemailer`) per email;
- Twilio per WhatsApp.

## Componenti

- `modules/main.js`: bootstrap servizio e startup RuleEngine;
- `modules/RuleEngine.js`: matching regole + delivery orchestration;
- `alertingRulesProxy.js`: proxy CRUD verso datahub;
- router notifiche dedicati: `email.js`, `whatsapp.js`.
