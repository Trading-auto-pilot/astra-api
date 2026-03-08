---
sidebar_position: 14
---

# cache.js

## Utilizzo nei microservizi

[DBManager (legacy)](./ms-datahub).

## Funzioni e utilizzo

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `get(key)` | `key redis` | [DBManager (legacy)](./ms-datahub) |
| `set(key, value, ttl=300)` | `chiave, valore, ttl secondi` | [DBManager (legacy)](./ms-datahub) |
| `setp(key, value)` | `chiave, valore` | [DBManager (legacy)](./ms-datahub) |
| `del(key)` | `key` | [DBManager (legacy)](./ms-datahub) |
| `expire(key, ttl)` | `key + ttl` | [DBManager (legacy)](./ms-datahub) |
| `keys(pattern="*")` | `pattern wildcard` | [DBManager (legacy)](./ms-datahub) |
| `getRaw(key)` | `key` | [DBManager (legacy)](./ms-datahub) |
| `hmset(key, dataObj)` | `key hash + oggetto campi` | [DBManager (legacy)](./ms-datahub) |
| `hgetall(key)` | `key hash` | [DBManager (legacy)](./ms-datahub) |
| `lPush/lTrim/lRange(...)` | `key lista + parametri range` | [DBManager (legacy)](./ms-datahub) |
| `multi(key,start,stop)` | `parametri lista` | [DBManager (legacy)](./ms-datahub) |

## Dettaglio funzioni

### `get(key)`

- Cosa fa: Legge valore JSON (deserializzato) dalla cache.
- Parametri: `key redis`

### `set(key, value, ttl=300)`

- Cosa fa: Scrive valore JSON con scadenza.
- Parametri: `chiave, valore, ttl secondi`

### `setp(key, value)`

- Cosa fa: Scrive valore JSON persistente (senza TTL).
- Parametri: `chiave, valore`

### `del(key)`

- Cosa fa: Cancella chiave.
- Parametri: `key`

### `expire(key, ttl)`

- Cosa fa: Imposta/aggiorna TTL.
- Parametri: `key + ttl`

### `keys(pattern="*")`

- Cosa fa: Lista chiavi matching pattern.
- Parametri: `pattern wildcard`

### `getRaw(key)`

- Cosa fa: Legge stringa raw non deserializzata.
- Parametri: `key`

### `hmset(key, dataObj)`

- Cosa fa: Scrive hash Redis.
- Parametri: `key hash + oggetto campi`

### `hgetall(key)`

- Cosa fa: Legge tutti i campi hash.
- Parametri: `key hash`

### `lPush/lTrim/lRange(...)`

- Cosa fa: Operazioni lista Redis.
- Parametri: `key lista + parametri range`

### `multi(key,start,stop)`

- Cosa fa: Helper legacy che delega a `lRange`.
- Parametri: `parametri lista`

## Percorso

- `trading-system/shared/cache.js`
