
# 📘 Microservice Template & Scaffolding Guide
_Standardizzazione dei microservizi – Struttura, Placeholder e Generatore Automatico_

---

## 🧩 1. Obiettivo del Template

Il progetto utilizza un sistema di *microservizi Node.js* fortemente standardizzato.
Per evitare duplicazioni, errori e differenze strutturali tra i servizi, esiste:

- Un **template base**: `__TemplateService/`
- Uno **script di scaffolding**: `create-microservice.js`

Questo approccio consente di creare un nuovo microservizio in pochi secondi, con:

- struttura uniforme  
- naming coerente  
- URL dei servizi generati automaticamente  
- porta assegnata in modo intelligente (o definita manualmente)  
- aggiunta automatica al `docker-compose.yml`  
- aggiornamento dei file centrali (`ports.json`, `release.json`, ecc.)

---

## ⚙️ 2. Come funziona lo Scaffolding

### Comando principale

```bash
node create-microservice.js <ServiceName>
```

Esempi:

```bash
node create-microservice.js MarketStreamer
node create-microservice.js OrderRouter --port=3020
node create-microservice.js RiskEngine --version=0.2.0 --description="Risk management microservice"
```

### Parametri disponibili

| Parametro         | Descrizione                                                   |
| ----------------- | ------------------------------------------------------------- |
| `<ServiceName>`   | **Unico obbligatorio**. Nome microservizio/cartella/className |
| `--port=XXXX`     | Porta specifica (altrimenti viene assegnata automaticamente) |
| `--version=X.Y.Z` | Versione iniziale del microservizio (default: `0.1.0`)       |
| `--description="..."` | Descrizione per il `package.json`                        |

---

## 📁 3. File gestiti dallo Scaffolding

Lo script effettua automaticamente:

### 1. Creazione della cartella del servizio

Da `__TemplateService/` viene creata una nuova cartella:

```
/<ServiceName>/
```

con tutti i file pronti e personalizzati.

---

### 2. Sostituzione dei Placeholder

In questi file vengono rimpiazzati i placeholder:

| File             | Placeholder                                                                 |
| ---------------- | ---------------------------------------------------------------------------- |
| `modules/main.js` | `__MICROSERVICE_NAME__`, `__CLASS_NAME__`, `__MODULE_VERSION__`, `__SERVICE_URLS_BLOCK__` |
| `server.js`      | `__MICROSERVICE_NAME__`, `__REST_MODULE_NAME__`, `__MODULE_VERSION__`, `__PORT__` |
| `package.json`   | `__MICROSERVICE_NAME__`, `__VERSION__`, `__DESCRIPTION__`                   |
| `Dockerfile`     | `__SERVICE_FOLDER__`, `__PORT__`                                            |
| `release.json`   | `__LAST_UPDATE__`, `__VERSION__`, `__MICROSERVICE_NAME__`                   |
| `nodemon.json`   | `__SERVICE_MAIN_FILE__`                                                     |

---

### 3. Aggiornamento del `doc/ports.json`

Esempio formato:

```json
{
  "dbmanager": 3002,
  "marketsimulator": 3003,
  "ordersimulator": 3004
}
```

Lo script:

1. Verifica che il `serviceName` sia nuovo
2. Trova una porta libera
3. Oppure usa quella specificata con `--port`
4. Scrive la nuova entry nel file

---

### 4. Iniezione automatica nel `docker-compose.yml`

Viene generato un blocco come:

```yaml
  marketlistener:
    image: expovin/marketlistener:${MARKETLISTENER_VERSION}
    container_name: marketlistener
    restart: unless-stopped
    ports:
      - "3013:3013"
    networks:
      - trading-net
    depends_on:
      dbmanager:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      - LOG_LEVEL=${LOG_LEVEL}
      - MYSQL_HOST=mysql
      - MYSQL_PORT=${MYSQL_PORT}
      - MYSQL_USER=${MYSQL_USER}
      - MYSQL_PASSWORD=${MYSQL_PASSWORD}
      - MYSQL_DATABASE=${MYSQL_DATABASE}
      - REDIS_URL=redis://redis:6379
      - DBMANAGER_URL=http://dbmanager:3002
      - CACHEMANAGER_URL=http://cachemanager:3006
      - CAPITALMANAGER_URL=http://capitalmanager:3009
      # ... altri URL generati automaticamente
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3013/health"]
      interval: 10s
      timeout: 10s
      retries: 5
```

Tutte le URL verso altri microservizi vengono generate automaticamente
**leggendole da `doc/ports.json`**, inclusi i microservizi futuri.

---

## 🧱 4. Struttura del Template (`__TemplateService`)

Il template deve contenere:

```
__TemplateService/
│
├── server.js
├── Dockerfile
├── nodemon.json
├── package.json
├── release.json
│
└── modules/
    └── main.js
```

---

## 🔑 5. Placeholder Supportati

### `modules/main.js`

```text
__MICROSERVICE_NAME__
__CLASS_NAME__
__MODULE_VERSION__
__SERVICE_URLS_BLOCK__
```

### `server.js`

```text
__MICROSERVICE_NAME__
__REST_MODULE_NAME__
__MODULE_VERSION__
__PORT__
```

### `package.json`

```text
__MICROSERVICE_NAME__
__VERSION__
__DESCRIPTION__
```

### `Dockerfile`

```text
__SERVICE_FOLDER__
__PORT__
```

### `release.json`

```text
__LAST_UPDATE__
__VERSION__
__MICROSERVICE_NAME__
```

### `nodemon.json`

```text
__SERVICE_MAIN_FILE__
```

---

## 🧠 6. Come viene generato il blocco URL in `main.js`

Esempio di codice generato dallo scaffolding dentro `modules/main.js`:

```js
// Auto-generated service URLs from doc/ports.json
this.dbmanagerUrl = process.env.DBMANAGER_URL || "http://dbmanager:3002";
this.cachemanagerUrl = process.env.CACHEMANAGER_URL || "http://cachemanager:3006";
this.alertingserviceUrl = process.env.ALERTINGSERVICE_URL || "http://alertingservice:3008";
this.livemarketlistenerUrl = process.env.LIVEMARKETLISTENER_URL || "http://livemarketlistener:3012";
```

Questo permette di:

- aggiungere nuovi microservizi in futuro **senza toccare il template**
- avere costanti URL sempre aggiornate e coerenti tra i servizi

---

## 🚀 7. Creare un nuovo microservizio – Esempio completo

```bash
node create-microservice.js PriceScanner --description="Scansione prezzi" --version=0.1.0
```

Risultato:

1. Creata cartella `PriceScanner/`
2. Creata classe `PriceScanner` in `modules/main.js`
3. Porta assegnata automaticamente (es. `3014`) o da `--port`
4. Aggiornato `doc/ports.json`
5. Aggiornato `docker-compose.yml`
6. Generati tutti i file con i placeholder sostituiti

---

## ✅ 8. Vantaggi

- Standardizzazione totale dei microservizi
- Nessun copia/incolla manuale
- Aggiornamento consistente di:
  - `doc/ports.json`
  - `docker-compose.yml`
  - `release.json`
  - `package.json`
- Architettura pronta a crescere con nuovi servizi in modo ordinato

Se modifichi la struttura del template (`__TemplateService/`), ricorda di aggiornare anche questo documento e lo script `create-microservice.js`.
