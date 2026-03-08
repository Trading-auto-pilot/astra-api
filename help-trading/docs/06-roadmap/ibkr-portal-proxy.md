---
sidebar_position: 3
---

# ibkr-login-desktop — Login IBKR da remoto

## Problema attuale

Il **Client Portal Gateway** di IBKR (`ibkrgw-paper`) gira come container Docker sul server. Il suo JavaScript controlla esplicitamente che il browser stia navigando su `https://localhost:5000`: se l'hostname non è `localhost`, la pagina di login non funziona.

Questo non è un limite di rete o di IP — è una restrizione voluta da IBKR per impedire che il gateway venga esposto su URL pubblici. Non può essere aggirata con un semplice reverse proxy HTTP, perché il browser dell'utente vedrebbe comunque un host diverso da `localhost`.

**Soluzione scartata: reverse proxy HTTP**
Un proxy che forwards le richieste a `ibkrgw-paper:5000` non funziona: il browser dell'utente aprirebbe `https://trading.expovin.it/ibkr-portal/`, il JS di IBKR leggerebbe `window.location.hostname === 'trading.expovin.it'` e rifiuterebbe di operare.

**La vera soluzione:** fare in modo che sia un **browser sul server** ad aprire `https://localhost:5000` — e l'utente veda quello schermo attraverso un'interfaccia web.

---

## Soluzione: noVNC + Chromium in container

Creare il container `ibkr-login-desktop`:

- Usa `network_mode: "service:ibkrgw-paper"` — condivide lo stack di rete con il gateway (lo stesso meccanismo già usato da `ibkr-keepalive`). Da dentro questo container, `localhost:5000` **è** il gateway IBKR.
- Esegue **Xvfb** (display virtuale), **Chromium** (browser headless con display), **x11vnc** + **noVNC/websockify** (VNC accessibile via browser).
- Chromium si apre automaticamente su `https://localhost:5000` all'avvio.
- L'utente naviga su `https://trading.expovin.it/ibkr-login/` e vede lo schermo di Chromium in tempo reale tramite noVNC (HTML5, nessun plugin).
- L'utente inserisce le credenziali IBKR → login completato.
- Il browser continua a girare nel container per tenere la sessione attiva.

---

## Nome microservizio proposto

**`ibkr-login-desktop`**

Indica chiaramente la funzione: un desktop remoto minimale dedicato al login IBKR. Si distingue da `ibkr-bridge` (proxy API) e da `ibkr-keepalive` (keepalive sessione).

---

## Architettura

```
Utente (browser / mobile)
  │
  │  HTTPS  https://trading.expovin.it/ibkr-login/
  ▼
Traefik  (Let's Encrypt cert, websocket passthrough)
  │
  │  HTTP + WebSocket  → ibkr-login-desktop:6080
  ▼
ibkr-login-desktop  [Debian slim]
  ├── Xvfb :1           display virtuale 1280×800
  ├── Chromium          browser, aperto su https://localhost:5000
  ├── x11vnc            VNC server sul display :1 → porta 5900
  └── websockify        WebSocket bridge → noVNC HTML5 client → porta 6080
  │
  │  network_mode: "service:ibkrgw-paper"
  │  → localhost:5000 = ibkrgw-paper:5000
  ▼
ibkrgw-paper  (HTTPS self-signed, porta 5000)
  │
  │  HTTPS  → api.ibkr.com
  ▼
IBKR (autenticazione remota)
```

### Perché `network_mode: "service:ibkrgw-paper"` risolve tutto

Con questa modalità il container condivide il network namespace del gateway. Da dentro il container:

- `localhost:5000` è il gateway IBKR ✅
- Chromium apre `https://localhost:5000` — il JS di IBKR legge `window.location.hostname === 'localhost'` ✅
- Nessun proxy, nessuna riscrittura di URL, nessun workaround ✅

Questo è esattamente il meccanismo già usato da `ibkr-keepalive` per fare le richieste di keepalive al gateway.

---

## Dockerfile

```dockerfile
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    chromium \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 6080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:6080/ || exit 1

ENTRYPOINT ["/entrypoint.sh"]
```

### `entrypoint.sh`

```bash
#!/bin/bash
set -e

DISPLAY_NUM=1
DISPLAY=":${DISPLAY_NUM}"
IBKR_URL="${IBKRGW_LOGIN_URL:-https://localhost:5000}"
VNC_PORT=5900
NOVNC_PORT=6080

# 1. Avvia display virtuale
Xvfb ${DISPLAY} -screen 0 1280x800x24 &

# 2. Avvia Chromium sul display virtuale puntando al gateway
DISPLAY=${DISPLAY} chromium \
  --no-sandbox \
  --disable-gpu \
  --ignore-certificate-errors \
  --kiosk \
  "${IBKR_URL}" &

# 3. Avvia VNC server (no password in rete Docker interna, auth gestita da Traefik)
x11vnc -display ${DISPLAY} -nopw -listen localhost -xkb -rfbport ${VNC_PORT} &

# 4. Avvia websockify con noVNC (espone il VNC su WebSocket)
websockify --web /usr/share/novnc ${NOVNC_PORT} localhost:${VNC_PORT}
```

---

## Flusso utente

