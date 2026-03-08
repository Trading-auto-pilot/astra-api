---
sidebar_position: 13
---


# servicecontrolplane

Questa pagina e l'hub API del microservizio `servicecontrolplane`.

## Endpoint disponibili

| Metodo | Path | Descrizione | Dettaglio |
|---|---|---|---|
| `GET` | `/servicecontrolplane/service-flags` | Nessuno; lista flags. | [Apri](./servicecontrolplane-endpoint-01-get-servicecontrolplane-service-flags.md) |
| `GET` | `/servicecontrolplane/service-flags/:id` | Path `id`; dettaglio flag. | [Apri](./servicecontrolplane-endpoint-02-get-servicecontrolplane-service-flags-id.md) |
| `POST` | `/servicecontrolplane/service-flags` | Body: `env`, `microservice`, `enabled`, `note`. | [Apri](./servicecontrolplane-endpoint-03-post-servicecontrolplane-service-flags.md) |
| `PUT` | `/servicecontrolplane/service-flags/:id` | Path `id`; body stessi campi create/update. | [Apri](./servicecontrolplane-endpoint-04-put-servicecontrolplane-service-flags-id.md) |
| `DELETE` | `/servicecontrolplane/service-flags/:id` | Path `id`; elimina flag. | [Apri](./servicecontrolplane-endpoint-05-delete-servicecontrolplane-service-flags-id.md) |
