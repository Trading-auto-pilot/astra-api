---
title: DELETE /market-simulator/subscriptions/:symbol
---

# DELETE /market-simulator/subscriptions/:symbol

Area: `Sottoscrizioni`.

## Request

- Metodo: `DELETE`
- Path: `/market-simulator/subscriptions/:symbol`
- Input noto: Simbolo del ticker da rimuovere dalla sottoscrizione.

## Parametri / Body

| Parametro | In | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|---|
| `symbol` | path | `string` | Sì | Simbolo del ticker (es. `AAPL`). |

## Risposta attesa

`200 OK` (o equivalente applicativo).

```json
{
  "ok": true,
  "subscribed": ["MRNA"]
}
```

| Campo | Tipo | Descrizione |
|---|---|---|
| `subscribed` | `string[]` | Lista aggiornata dei ticker ancora sottoscritti. |

## Errori comuni

| HTTP | Quando |
|---|---|
| `400` | Parametro `symbol` mancante. |
| `401`/`403` | Autenticazione/autorizzazione non valida. |
| `500` | Errore interno. |

## Esempio

```bash
curl -X DELETE "https://api.trading.expovin.it/market-simulator/subscriptions/AAPL"
```
