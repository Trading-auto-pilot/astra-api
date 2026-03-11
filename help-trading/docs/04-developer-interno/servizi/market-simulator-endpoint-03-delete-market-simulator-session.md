---
title: DELETE /market-simulator/session
---

# DELETE /market-simulator/session

Area: `Sessione`.

## Request

- Metodo: `DELETE`
- Path: `/market-simulator/session`
- Input noto: Nessuno; ferma la sessione di simulazione attiva.

## Parametri / Body

Nessuno.

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
| `401`/`403` | Autenticazione/autorizzazione non valida. |
| `500` | Errore interno. |

## Esempio

```bash
curl -X DELETE "https://api.trading.expovin.it/market-simulator/session"
```
