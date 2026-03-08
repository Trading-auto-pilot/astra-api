---
sidebar_position: 12
---

# datahub - Endpoint Automatici

Gli endpoint automatici sono generati leggendo lo schema MySQL a runtime.

## Namespace

- Base path: `/api/table/{tableName}`

## 5 endpoint CRUD auto-generati (per tabella)

1. `GET /api/table/{tableName}`
   Lista record con supporto `limit`, `offset` e filtri query.

2. `GET /api/table/{tableName}/{key...}`
   Recupera record per primary key (supporta PK composta).

3. `POST /api/table/{tableName}`
   Inserisce un nuovo record.

4. `PUT /api/table/{tableName}/{key...}`
   Aggiorna record per primary key.

5. `DELETE /api/table/{tableName}/{key...}`
   Elimina record per primary key.

## Note utili

- Per le viste, datahub espone principalmente endpoint di lettura.
- Ogni refresh schema rigenera il mapping router tabella -> endpoint.

## Filtri query e paginazione (GET lista)

L'endpoint `GET /api/table/{tableName}` supporta filtri direttamente da query string.

### Paginazione

- `limit`: default `100`, massimo `1000`
- `offset`: default `0`

Esempio:

- `GET /api/table/users?limit=50&offset=100`

### Filtri stringhe (uguaglianza)

- Campo singolo: `field=value`
- Multi-valore OR: `field=value1,value2,value3`

Esempi:

- `GET /api/table/users?role=admin`
- `GET /api/table/logs?level=error,warning`

### Filtri numerici

Sono supportati sia operatori inline nel valore, sia suffissi nel nome campo.

Operatori disponibili:

- `>` , `<` , `>=` , `<=` , `=`

Esempi inline:

- `GET /api/table/orders?amount=>1000`
- `GET /api/table/orders?amount=<=5000`

Esempi con suffisso:

- `GET /api/table/orders?amount__gt=1000`
- `GET /api/table/orders?amount__lte=5000`
- `GET /api/table/orders?amount__eq=2500`

### Filtri date/datetime

Per range temporali e consigliato usare i suffissi:

- `__gte` (maggiore o uguale)
- `__lte` (minore o uguale)
- `__gt` (maggiore)
- `__lt` (minore)

Esempi:

- `GET /api/table/logs?created_at__gte=2026-01-01&created_at__lt=2026-02-01`
- `GET /api/table/user_daily_score_jobs?target_date__gte=2026-02-01&target_date__lte=2026-02-28`

### Combinazione filtri

I filtri vengono combinati in `AND` tra campi diversi.

Esempio completo:

- `GET /api/table/logs?level=error,warning&created_at__gte=2026-02-01&id__gt=1000&limit=200&offset=0`
