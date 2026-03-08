---
sidebar_position: 4
---

# Limiti cache e persistenza

## Controllo limiti L2 (filesystem)

Il limite L2 e governato da setting DB:

- `MAX_L2_CACHE_MB`

Comportamento:

1. dopo ogni scrittura L2, il servizio calcola la dimensione totale della cache file;
2. se supera `MAX_L2_CACHE_MB`, rimuove file piu vecchi (`mtime` ascendente);
3. pubblica evento `CACHE.L2.CLEANING` con dettagli cleanup.

Questa logica e implementata in `modules/main.js` (`_enforceL2MaxSize`).

## Controllo limiti L3 (Redis memory)

Il limite memoria L3 e demandato a Redis.

Configurazione compose Redis:

- `--maxmemory 512mb`
- `--maxmemory-policy allkeys-lru`

Quindi, quando la memoria raggiunge il limite, Redis applica eviction LRU sulle chiavi.

In aggiunta, `cachemanager` monitora la soglia:

- env `L3_USAGE_ALERT_PERCENT` (default `95`)

Se la percentuale d'uso supera la soglia, emette evento `CACHE.L3.THRESHOLD.REACHED`.

## Persistenza filesystem esterno

La cache su file non e effimera del container: usa volume Docker persistente.

Compose:

```yaml
cachemanager:
  volumes:
    - cachemanager_data:/app/cache
```

Effetto operativo:

- i file L2 restano disponibili dopo restart/redeploy;
- la warming della cache e preservata nel tempo.

## Cosa e "in memory"

- L3: chiavi Redis `candles:{symbol}:{tf}` (in-memory Redis);
- metriche locali e contatori in processo Node (`L1Hit`, `L2Hit`, ecc.);
- settings caricati in memoria con possibilita di reload runtime (`/settings/reload`).
