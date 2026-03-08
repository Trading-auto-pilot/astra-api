---
sidebar_position: 2
---


# authservice

Questa pagina e l'hub API del microservizio `authservice`.

## Endpoint disponibili

| Metodo | Path | Descrizione | Dettaglio |
|---|---|---|---|
| `POST` | `/auth/login` | Body: `email`, `password`; restituisce JWT e profilo utente. | [Apri](./authservice-endpoint-01-post-auth-login.md) |
| `POST` | `/auth/renew` | Header `Authorization: Bearer <token>`; rinnova token. | [Apri](./authservice-endpoint-02-post-auth-renew.md) |
| `GET` | `/auth/validate` | Header `Authorization` oppure `x-api-key`; verifica credenziali per ForwardAuth. | [Apri](./authservice-endpoint-03-get-auth-validate.md) |
| `GET` | `/auth/admin/me` | Header JWT admin; profilo utente corrente. | [Apri](./authservice-endpoint-04-get-auth-admin-me.md) |
| `GET` | `/auth/admin/user` | Query opzionali per filtro/paginazione utenti. | [Apri](./authservice-endpoint-05-get-auth-admin-user.md) |
| `GET` | `/auth/admin/user/:id` | Path `id`: identificativo utente. | [Apri](./authservice-endpoint-06-get-auth-admin-user-id.md) |
| `POST` | `/auth/admin/user` | Body creazione utente (anagrafica, ruolo, password). | [Apri](./authservice-endpoint-07-post-auth-admin-user.md) |
| `PUT` | `/auth/admin/user/:id` | Path `id`; body campi aggiornabili utente. | [Apri](./authservice-endpoint-08-put-auth-admin-user-id.md) |
| `DELETE` | `/auth/admin/user/:id` | Path `id`: elimina/disabilita utente. | [Apri](./authservice-endpoint-09-delete-auth-admin-user-id.md) |
| `GET` | `/auth/admin/user/:id/permissions` | Path `id`: lista permessi utente. | [Apri](./authservice-endpoint-10-get-auth-admin-user-id-permissions.md) |
| `POST` | `/auth/admin/user/:id/permissions` | Path `id`; body nuovo permesso. | [Apri](./authservice-endpoint-11-post-auth-admin-user-id-permissions.md) |
| `PUT` | `/auth/admin/user/:id/permissions/:permId` | Path `id`, `permId`; body modifica permesso. | [Apri](./authservice-endpoint-12-put-auth-admin-user-id-permissions-permid.md) |
| `DELETE` | `/auth/admin/user/:id/permissions/:permId` | Path `id`, `permId`; rimozione permesso. | [Apri](./authservice-endpoint-13-delete-auth-admin-user-id-permissions-permid.md) |
| `GET` | `/auth/admin/api-keys` | Lista API key. | [Apri](./authservice-endpoint-14-get-auth-admin-api-keys.md) |
| `POST` | `/auth/admin/api-keys` | Body creazione API key (owner, scope, scadenza). | [Apri](./authservice-endpoint-15-post-auth-admin-api-keys.md) |
| `PUT` | `/auth/admin/api-keys/:id` | Path `id`; aggiorna API key metadata/stato. | [Apri](./authservice-endpoint-16-put-auth-admin-api-keys-id.md) |
| `DELETE` | `/auth/admin/api-keys/:id` | Path `id`; revoca API key. | [Apri](./authservice-endpoint-17-delete-auth-admin-api-keys-id.md) |