```
1. Utente apre astraai e clicca "Connect IBKR"

2. Si apre una nuova tab su:
   https://trading.expovin.it/ibkr-login/vnc.html?autoconnect=1&resize=scale

3. Il browser mostra lo schermo di Chromium in esecuzione sul server
   → la pagina visualizzata è https://localhost:5000 (vista dal server)

4. L'utente inserisce le credenziali IBKR nel browser remoto

5. Login completato — la sessione rimane attiva nel container
   (ibkr-keepalive la mantiene viva come già fa oggi)
```

---

## Configurazione Docker Compose (PAPER)

```yaml
ibkr-login-desktop:
  image: expovin/ibkr-login-desktop:${IBKRLOGINDESKTOP_VERSION}
  restart: unless-stopped
  network_mode: "service:ibkrgw-paper"     # condivide rete con gateway → localhost:5000 = gateway
  depends_on:
    - ibkrgw-paper
  environment:
    - IBKRGW_LOGIN_URL=https://localhost:5000
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:6080/"]
    interval: 30s
    timeout: 5s
    start-period: 15s
    retries: 3
  labels:
    - "traefik.enable=true"
    # noVNC web UI + WebSocket (no ForwardAuth: la sessione noVNC è già protetta da password VNC opzionale)
    - "traefik.http.routers.ibkr-login-desktop.rule=Host(`trading.expovin.it`) && PathPrefix(`/ibkr-login`)"
    - "traefik.http.routers.ibkr-login-desktop.entrypoints=websecure"
    - "traefik.http.routers.ibkr-login-desktop.tls.certresolver=le"
    - "traefik.http.services.ibkr-login-desktop.loadbalancer.server.port=6080"
    - "traefik.http.middlewares.ibkr-login-desktop-stripprefix.stripPrefix.prefixes=/ibkr-login"
    - "traefik.http.routers.ibkr-login-desktop.middlewares=ibkr-login-desktop-stripprefix,cors-default@docker,auth-forward@docker"
```

**Nota su `network_mode` e Traefik**: quando un container usa `network_mode: "service:ibkrgw-paper"`, non ha una propria interfaccia sulla `trading_net`. Traefik scopre i container tramite la rete Docker — questo significa che `traefik.enable=true` potrebbe non funzionare se il container non è direttamente sulla `trading_net`.

**Soluzione**: usare un secondo container `ibkr-login-desktop-proxy` (nginx o socat minimale) su `trading_net` che fa forward alla porta 6080 di `ibkr-login-desktop`. Oppure, più semplicemente, esporre la porta 6080 sul host del server e configurare Traefik con `server.url` invece di service discovery.

Questo è il punto tecnico più delicato dell'implementazione e va verificato nella fase di setup Docker.

---

## Sicurezza

Il servizio espone uno schermo interattivo su internet. Misure di protezione:

| Misura | Implementazione |
|---|---|
| **Auth trading system** | Traefik ForwardAuth (`auth-forward@docker`) — solo utenti loggati nel sistema possono accedere |
| **Password VNC opzionale** | `x11vnc -passwd <pwd>` — aggiunge un secondo livello se ForwardAuth non è sufficiente |
| **HTTPS** | Traefik gestisce il certificato Let's Encrypt |
| **Nessuna esposizione diretta** | La porta 6080 non è mappata sul host, passa solo via Traefik |
| **Sessione condivisa** | noVNC mostra la stessa sessione a tutti gli utenti autenticati — adeguato perché è un tool di admin |

---

## Modifica al frontend (astraai)

Il tasto Connect semplicemente apre la tab su noVNC invece di `localhost:5000`:

```javascript
// Prima:
window.open('https://localhost:5000', '_blank');

// Dopo:
window.open('https://trading.expovin.it/ibkr-login/vnc.html?autoconnect=1&resize=scale', '_blank');
```

Nessun token, nessuna chiamata aggiuntiva — ForwardAuth su Traefik gestisce l'autenticazione.

---

## Prerequisiti (ordine di priorità)

1. **[BLOCCO]** Creare il Dockerfile + `entrypoint.sh` per `ibkr-login-desktop`
2. **[BLOCCO]** Verificare la compatibilità `network_mode: "service:ibkrgw-paper"` con Traefik service discovery (potrebbe richiedere il container proxy intermedio)
3. **[BLOCCO]** Aggiungere `IBKRLOGINDESKTOP_VERSION` in GitHub Actions (ambiente PAPER e LIVE)
4. **[MINORE]** Aggiungere `ibkr-login-desktop` al flag `service_flags` DB per l'ambiente PAPER
5. **[MINORE]** Modificare tasto Connect nel frontend astraai

---

## Riepilogo effort stimato

```
ibkr-login-desktop (nuovo container)
  ├── Dockerfile                    ~20 righe
  └── entrypoint.sh                 ~25 righe

docker-compose.paper.yml + live.yml
  └── aggiungere il servizio        ~20 righe per compose

.github/workflows/deploy.yml
  └── aggiungere alla lista build + IBKRLOGINDESKTOP_VERSION

astraai frontend
  └── modifica tasto Connect        ~2 righe
```

Nessuna modifica agli altri microservizi Node.js. Nessuna dipendenza da librerie del progetto.
