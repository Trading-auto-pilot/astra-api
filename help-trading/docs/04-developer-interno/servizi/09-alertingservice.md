---
sidebar_position: 10
---


# alertingservice

Questa pagina e l'hub API del microservizio `alertingservice`.

## Endpoint disponibili

| Metodo | Path | Descrizione | Dettaglio |
|---|---|---|---|
| `ALL` | `/alertingservice/alerting-rules` | Proxy CRUD regole alert verso datahub. | [Apri](./alertingservice-endpoint-01-all-alertingservice-alerting-rules.md) |
| `ALL` | `/alertingservice/alerting-rules/:id` | Path `id`; CRUD singola regola. | [Apri](./alertingservice-endpoint-02-all-alertingservice-alerting-rules-id.md) |
| `ALL` | `/alertingservice/alerting-state` | Proxy stato alerting verso datahub. | [Apri](./alertingservice-endpoint-03-all-alertingservice-alerting-state.md) |
| `ALL` | `/alertingservice/alerting-deliveries` | Proxy storico consegne notifiche. | [Apri](./alertingservice-endpoint-04-all-alertingservice-alerting-deliveries.md) |
| `POST` | `/alertingservice/alerting/rules/reload` | Nessuno; ricarica regole engine in memoria. | [Apri](./alertingservice-endpoint-05-post-alertingservice-alerting-rules-reload.md) |
| `GET` | `/alertingservice/events/catalog` | Query `includeManifests=true | [Apri](./alertingservice-endpoint-06-get-alertingservice-events-catalog.md) |
| `POST` | `/alertingservice/email/send` | Body payload email (`to`, `subject`, `text/html`, ecc). | [Apri](./alertingservice-endpoint-07-post-alertingservice-email-send.md) |
| `POST` | `/alertingservice/whatsapp/send` | Body messaggio WhatsApp diretto. | [Apri](./alertingservice-endpoint-08-post-alertingservice-whatsapp-send.md) |
| `POST` | `/alertingservice/whatsapp/template` | Body template WhatsApp (template name + params). | [Apri](./alertingservice-endpoint-09-post-alertingservice-whatsapp-template.md) |
