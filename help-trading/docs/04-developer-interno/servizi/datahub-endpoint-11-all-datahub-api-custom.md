---
title: ALL /datahub/api/custom/*
---

# ALL /datahub/api/custom/*

Area: `Generale`.

## Request

- Metodo: `ALL`
- Path: `/datahub/api/custom/*`
- Input noto: Route manuali registrate nel servizio (dipendono dal progetto).

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Route manuali registrate nel servizio (dipendono dal progetto).

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
curl "https://api.trading.expovin.it/datahub/api/custom/*"
```
