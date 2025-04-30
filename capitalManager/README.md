# 💰 capitalManagement

Microservizio per la gestione del capitale e del bilanciamento delle strategie di trading.

## 🚀 Funzionalità

- Allocazione dinamica del capitale per strategia
- Tracciamento del capitale disponibile, investito e storico
- REST API per lettura e aggiornamento dello stato del capitale
- Integrazione con strategie e logiche di gestione rischio
- Logging completo e integrazione futura con database centralizzato

## 📦 Struttura del progetto

```
.
├── src/
│   ├── capitalManager.js     # Logica di gestione del capitale
│   ├── server.js             # REST API Server
├── Dockerfile                # Docker container per il deploy
├── docker-compose.yml       # Composizione per ambienti multipli
├── package.json             # Dipendenze e script
└── README.md                # Documentazione
```

## 📥 Installazione

```bash
git clone https://github.com/tuo-utente/capitalManagement.git
cd capitalManagement
npm install
```

## ⚙️ Avvio del servizio

```bash
npm start
```

Oppure, con Docker:

```bash
docker build -t capital-management .
docker run -p 3003:3003 capital-management
```

## 🔐 Variabili d’ambiente richieste

| Nome                 | Descrizione                           | Esempio                     |
|----------------------|----------------------------------------|-----------------------------|
| `DBMANAGER_URL`      | Endpoint REST del servizio dbManager   | http://dbmanager:3002       |
| `STARTING_CAPITAL`   | Capitale iniziale per la simulazione   | 10000                       |

## 📡 Endpoint REST disponibili

| Metodo | Endpoint               | Descrizione                                 |
|--------|------------------------|---------------------------------------------|
| GET    | `/health`              | Verifica lo stato del servizio              |
| GET    | `/getInfo`             | Informazioni sul capitale e configurazioni  |
| GET    | `/capital`             | Stato attuale del capitale                  |
| POST   | `/allocate`            | Alloca capitale a una strategia             |
| POST   | `/release`             | Rilascia capitale non più usato             |

### 🔧 Esempio payload per `/allocate`

```json
{
  "strategyId": "meanReversion_MSFT",
  "amount": 1500
}
```

### 🔧 Esempio payload per `/release`

```json
{
  "strategyId": "meanReversion_MSFT"
}
```

## 🐳 Docker Compose (con dipendenza da `dbManager`)

```yaml
services:
  capitalManagement:
    build: .
    depends_on:
      - dbManager
    ports:
      - "3003:3003"
```

## 🧪 Test

```bash
curl http://localhost:3003/capital
```

## 📄 Licenza

MIT License

---

### 🧩 Tag GitHub consigliati

```
capital · trading · microservice · nodejs · rest-api · portfolio · docker
```
