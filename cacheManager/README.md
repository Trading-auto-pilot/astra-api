# 🗃️ cacheManager

Microservizio per la gestione della cache di dati storici per strategie di trading algoritmico.

## 🚀 Funzionalità

- Recupero di dati storici da provider esterni (es. Alpaca)
- Gestione della cache su filesystem (per Anno-Mese-Simbolo-TF)
- Supporto alla paginazione e caching parziale
- Interfaccia REST per richiedere dati da cache o da provider
- Integrazione dinamica con `dbManager` per i parametri di configurazione

## 📦 Struttura del progetto

```
.
├── src/
│   ├── cacheManager.js      # Logica principale di caching
│   ├── server.js            # REST API Server
├── Dockerfile               # Docker container per il deploy
├── docker-compose.yml       # Composizione per ambienti multipli
├── package.json             # Dipendenze e script
└── README.md                # Documentazione
```

## 📥 Installazione

```bash
git clone https://github.com/tuo-utente/cacheManager.git
cd cacheManager
npm install
```

## ⚙️ Avvio del servizio

```bash
npm start
```

Oppure, con Docker:

```bash
docker build -t cache-manager .
docker run -p 3001:3001 cache-manager
```

## 🔐 Variabili d’ambiente richieste

| Nome                 | Descrizione                             | Esempio                  |
|----------------------|------------------------------------------|--------------------------|
| `ALPACA_API_KEY`     | API key Alpaca                           | AK***************        |
| `ALPACA_SECRET_KEY`  | Secret key Alpaca                        | SK***************        |
| `ALPACA_ENDPOINT`    | Endpoint API Alpaca                      | https://data.alpaca.markets |
| `CACHE_PATH`         | Path root dove salvare la cache          | ./data/cache             |
| `DBMANAGER_URL`      | Endpoint REST del servizio `dbManager`   | http://dbmanager:3002    |

## 📡 Endpoint REST disponibili

| Metodo | Endpoint             | Descrizione                                   |
|--------|----------------------|-----------------------------------------------|
| GET    | `/health`            | Verifica lo stato del servizio                |
| GET    | `/getInfo`           | Informazioni base sul servizio                |
| POST   | `/getData`           | Richiede i dati, cercando prima nella cache   |

### 🔧 Esempio payload per `/getData`

```json
{
  "symbol": "AAPL",
  "startDate": "2023-01-01",
  "endDate": "2023-03-01",
  "timeframe": "1Day"
}
```

## 🐳 Docker Compose (con dipendenza da `dbManager`)

```yaml
services:
  cacheManager:
    build: .
    depends_on:
      - dbManager
    ports:
      - "3001:3001"
```

## 🧪 Test

Puoi testare il servizio con:

```bash
curl -X POST http://localhost:3001/getData \
  -H "Content-Type: application/json" \
  -d '{"symbol":"AAPL","startDate":"2023-01-01","endDate":"2023-03-01","timeframe":"1Day"}'
```

## 📄 Licenza

MIT License

---

### 🧩 Tag GitHub consigliati

```
cache · trading · microservice · nodejs · rest-api · alpaca · docker
```
