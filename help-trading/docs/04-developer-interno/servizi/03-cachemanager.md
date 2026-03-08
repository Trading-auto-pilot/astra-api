---
sidebar_position: 4
---


# cachemanager

Questa pagina e l'hub API del microservizio `cachemanager`.

## Endpoint disponibili

| Metodo | Path | Descrizione | Dettaglio |
|---|---|---|---|
| `GET` | `/cachemanager/candles` | Query: `symbol`, `startDate`, `endDate` obbligatori; `tf`, `exchange` opzionali. | [Apri](./cachemanager-endpoint-01-get-cachemanager-candles.md) |
| `GET` | `/cachemanager/l2/file` | Query: `symbol`,`year`,`month`,`tf` oppure `fileName`; legge file L2. | [Apri](./cachemanager-endpoint-02-get-cachemanager-l2-file.md) |
| `PUT` | `/cachemanager/l2/file` | Stessi parametri di lookup + body JSON dati; scrive L2. | [Apri](./cachemanager-endpoint-03-put-cachemanager-l2-file.md) |
| `GET` | `/cachemanager/l2/audit` | Query: `symbol`, `tf`, `clean`; audit qualita cache file. | [Apri](./cachemanager-endpoint-04-get-cachemanager-l2-audit.md) |
| `POST` | `/cachemanager/l2/clear` | Query opzionali `symbol`, `file`; pulizia totale/parziale L2. | [Apri](./cachemanager-endpoint-05-post-cachemanager-l2-clear.md) |
| `GET` | `/cachemanager/provider` | Nessuno; provider storico attivo. | [Apri](./cachemanager-endpoint-06-get-cachemanager-provider.md) |
| `PUT` | `/cachemanager/provider/:provider` | Path `provider` (`FMP`,`ALPACA`,`IBKR`); switch provider runtime. | [Apri](./cachemanager-endpoint-07-put-cachemanager-provider-provider.md) |
| `GET` | `/cachemanager/status/L2/size` | Nessuno; dimensione cache L2. | [Apri](./cachemanager-endpoint-08-get-cachemanager-status-l2-size.md) |
| `DELETE` | `/cachemanager/status/L2/size/:symbol/:date?` | Path `symbol` e opzionale `date`; invalidazione L2 mirata. | [Apri](./cachemanager-endpoint-09-delete-cachemanager-status-l2-size-symbol-da.md) |
| `GET` | `/cachemanager/status/L3/size` | Nessuno; dimensione cache in-memory L3. | [Apri](./cachemanager-endpoint-10-get-cachemanager-status-l3-size.md) |
| `DELETE` | `/cachemanager/status/L3/size/:symbol/:tf?` | Path `symbol` e opzionale `tf`; invalidazione L3. | [Apri](./cachemanager-endpoint-11-delete-cachemanager-status-l3-size-symbol-tf.md) |
