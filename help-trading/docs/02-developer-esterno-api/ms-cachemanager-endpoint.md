---
sidebar_position: 2
---

# Endpoint dettagliati

## Endpoint operativi

### `GET /candles`

Recupera candele nel range richiesto usando catena `L3 -> L2 -> L1`.

### `GET /candles/latest`

Restituisce l'ultima candela disponibile per un simbolo e timeframe, leggendo **solo dalla cache L3 (Redis)**. Non contatta provider esterni: se la candela non è in cache, risponde `404`.

Usato dal `decision-engine` nella Fase 6 per il candle range check sui segnali di breakout live.

Query obbligatorie:

- `symbol` — simbolo del ticker (es. `AAPL`)
- `tf` — timeframe (es. `1min`, `5min`, `1h`)

Risposta `200`:

```json
{
  "ok": true,
  "symbol": "AAPL",
  "tf": "1min",
  "candle": {
    "t": 1709560800000,
    "o": 182.10,
    "h": 182.95,
    "l": 181.80,
    "c": 182.60,
    "v": 145320
  }
}
```

Risposta `404` (cache miss):

```json
{
  "ok": false,
  "error": "no candle in cache",
  "symbol": "AAPL",
  "tf": "1min"
}
```

Query principali:

- `symbol` (obbligatorio)
- `startDate` (obbligatorio)
- `endDate` (obbligatorio)
- `tf` (default `1Day`)
- `exchange` (opzionale, usato per provider IBKR)

### `GET /l2/file`

Legge un file cache L2.

Modalita:

- `?symbol=...&year=YYYY&month=MM&tf=...`
- oppure `?fileName=SYMBOL/YYYY-MM_tf.json`

### `PUT /l2/file`

Scrive un file cache L2.

Modalita input come `GET /l2/file`, con payload JSON in body.

### `GET /l2/audit`

Audit qualitativo della cache file (record validi/rotti, coverage, provider).

Query:

- `symbol` (opzionale)
- `tf` (opzionale)
- `clean=true|false` (opzionale, abilita pulizia record corrotti)

### `POST /l2/clear`

Pulizia cache L2:

- senza parametri: cancella tutta la L2;
- `?symbol=...`: cancella solo cartella simbolo;
- `?symbol=...&file=...`: cancella file specifico.

## Endpoint configurazione servizio

### `GET /settings`

Ritorna i settings correnti caricati in memoria.

### `PUT /settings`

Aggiorna setting in cache runtime (non persistente su DB).

### `POST /settings/reload`

Ricarica settings dal DB (datahub) senza restart.

### `GET /provider`

Ritorna provider storico attivo (`FMP`, `ALPACA`, `IBKR`).

### `PUT /provider/:provider`

Cambia provider runtime e inizializza il client se necessario.

### `PUT /connect` / `DELETE /connect`

Endpoint standard template per connect/disconnect servizio.

### `GET /dbLogger` / `PUT /dbLogger/:status`

Legge/aggiorna stato logger DB (`on|off`).

### `GET /release`

Ritorna metadati release da `release.json`.

## Endpoint status e controllo cache

Prefisso comune: `/status`.

### Stato generale

- `GET /status/health`
- `GET /status/info`
- `GET /status/metrics`
- `GET /status/logLevel`
- `PUT /status/logLevel`
- `GET /status/communicationChannels`
- `PUT /status/communicationChannels`

### Statistiche cache

- `GET /status/L1`
- `GET /status/L2`
- `GET /status/paramsSetting`
- `GET /status/cacheHits`

### Size e cleanup L2 (file)

- `GET /status/L2/size`
- `DELETE /status/L2/size`
- `DELETE /status/L2/size/:symbol`
- `DELETE /status/L2/size/:symbol/:date`

### Size e cleanup L3 (redis)

- `GET /status/L3/size`
- `DELETE /status/L3/size`
- `DELETE /status/L3/size/:symbol`
- `DELETE /status/L3/size/:symbol/:tf`
