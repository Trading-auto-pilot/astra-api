# 📣 alertingService

Microservizio per la gestione degli alert e delle notifiche, con supporto all’invio email.

## 🚀 Funzionalità

- Invio di email personalizzate
- Endpoint REST per triggerare alert
- Logging avanzato delle operazioni
- Health check integrato
- Parametri configurabili tramite variabili d’ambiente o database

## 📦 Struttura del progetto

```
.
├── src/
│   ├── alertingService.js   # Logica principale di invio email
│   ├── server.js            # REST API Server
├── Dockerfile               # Docker container per il deploy
├── docker-compose.yml       # Composizione per ambienti multipli
├── package.json             # Dipendenze e script
└── README.md                # Documentazione
```

## 📥 Installazione

```bash
git clone https://github.com/tuo-utente/alertingService.git
cd alertingService
npm install
```

## ⚙️ Avvio del servizio

```bash
npm start
```

Oppure, con Docker:

```bash
docker build -t alerting-service .
docker run -p 3000:3000 alerting-service
```

## 🔐 Variabili d’ambiente richieste

| Nome              | Descrizione                        | Esempio                     |
|-------------------|-------------------------------------|-----------------------------|
| `SMTP_HOST`       | Host SMTP per l’invio mail         | smtp.gmail.com              |
| `SMTP_PORT`       | Porta SMTP                         | 587                         |
| `SMTP_USER`       | Username dell’account email        | alerting@dominio.com        |
| `SMTP_PASS`       | Password o token dell’account      | ********                    |
| `EMAIL_FROM`      | Indirizzo mittente                 | alerting@dominio.com        |
| `EMAIL_TO`        | Destinatario di default (facolt.)  | admin@dominio.com           |

## 📡 Endpoint REST disponibili

| Metodo | Endpoint          | Descrizione                      |
|--------|-------------------|----------------------------------|
| GET    | `/health`         | Verifica lo stato del servizio   |
| GET    | `/getInfo`        | Informazioni base sul servizio   |
| POST   | `/email/send`     | Invia una mail con contenuto JSON|

### 🔧 Esempio payload per `/email/send`

```json
{
  "to": "utente@example.com",
  "subject": "Test Alert",
  "body": "Questo è un messaggio di prova."
}
```

## 🧪 Test

Puoi testare l’invio email usando strumenti come Postman o `curl`:

```bash
curl -X POST http://localhost:3000/email/send \
  -H "Content-Type: application/json" \
  -d '{"to":"user@domain.com", "subject":"Alert", "body":"Messaggio di test"}'
```

## 🐳 Docker Compose (con dipendenza da `dbManager`)

Nel `docker-compose.yml` assicurati di includere la dipendenza:

```yaml
services:
  alertingService:
    build: .
    depends_on:
      - dbManager
    ports:
      - "3000:3000"
```

## 📄 Licenza

MIT License

---

### 🧩 Tag GitHub consigliati

Puoi aggiungere questi tag al tuo repository GitHub per facilitarne la scoperta:

```
alerting · microservice · nodejs · email · rest-api · docker · notifications
```
