
# Trading System - Backtesting Framework

Benvenuto nel progetto **Trading System**!  
Questo progetto permette di **testare strategie di trading** su dati storici e di **simularne l'esecuzione** tramite un'architettura **modulare**, **dockerizzabile**, **scalabile**.

---

## ✨ Funzionalità principali

- **Backtesting** basato su dati storici recuperati da provider (es. Alpaca)
- **Caching intelligente** dei dati storici per ridurre chiamate API
- **Supporto a strategie modulari** (es: SMA, Double MA, TSL su 2 green candles)
- **Salvataggio delle operazioni (BUY/SELL)** su database MySQL
- **Calcolo metriche di performance** (profitto, efficienza, profitto annualizzato)
- **Separazione tra ciclo di dati e logica strategica** (pronto per dati live)
- **Pipeline CI/CD-ready** per deployment su cloud (GCP/Kubernetes)

---

## 🏛️ Architettura del Progetto

```
trading-system/
├── strategies/
│   ├── sma/                    # Strategia SMA (Simple Moving Average)
│   │   ├── index.js             # Esecuzione strategia
│   │   └── processCandle.js     # Logica BUY/SELL della strategia
│   └── (altre strategie)        
├── shared/
│   ├── cacheManager.js          # Gestione caching locale dei dati storici
│   ├── runner.js                # Ciclo generico di backtest
│   └── utils.js                 # Funzioni comuni (DB, calcoli, API)
├── cache/                       # Dati storici salvati localmente
├── .env                         # Variabili d'ambiente
├── package.json                 
└── README.md
```

---

## ⚙️ Modalità di Esecuzione

1. **Clona il repository**
   ```bash
   git clone git@github.com:tuo-utente/trading-system.git
   cd trading-system
   ```

2. **Installa le dipendenze**
   ```bash
   npm install
   ```

3. **Configura il file `.env`**
   Esempio:
   ```
   SYMBOL=MSFT
   START_DATE=2024-01-01
   END_DATE=2025-03-31
   CAPITALE=100
   PERIOD=25
   SL=0.04
   TP=0.08
   API_KEY=xxx
   API_SECRET=xxx
   ```

4. **Avvia un backtest**
   ```bash
   node strategies/sma/index.js
   ```

---

## 🛠️ Tecnologie utilizzate

- **Node.js**
- **MySQL** (o MariaDB)
- **Axios** per chiamate API
- **GitHub / GitHub Actions** (per CI/CD - facoltativo)
- **Docker** (in sviluppo)

---

## 🗃️ Database

- `strategy_runs`: contiene il risultato complessivo di ogni run
- `transazioni`: log dettagliato di ogni BUY e SELL

---

## 🔥 Prossimi sviluppi

- Integrazione dati **live** (streaming)
- Implementazione REST Server di controllo (Start, Stop, Monitoring)
- Interfaccia Web
- Deploy completo su **GCP Kubernetes**
- Strategie avanzate multi-timeframe e machine learning

---

## 📜 Licenza

Questo progetto è in fase di sviluppo privato.  
Non è consentita la distribuzione senza autorizzazione.

---

## 👨‍💻 Autore

Vincenzo Esposito - [LinkedIn](https://linkedin.com)

---

> 🚀 **Let's build a world-class trading architecture together!**
