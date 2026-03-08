---
sidebar_position: 2
---

# Variabili d'ambiente

Questa pagina e generata a partire da `trading-system/.env.local` e documenta il significato operativo di ogni variabile.

| Variabile | Cosa controlla | Come funziona |
|---|---|---|
| `ENV` | Ambiente globale runtime | Valori tipici: `LOCAL`, `PAPER`, `LIVE`. Influenza canali, integrazioni e comportamento dei servizi. |
| `MYSQL_DATABASE` | Nome database MySQL | Schema principale usato dai microservizi. |
| `MYSQL_USER` | Utente MySQL applicativo | Credenziali non-root per accesso servizi. |
| `MYSQL_PASSWORD` | Password utente MySQL applicativo | Usata dai servizi che si connettono al DB. |
| `MYSQL_ROOT_PASSWORD` | Password root MySQL | Solo per bootstrap/amministrazione DB. |
| `MYSQL_PORT` | Porta MySQL | Porta TCP esposta dal container DB. |
| `MYSQL_HOST` | Host MySQL | `localhost` in host mode o nome servizio Docker in compose. |
| `ALPACA_MARKET_FEED` | Sorgente feed Alpaca | Seleziona feed market Alpaca (es. `iex`). |
| `FEED` | Feed market di default | Usato dai moduli che richiedono un feed sintetico unico. |
| `ENV_MARKET` | Ambiente logico per moduli market | Override dedicato ai moduli market-data, se separato da `ENV`. |
| `ENV_ORDERS` | Ambiente logico per moduli ordini | Permette separazione di routing/config ordini rispetto all'ambiente globale. |
| `ENV_TRADING` | Ambiente logico per flussi trading | Usato dai servizi trading per distinguere policy e sorgenti dati. |
| `LOG_LEVEL` | Livello di logging applicativo | Valori tipici: `trace`, `debug`, `info`, `warning`, `error`. |
| `ENABLE_DB_LOG` | Abilita persistenza log su DB | Quando `true`, i logger inviano batch verso datahub/DB. |
| `DBMANAGER_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `CACHEMANAGER_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `CAPITALMANAGER_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `ALERTINGSERVICE_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `STRATEGYUTILS_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `LIVEMARKETLISTENER_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `ORDERLISTNER_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `ORDERSIMULATOR_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `MARKETSIMULATOR_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `TICKERSCANNER_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `SMA_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `SLTP_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `APCA_API_KEY_ID` | Configurazione applicativa | Variabile usata in fase bootstrap/runtime dal relativo servizio. |
| `APCA_API_SECRET_KEY` | Credenziale/segreto | Valore sensibile; va gestito tramite secret manager e mai committato. |
| `FMP_API_KEY` | Credenziale/segreto | Valore sensibile; va gestito tramite secret manager e mai committato. |
| `DBMANAGER_URL` | Endpoint legacy DBManager | Compatibilita storica; in gran parte sostituito da `DATAHUB_URL`. |
| `DATAHUB` | Alias URL datahub | Variabile legacy/alternativa per endpoint datahub. |
| `SMA_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `SLTP_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `CAPITAL_MANAGER_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `ALERTINGMANAGER_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `CACHEMANAGER_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `REDIS_URL` | Endpoint Redis | Bus eventi, cache e stato runtime condiviso. |
| `LIVEMARKETMANAGER_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `MARKETSIMULATOR_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `SCHEDULER_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `SCHEDULER_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `AUTH_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `AUTH_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `AUTHSERVICE_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `JWT_SECRET` | Segreto firma JWT utente | Usato da authservice per emettere/verificare token. |
| `JWT_EXPIRES_IN` | Scadenza JWT utente | Durata token (es. `8h`). |
| `CORS_ORIGIN` | Whitelist origin CORS | Lista CSV di origin browser consentite. |
| `ASTRAAI_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `SERVICECONTROLPLANE_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `SERVICECONTROLPLANE_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `MARKET_DAILY_CONCURRENCY` | Parallelismo job market daily | Numero worker concorrenti per elaborazioni giornaliere. |
| `SCAN_MISSING_BATCH` | Batch recupero dati mancanti | Dimensione batch per colmare gap dati. |
| `SCAN_BULK_SIZE` | Batch upsert scanner | Numero record per operazioni bulk scanner. |
| `SCAN_FMP_CONCURRENCY` | Concorrenza chiamate FMP | Limita parallelismo API provider FMP. |
| `SCAN_MOMENTUM_CONCURRENCY` | Concorrenza calcolo momentum | Controlla job simultanei su metriche momentum. |
| `SCAN_UPSERT_CONCURRENCY` | Concorrenza upsert DB scanner | Throttle scritture concorrenti su storage. |
| `IBKRBRIDGE_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `DECISIONENGINE_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `DECISION_ENGINE_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `IBKR_BRIDGE_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `IBKRGW_BASE_URL` | Base URL IBKR Gateway | Endpoint upstream HTTPS del gateway IBKR. |
| `IBKR_REQUEST_TIMEOUT_MS` | Timeout richieste IBKR | Massimo tempo attesa chiamate REST verso gateway. |
| `BODY_LIMIT` | Limite dimensione body HTTP | Valore Express per payload request (es. `20mb`). |
| `IBKRKEEPALIVE_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `IBKRKEEPALIVE_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `IBKR_INSECURE_TLS` | TLS insecure per IBKR REST | Se `true`, accetta certificati non trusted (solo ambienti non-prod). |
| `MARKETDATASERVICE_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `MARKETDATASERVICE_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `REDISWSBRIDGE_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `REDIS_PATTERNS` | Pattern subscribe Redis | Pattern pub/sub (es. `*`) per bridge/ws listener. |
| `DATA_SERVICE_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `TWILIO_ACCOUNT_SID` | Credenziale Twilio account | Identifica account per invio WhatsApp/SMS. |
| `TWILIO_AUTH_TOKEN` | Credenziale Twilio secret | Token di autenticazione API Twilio. |
| `TWILIO_CONTENT_SID` | Template/content Twilio | Identificativo contenuto/template per messaggi strutturati. |
| `SMTP_HOST` | Server SMTP | Host provider email per alerting. |
| `SMTP_PORT` | Porta SMTP | Tipicamente `587` (STARTTLS) o `465`. |
| `SMTP_USER` | Utente SMTP | Account mittente autenticato. |
| `SMTP_PASSWORD` | Password SMTP | Secret account email. |
| `SMTP_FROM` | Mittente email | Indirizzo `From` usato da alerting service. |
| `ALERTING_LOGS_PATTERN` | Filtro stream log per alerting | Pattern Redis/bus da osservare per regole alert. |
| `ALERTING_WINDOW_SECONDS` | Finestra rate-limit alert | Durata finestra temporale anti-spam notifiche. |
| `ALERTING_MAX_PER_WINDOW` | Max alert per finestra | Numero massimo notifiche nella finestra configurata. |
| `ALERTING_DEDUP_SECONDS` | Deduplica alert | Intervallo minimo per evitare duplicati dello stesso evento. |
| `ALERTING_DEFAULT_EMAIL_TO` | Destinatario email default | Fallback se la regola non specifica recipient. |
| `IBKR_SSODH_INIT_INTERVAL_MS` | Retry interval inizializzazione SSO/stream | Intervallo iniziale di retry per bootstrap canali IBKR. |
| `LOG_BATCH_MAX_BYTES` | Dimensione max batch log | Limite byte per invio batch log verso DB. |
| `COMPOSE_PROFILES` | Profili Docker da avviare | Lista CSV usata da `docker compose --profile` per accendere solo i servizi desiderati. |
| `INTERNAL_JWT_PRIVATE_KEY` | Chiave privata JWT interno | Firma i token service-to-service (`x-internal-token`). Formato base64 PEM. |
| `INTERNAL_JWT_PUBLIC_KEY` | Chiave pubblica JWT interno | Verifica token interni tra microservizi. |
| `INTERNAL_JWT_ISS` | Issuer token interni | Valore `iss` atteso/firmato nei token interni. |
| `INTERNAL_JWT_EXP_SECONDS` | TTL token interni | Scadenza breve in secondi per limitare replay. |
| `L3_USAGE_ALERT_PERCENT` | Soglia alert uso cache L3 | Percentuale oltre cui cacheManager genera warning/alert memoria. |
| `LIQUIDITYMANAGER_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `LIQUIDITYMANAGER_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `FRED_API_KEY` | Credenziale/segreto | Valore sensibile; va gestito tramite secret manager e mai committato. |
| `LIQ_DXY_PROVIDER` | Provider DXY liquidity | Seleziona sorgente indice dollaro (es. `fred`). |
| `BROKER_EXECUTOR_IBKR_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `BROKEREXECUTORIBKR_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `IBKR_WS_INSECURE_TLS` | TLS insecure per IBKR WebSocket | Stessa logica ma per connessioni WS/WSS. |
| `NETWORK` | Nome rete Docker | Allinea servizi e Traefik sulla stessa network (`trading_net` o custom). |
| `TIMEZONE` | Timezone container | Imposta `TZ` nei servizi per scheduling/log coerenti. |
| `MAX_RETRY_DELAY` | Ritardo massimo retry | Upper bound per backoff/retry in alcuni moduli. |
| `IBKRBRIDGE_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `TICKLE_INTERVAL_MS` | Intervallo keepalive IBKR | Frequenza ping/tickle sessione gateway. |
| `AUTH_CHECK_INTERVAL_MS` | Intervallo controllo auth IBKR | Polling stato autenticazione verso gateway. |
| `TICKERSCANNER_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `AUTHSERVICE_URL` | Endpoint servizio | Base URL usata da altri microservizi per chiamate interne. |
| `IBKRGW_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `DATAHUB_VERSION` | Tag versione immagine/container | Usata nei compose per scegliere versione servizio (`latest` o release specifica). |
| `DATAHUB_URL` | Endpoint principale datahub | URL usato dai servizi per settings, CRUD e configurazioni centralizzate. |
