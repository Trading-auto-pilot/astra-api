# 🧭 Progetto Microservizi – Trading Automation

Questo repository contiene l'infrastruttura completa per un sistema di trading automatizzato basato su microservizi. Ogni servizio è containerizzato con Docker e orchestrato tramite `docker-compose`.

## 🧱 Servizi Inclusi

| Servizio            | Descrizione                                              | Porta |
|---------------------|----------------------------------------------------------|-------|
| [alertingService](./alertingService/README.md)       | Gestione degli alert e notifiche via email.             | 3000  |
| [cacheManager](./cacheManager/README.md)             | Caching dei dati storici da provider esterni.           | 3001  |
| [dbManager](./DBManager/README.md)                   | Gestione centralizzata delle configurazioni e dei log.  | 3002  |
| [capitalManagement](./capitalManager/README.md)   | Allocazione e monitoraggio del capitale per le strategie.| 3003  |

## 🚀 Avvio Rapido

Assicurati di avere installato Docker e Docker Compose. Poi, esegui:

```bash
docker-compose up --build
```

Questo comando costruirà e avvierà tutti i servizi definiti nel file `docker-compose.yml`.

## 🔐 Internal Auth (service-to-service)

Per le chiamate interne firmate JWT (EdDSA/Ed25519):

- **Scheduler**:
  - `INTERNAL_JWT_PRIVATE_KEY` (PEM, PKCS8)
  - `INTERNAL_JWT_PUBLIC_KEY` (PEM, SPKI) — opzionale lato scheduler
- **TickerScanner**:
  - `INTERNAL_JWT_PUBLIC_KEY` (PEM, SPKI)

Endpoint interno: `POST /internal/fundamentals/user-daily-scores` con header `X-Internal-Token`.

## 🐳 docker-compose.yml

Il file `docker-compose.yml` definisce i servizi, le loro dipendenze e le configurazioni necessarie per l'orchestrazione dell'intero sistema. Ecco una panoramica dei servizi definiti:

```yaml
version: '3.8'

services:
  alertingService:
    build: ./alertingService
    ports:
      - "3000:3000"
    depends_on:
      - dbManager

  cacheManager:
    build: ./cacheManager
    ports:
      - "3001:3001"
    depends_on:
      - dbManager

  dbManager:
    build: ./dbManager
    ports:
      - "3002:3002"

  capitalManagement:
    build: ./capitalManagement
    ports:
      - "3003:3003"
    depends_on:
      - dbManager
```

Assicurati che ogni servizio abbia una directory corrispondente con un `Dockerfile` valido.

## 📂 Struttura del Progetto

```
.
├── alertingService/
│   ├── Dockerfile
│   └── README.md
├── cacheManager/
│   ├── Dockerfile
│   └── README.md
├── dbManager/
│   ├── Dockerfile
│   └── README.md
├── capitalManagement/
│   ├── Dockerfile
│   └── README.md
├── docker-compose.yml
└── README.md
```

## 📘 Documentazione dei Servizi

Per dettagli specifici su ciascun servizio, consulta i rispettivi file README:

- [alertingService](./alertingService/README.md)
- [cacheManager](./cacheManager/README.md)
- [dbManager](./DBManager/README.md)
- [capitalManagement](./capitalManager/README.md)

## 🧪 Test dei Servizi

Puoi testare i servizi utilizzando strumenti come `curl` o Postman. Ad esempio, per testare l'endpoint di health check di `alertingService`:

```bash
curl http://localhost:3000/health
```

## 📄 Licenza

Questo progetto è distribuito sotto la licenza MIT.
