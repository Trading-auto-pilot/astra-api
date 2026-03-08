---
title: PUT /cachemanager/l2/file
---

# PUT /cachemanager/l2/file

Area: `Generale`.

## Request

- Metodo: `PUT`
- Path: `/cachemanager/l2/file`
- Input noto: Stessi parametri di lookup + body JSON dati; scrive L2.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Stessi parametri di lookup + body JSON dati; scrive L2.

## Risposta attesa

`200 OK` (o equivalente applicativo).

```json
{
  "ok": true
}
```

## Errori comuni

| HTTP | Quando |
|---|---|
| `400` | Parametri/body non validi o incompleti. |
| `401`/`403` | Autenticazione/autorizzazione non valida, se richiesta dalla route. |
| `404` | Risorsa non trovata (`id`, `jobId`, `symbol`, ecc.). |
| `500` | Errore interno o errore propagato da servizio dipendente. |

## Esempio

```bash
curl -X PUT "https://api.trading.expovin.it/cachemanager/l2/file" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
