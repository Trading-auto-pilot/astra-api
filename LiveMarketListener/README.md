# 🧠 Trading System - Documentazione Tecnica

## ⚙️ Architettura Generale

Questo sistema di trading meccanico è basato su microservizi containerizzati con Docker, ognuno dedicato a una funzione specifica. I servizi comunicano tra loro tramite REST API. L'interfaccia di input/output è costante, così da poter modificare liberamente la logica interna di ogni modulo senza impatti sul sistema complessivo.

## 📦 Servizi Principali

### `DBManager`
Gestisce l'interazione con il database MySQL.

**Funzionalità principali:**
- Recupero parametri e strategie
- Aggiornamento ordini e transazioni
- Registrazione bot e capitale impiegato

**Endpoint REST:** (esempi)
- `GET /symbol`
- `POST /insertOrder`
- `GET /getStrategyCapitalAndOrders/:id`

**Variabili d’ambiente:**
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `LOG_LEVEL`

**Miglioramenti Futuri:**
- Gestione automatica delle riconnessioni al DB
- Separazione per file delle route
- Logging uniforme

---

### `LiveMarketListener`
Componente centrale che si connette al mercato via WebSocket e processa i dati in tempo reale.

**Flusso Operativo:**
1. Riceve una candela da Alpaca
2. Verifica le strategie attive per il simbolo
3. Per ogni strategia riceve un segnale (`BUY`, `SELL`, `HOLD`)
4. In caso di `BUY`, avvia una catena di chiamate tra CapitalManager, Alpaca, DBManager e AlertingService

**Endpoint REST:**
- `POST /pause` - mette in pausa il servizio
- `POST /resume` - riavvia il servizio

**Variabili d’ambiente principali:**
- `ENV_MARKET`, `ENV_ORDERS`, `SMA_URL`, `CAPITAL_MANAGER_URL`, `ALERTINGMANAGER_URL`

**Dipendenze:**
- CacheManager, DBManager, StrategyUtils, CapitalManager, AlertingService
- Solo in sviluppo: MarketSimulator, OrderSimulator

**Miglioramenti Futuri:**
- Supporto dinamico a più strategie
- Separazione logica tra BUY/SELL
- Miglior gestione del WebSocket

---

## 🧾 File Utili

- `docker-compose.yml` - avvia l'intero sistema
- `rebuild.sh` - ricompila e riavvia uno specifico container
- `shared/` - contiene librerie comuni (es. `logger.js`, `strategyUtils.js`)
- `strategies/` - include tutte le strategie implementate (`sma`, `doublems`, etc.)

## 📂 Esempio struttura

```
├── DBManager/
├── LiveMarketListener/
├── MarketSimulator/
├── alertingService/
├── cacheManager/
├── capitalManager/
├── orderListner/
├── orderSimulator/
├── shared/
├── strategies/
├── strategyUtils/
├── docker-compose.yml
└── rebuild.sh
```

## 📌 Nota finale

Questo progetto è modulare, scalabile e pensato per l’estensione semplice di nuove strategie e funzionalità.