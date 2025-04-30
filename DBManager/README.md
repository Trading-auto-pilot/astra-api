# 🗄️ dbManager

Microservizio centrale per la gestione delle configurazioni, parametri runtime e log delle strategie di trading.

## 🚀 Funzionalità

- Espone configurazioni centralizzate via REST
- Permette la lettura e scrittura di parametri chiave per altri microservizi
- Gestione dei log di esecuzione e risultati delle strategie
- Architettura modulare e integrabile con database relazionale o NoSQL
- Supporto a query parametriche e chiavi dinamiche

## 📦 Struttura del progetto

```
.
├── src/
│   ├── dbManager.js          # Logica di gestione DB e configurazioni
│   ├── server.js             # REST API Server
├── Dockerfile                # Docker container per il deploy
├── docker-compose.yml       # Composizione per ambienti multipli
├── package.json             # Dipendenze e script
└── README.md                # Documentazione
```

## 📥 Installazione

```bash
git clone https://github.com/tuo-utente/dbManager.git
cd dbManager
npm install
```

## ⚙️ Avvio del servizio

```bash
npm start
```

Oppure, con Docker:

```bash
docker build -t db-manager .
docker run -p 3002:3002 db-manager
```

## 🔐 Variabili d’ambiente richieste

| Nome                 | Descrizione                         | Esempio                       |
|----------------------|--------------------------------------|-------------------------------|
| `DB_TYPE`            | Tipo di database (es. sqlite, mongo) | sqlite                        |
| `DB_PATH`            | Path al file DB locale (se sqlite)   | ./data/db.sqlite              |

## 📡 Endpoint REST disponibili

| Metodo | Endpoint             | Descrizione                                 |
|--------|----------------------|---------------------------------------------|
| GET    | `/health`            | Verifica lo stato del servizio              |
| GET    | `/getInfo`           | Informazioni base del servizio              |
| GET    | `/config/:key`       | Recupera il valore per una chiave           |
| POST   | `/config/:key`       | Imposta o aggiorna una configurazione       |
| POST   | `/log`               | Inserisce un log o messaggio operativo      |

### 🔧 Esempio payload per `/config/:key`

```json
{
  "value": "https://api.alpaca.markets"
}
```

### 🔧 Esempio payload per `/log`

```json
{
  "strategyId": "meanReversion_MSFT",
  "message": "Eseguito BUY a 283.40",
  "timestamp": "2025-04-29T12:34:00Z"
}
```

## 🐳 Docker Compose

```yaml
services:
  dbManager:
    build: .
    ports:
      - "3002:3002"
    volumes:
      - ./data:/data
```

## 🧪 Test

```bash
curl http://localhost:3002/config/ALPACA_ENDPOINT
```

## 📄 Licenza

MIT License

---

### 🧩 Tag GitHub consigliati

```
config · logging · trading · microservice · nodejs · rest-api · database · docker
```
