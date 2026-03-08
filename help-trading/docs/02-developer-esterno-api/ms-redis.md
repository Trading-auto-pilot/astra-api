---
sidebar_position: 8
---

# redis

## Cosa fa

Store in-memory per cache e messaging/eventing tra servizi.

## Ruoli e responsabilita

- cache ad accesso rapido;
- pub/sub per eventi e bus interno;
- supporto realtime per bridge websocket e servizi job-based.

## Porta esposta

- `6379:6379`

## Comandi Redis nel docker-compose

Nel compose la sezione `command` sovrascrive i default di Redis per ottimizzare l'uso come cache/event bus.

```yaml
command:
  [
    "redis-server",
    "--appendonly", "no",
    "--save", "",
    "--maxmemory", "512mb",
    "--maxmemory-policy", "allkeys-lru"
  ]
```

Significato delle opzioni:

- `redis-server`
  Avvia il server Redis.

- `--appendonly no`
  Disabilita AOF (Append Only File), quindi Redis non scrive ogni operazione su file persistente.
  Effetto: meno I/O su disco, performance migliori, ma dati non garantiti dopo riavvio/crash.

- `--save ""`
  Disabilita anche i salvataggi snapshot RDB periodici.
  Effetto: Redis lavora in modalita completamente volatile (adatto a cache e bus eventi).

- `--maxmemory 512mb`
  Impone un limite massimo alla memoria usata da Redis (512 MB), evitando crescita incontrollata.

- `--maxmemory-policy allkeys-lru`
  Quando si raggiunge il limite memoria, Redis espelle chiavi meno recentemente usate (LRU), su tutto il keyspace.
  Effetto: comportamento prevedibile in pressione memoria senza errore immediato sulle write.

## Perche questa configurazione

Questa configurazione e coerente con l'uso di Redis nel progetto:

- priorita a velocita e latenza bassa;
- dati Redis considerati ricostruibili o temporanei;
- controllo della memoria in ambienti con piu microservizi concorrenti.

## Configurazione (docker-compose.paper.yml)

```yaml
redis:
  image: redis:7
  restart: unless-stopped
  command:
    [
      "redis-server",
      "--appendonly", "no",
      "--save", "",
      "--maxmemory", "512mb",
      "--maxmemory-policy", "allkeys-lru"
    ]
  ports:
    - "6379:6379"
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
```
