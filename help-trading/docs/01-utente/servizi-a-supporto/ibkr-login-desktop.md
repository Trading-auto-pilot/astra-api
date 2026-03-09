---
sidebar_position: 4
---

# ibkr-login-desktop

Il microservizio `ibkr-login-desktop` permette di eseguire il login IBKR da remoto mostrando un desktop browser ospitato sul server.

Nasce per risolvere il vincolo del Client Portal Gateway IBKR: la UI di login funziona correttamente quando viene aperta su `https://localhost:5000`. Per questo motivo il browser che apre la pagina IBKR viene eseguito nel server, non nel browser locale dell'utente.

## Scopo del servizio

`ibkr-login-desktop` fornisce due funzioni principali:

1. Desktop remoto noVNC per autenticazione IBKR.
2. API REST per salvare/riempire credenziali nel browser remoto.

## Come e implementato (stato attuale)

Dal codice e dalla configurazione Docker:

- il container usa `network_mode: "service:ibkrgw-paper"`: condivide il namespace di rete con `ibkrgw-paper`;
- Chromium viene avviato su `https://localhost:5000` (che in questo contesto punta al gateway IBKR);
- un display virtuale (`Xvfb`) ospita Chromium;
- `x11vnc` esporta la sessione grafica;
- `websockify`/noVNC espone la UI remota su porta `6080`;
- un server Node.js (porta `3009`) espone endpoint di supporto per credenziali.

## Flusso operativo

1. L'utente apre la pagina noVNC (`/ibkr-login/...`) dal frontend.
2. Visualizza il Chromium del server gia puntato a `https://localhost:5000`.
3. Inserisce credenziali IBKR nel desktop remoto.
4. La sessione IBKR resta attiva sul gateway.

In alternativa, lato admin si possono salvare credenziali e compilare automaticamente i campi login tramite API dedicate.

## Endpoint principali

Prefisso servizio API: `/ibkr-login-desktop`

| Metodo | Path | Uso |
|---|---|---|
| `GET` | `/credentials` | Legge username salvato e presenza password |
| `POST` | `/credentials` | Salva username/password nei settings del servizio |
| `POST` | `/credentials/fill` | Compila i campi login nel Chromium remoto via CDP |
| `GET` | `/status/health` | Health check |

### Dettaglio compilazione automatica (`/credentials/fill`)

Il servizio:

- legge le credenziali dai settings (`ibkr_username`, `ibkr_password`);
- interroga Chromium sul debug endpoint locale `http://127.0.0.1:9222/json`;
- apre una connessione WebSocket CDP verso la tab attiva;
- esegue uno script JS che valorizza i campi username/password nel DOM.

## Routing e URL

In ambiente PAPER, dal `docker-compose.paper.yml`:

- API REST: host `trading.expovin.it`, path prefix `/ibkr-login-desktop` (servizio porta `3009`);
- Desktop noVNC: host `trading.expovin.it`, path prefix `/ibkr-login` (servizio porta `6080`).

## Sicurezza e note operative

- Gli endpoint API `/ibkr-login-desktop/*` sono protetti dal middleware `auth-forward@docker`.
- Le credenziali salvate vengono gestite come settings applicativi del microservizio.
- Il desktop remoto e una sessione condivisa del browser nel container.
- La disponibilita operativa del servizio si verifica con `GET /status/health`.

## Riferimenti

- Roadmap tecnica: `/docs/roadmap/ibkr-portal-proxy`
- Microservizio sorgente: `trading-system/ibkr-login-desktop`
