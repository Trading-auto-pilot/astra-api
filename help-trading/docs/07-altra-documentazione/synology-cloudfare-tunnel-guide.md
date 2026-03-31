---
sidebar_position: 1
title: Synology Cloudfare tunnel guide
---

# Cloudflare Tunnel su Synology DS423 — Guida completa

> Obiettivo: esporre i servizi del NAS Synology DS423 su sottodomini
> del tuo dominio personale, senza aprire porte sul router, senza IP
> fisso, con HTTPS automatico. Tutto gratuito con il piano Free di
> Cloudflare.

---

## Indice

1. [Prerequisiti](#1-prerequisiti)
2. [Architettura](#2-architettura)
3. [Step 1 — Creare il tunnel su Cloudflare](#3-step-1--creare-il-tunnel-su-cloudflare)
4. [Step 2 — Installare Container Manager sul DS423](#4-step-2--installare-container-manager-sul-ds423)
5. [Step 3 — Avviare cloudflared sul DS423](#5-step-3--avviare-cloudflared-sul-ds423)
6. [Step 4 — Esporre i servizi come sottodomini](#6-step-4--esporre-i-servizi-come-sottodomini)
7. [Riferimento: tutti i servizi Synology e le loro porte](#7-riferimento-tutti-i-servizi-synology-e-le-loro-porte)
8. [Step 5 — Protezione con Cloudflare Access (opzionale)](#8-step-5--protezione-con-cloudflare-access-opzionale)
9. [Aggiornare cloudflared](#9-aggiornare-cloudflared)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisiti

| Cosa | Stato | Note |
|------|-------|------|
| Synology DS423 | ✅ | DSM 7.2 o superiore consigliato |
| Account Cloudflare | ✅ | Piano Free sufficiente |
| Dominio su Cloudflare | ✅ | Nameserver già puntati a Cloudflare |
| Container Manager | Da installare allo Step 2 | |

**Verificare la versione DSM:**
DSM → Pannello di controllo → Aggiornamento e ripristino → versione corrente.
Se inferiore a 7.2, aggiornare prima di procedere.

---

## 2. Architettura

```
Internet
  │
  └─ tuodominio.com (Cloudflare)
       │
       ├─ nas.tuodominio.com       → DSM principale    :5000
       ├─ drive.tuodominio.com     → Synology Drive    :5000/path
       ├─ photos.tuodominio.com    → Synology Photos   :5000/path
       ├─ plex.tuodominio.com      → Plex Media Server :32400
       └─ ...altri servizi...

Cloudflare riceve le richieste HTTPS
  └─ le passa al tunnel attivo sul DS423
       └─ cloudflared (container Docker sul DS423)
            └─ instrada verso il servizio locale corretto
```

**Come funziona il tunnel:**
- Il DS423 avvia un container `cloudflared` che apre una connessione
  **uscente** verso Cloudflare
- Non serve aprire porte sul router
- Non serve IP pubblico fisso
- Cloudflare riceve le richieste HTTPS e le passa al tunnel
- Il tunnel le consegna al servizio locale sulla porta corretta
- Tutto il traffico è cifrato end-to-end

---

## 3. Step 1 — Creare il tunnel su Cloudflare

Questa operazione si fa **una volta sola** dalla dashboard Cloudflare.

### 3.1 Accedere a Zero Trust

```
Cloudflare Dashboard → Zero Trust (menu a sinistra)
→ Al primo accesso: scegli un nome per il tuo team (es. "vincenzo")
  e seleziona il piano Free → Proceed
```

### 3.2 Creare il tunnel

```
Zero Trust → Networks → Tunnels → Create a tunnel
→ Connector type: Cloudflared → Next
→ Tunnel name: synology-nas → Save tunnel
→ Nella schermata "Install connector":
     scegli "Docker" come environment
     vedrai un comando tipo:
     docker run ... --token eyJhGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...
→ COPIA IL TOKEN (la stringa lunga dopo --token)
→ Salvalo — ti servirà allo Step 3
```

Il tunnel appare come "Inactive" finché non viene avviato il container.

---

## 4. Step 2 — Installare Container Manager sul DS423

### 4.1 Aprire Package Center

```
DSM → Package Center → cerca "Container Manager" → Installa
```

Se non compare nella ricerca:
```
Package Center → Impostazioni → Sorgenti pacchetti
→ verifica che "Synology" sia abilitato come sorgente
```

### 4.2 Accettare i termini

Al primo avvio di Container Manager viene chiesto di accettare i
termini d'uso di Docker Hub — accettare per abilitare il download
delle immagini.

---

## 5. Step 3 — Avviare cloudflared sul DS423

Ci sono due metodi. Il Metodo A (docker-compose) è consigliato perché
il container si avvia automaticamente al boot del NAS.

### Metodo A — docker-compose tramite Container Manager (consigliato)

**1. Creare la cartella di configurazione**

```
DSM → File Station → docker → crea cartella "cloudflared"
```

**2. Creare il file docker-compose.yml**

Aprire un editor di testo (es. Text Editor dal Package Center) e
salvare il file in `/docker/cloudflared/docker-compose.yml`:

```yaml
version: "3"
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: cloudflared
    restart: always
    command: tunnel --no-autoupdate run --token IL_TUO_TOKEN_QUI
    network_mode: host
```

Sostituire `IL_TUO_TOKEN_QUI` con il token copiato allo Step 1.

**3. Avviare il progetto**

```
Container Manager → Project → Create
→ Project name: cloudflared
→ Path: /docker/cloudflared
→ (Container Manager legge automaticamente il docker-compose.yml)
→ Next → Done
```

Il container si avvia. Dopo 5-10 secondi su Cloudflare il tunnel
passa da "Inactive" a **"Active"** (punto verde).

---

### Metodo B — Container singolo tramite GUI

```
Container Manager → Container → Create
→ cerca immagine: cloudflare/cloudflared → Download (tag: latest)
→ Container name: cloudflared
→ Enable auto-restart: ✅
→ Advanced settings → Command:
     tunnel --no-autoupdate run --token IL_TUO_TOKEN_QUI
→ Network: host
→ Done → Run
```

---

### Verifica

```
Cloudflare Dashboard → Zero Trust → Networks → Tunnels → synology-nas
→ Status: Active ✅ (punto verde)
```

Se rimane Inactive dopo 30 secondi controllare i log del container:
```
Container Manager → Container → cloudflared → Log
```

---

## 6. Step 4 — Esporre i servizi come sottodomini

Ora si configurano i hostname pubblici — uno per ogni servizio da
esporre. Tutta la configurazione è su Cloudflare, il DS423 non
richiede modifiche.

```
Zero Trust → Networks → Tunnels → synology-nas
→ Configure → Public Hostnames → Add a public hostname
```

Per ogni servizio compilare:
- **Subdomain**: il nome del sottodominio
- **Domain**: il tuo dominio
- **Type**: quasi sempre HTTP o HTTPS
- **URL**: `localhost:PORTA` (indirizzo locale del servizio sul NAS)

---

### 6.1 DSM — Interfaccia principale

```
Subdomain:  nas
Domain:     tuodominio.com
Type:       HTTP
URL:        localhost:5000
```

Accesso: `https://nas.tuodominio.com`

**Nota importante per DSM:** Synology DSM reindirizza automaticamente
da HTTP a HTTPS. Per evitare loop di redirect aggiungere in
"Additional application settings" → HTTP Host header: `localhost:5000`

---

### 6.2 Synology Drive

```
Subdomain:  drive
Domain:     tuodominio.com
Type:       HTTP
URL:        localhost:5000
```

Accesso: `https://drive.tuodominio.com`

Synology Drive usa la stessa porta di DSM (5000). Cloudflare instrada
le richieste in base al sottodominio e DSM smista internamente verso
l'applicazione corretta.

---

### 6.3 Synology Photos

```
Subdomain:  photos
Domain:     tuodominio.com
Type:       HTTP
URL:        localhost:5000
```

Accesso: `https://photos.tuodominio.com`

Stessa logica di Drive — porta 5000, DSM smista.

---

### 6.4 Plex Media Server

```
Subdomain:  plex
Domain:     tuodominio.com
Type:       HTTP
URL:        localhost:32400
```

Accesso: `https://plex.tuodominio.com`

**Configurazione aggiuntiva su Plex:**
```
Plex → Settings → Remote Access → disabilita "Enable Remote Access"
(non serve più — l'accesso esterno è gestito dal tunnel)

Plex → Settings → Network → Custom server access URLs:
aggiungere: https://plex.tuodominio.com
```

---

### 6.5 Synology Note Station

```
Subdomain:  notes
Domain:     tuodominio.com
Type:       HTTP
URL:        localhost:5000
```

---

### 6.6 Synology Chat

```
Subdomain:  chat
Domain:     tuodominio.com
Type:       HTTP
URL:        localhost:5000
```

---

### 6.7 Surveillance Station

```
Subdomain:  camera
Domain:     tuodominio.com
Type:       HTTP
URL:        localhost:5000
```

---

### 6.8 Download Station

```
Subdomain:  download
Domain:     tuodominio.com
Type:       HTTP
URL:        localhost:5000
```

---

### 6.9 SSH (accesso terminale remoto)

```
Subdomain:  ssh
Domain:     tuodominio.com
Type:       SSH
URL:        localhost:22
```

Accesso da terminale (richiede cloudflared installato anche sul client):
```bash
# Installa cloudflared sul Mac
brew install cloudflare/cloudflare/cloudflared

# Connetti via SSH attraverso il tunnel
ssh -o ProxyCommand="cloudflared access ssh --hostname ssh.tuodominio.com" \
    utente@ssh.tuodominio.com
```

Oppure aggiungi a `~/.ssh/config`:
```
Host ssh.tuodominio.com
    ProxyCommand cloudflared access ssh --hostname %h
```

Poi semplicemente: `ssh utente@ssh.tuodominio.com`

---

### 6.10 Qualsiasi container Docker sul NAS

Per ogni container aggiuntivo che gira sul NAS basta aggiungere
un hostname con la porta del container:

Esempio — Home Assistant sulla porta 8123:
```
Subdomain:  homeassistant
Domain:     tuodominio.com
Type:       HTTP
URL:        localhost:8123
```

Esempio — Portainer sulla porta 9000:
```
Subdomain:  portainer
Domain:     tuodominio.com
Type:       HTTP
URL:        localhost:9000
```

---

## 7. Riferimento: tutti i servizi Synology e le loro porte

| Servizio | Porta HTTP | Porta HTTPS | Note |
|---------|-----------|-------------|------|
| DSM (interfaccia principale) | 5000 | 5001 | |
| Synology Drive | 5000 | 5001 | Stesso DSM |
| Synology Photos | 5000 | 5001 | Stesso DSM |
| Note Station | 5000 | 5001 | Stesso DSM |
| Chat | 5000 | 5001 | Stesso DSM |
| Surveillance Station | 5000 | 5001 | Stesso DSM |
| Download Station | 5000 | 5001 | Stesso DSM |
| Audio Station | 5000 | 5001 | Stesso DSM |
| Video Station | 5000 | 5001 | Stesso DSM |
| Plex Media Server | 32400 | 32400 | Porta dedicata |
| Jellyfin | 8096 | 8920 | Se installato |
| Home Assistant | 8123 | 8123 | Se installato |
| Portainer | 9000 | 9443 | Se installato |
| SSH | 22 | — | Tipo SSH nel tunnel |
| WebDAV | 5005 | 5006 | Synology WebDAV |
| CalDAV/CardDAV | 5000 | 5001 | Tramite DSM |

**Nota:** la maggior parte dei servizi nativi Synology gira dietro
lo stesso DSM sulla porta 5000. Cloudflare indirizza le richieste
in base al sottodominio e DSM smista internamente verso l'applicazione
corretta in base al path dell'URL.

---

## 8. Step 5 — Protezione con Cloudflare Access (opzionale)

Per default i servizi esposti tramite tunnel sono raggiungibili da
chiunque conosca l'URL. DSM ha la propria autenticazione, ma per
un layer di protezione aggiuntivo si può configurare Cloudflare Access
che richiede autenticazione prima ancora di raggiungere il NAS.

### Configurazione base con email OTP

```
Zero Trust → Access → Applications → Add an application
→ Self-hosted
→ Application name: Synology NAS
→ Application domain: nas.tuodominio.com
→ Next
→ Policy name: Personal access
→ Action: Allow
→ Include: Emails → inserisci la tua email
→ Next → Add application
```

Con questa configurazione, prima di raggiungere `nas.tuodominio.com`
Cloudflare mostra una pagina di login e manda un OTP via email.
Utile se si vuole evitare che il login DSM sia esposto direttamente.

### Escludere l'autenticazione per app specifiche

Alcune app (es. Synology Drive client desktop, Plex) non supportano
il flusso OAuth di Cloudflare Access. Per queste si può:

1. Creare una policy separata per quel sottodominio senza Access
2. Usare un Service Token per le app che supportano header personalizzati
3. Lasciare il sottodominio senza Access e affidarsi all'autenticazione
   nativa dell'applicazione

Per uso personale con accesso solo tuo, Access è opzionale — la
protezione dell'app sottostante (DSM, Plex, ecc.) è già sufficiente.

---

## 9. Aggiornare cloudflared

Cloudflare rilascia aggiornamenti regolari. Con il metodo docker-compose
l'aggiornamento richiede due operazioni:

```
Container Manager → Project → cloudflared
→ Action → Pull and restart
```

Oppure da SSH sul NAS:
```bash
cd /volume1/docker/cloudflared
docker compose pull
docker compose up -d
```

Per verificare la versione corrente:
```bash
docker exec cloudflared cloudflared --version
```

---

## 10. Troubleshooting

### Tunnel rimane Inactive

```
Container Manager → Container → cloudflared → Log
```

Errori comuni:
- `Invalid token` — token copiato in modo incompleto. Ricopiarlo da
  Cloudflare → Zero Trust → Tunnels → synology-nas → Configure →
  tasto "..." → Token
- `Error connecting to Cloudflare` — problema di rete. Verificare
  che il DS423 abbia accesso a internet

---

### Sottodominio non raggiungibile (502 Bad Gateway)

Significa che il tunnel è attivo ma non riesce a raggiungere il
servizio locale. Verificare:

1. La porta è corretta (vedi tabella sezione 7)
2. Il servizio è avviato sul NAS
3. Il servizio risponde localmente:
   ```bash
   # Da SSH sul NAS
   curl -I http://localhost:5000
   # Deve rispondere con HTTP 200 o 302
   ```

---

### DSM mostra loop di redirect

DSM reindirizza HTTP → HTTPS internamente, creando conflitti con il
tunnel. Soluzione:

```
Zero Trust → Tunnels → synology-nas → Configure
→ Public Hostnames → nas.tuodominio.com → Edit
→ Additional application settings
→ HTTP Host Header: localhost:5000
→ Disable chunked encoding: ✅
```

Oppure usare Type: `HTTPS` con `URL: localhost:5001` e spuntare
"No TLS Verify" (perché il certificato locale è self-signed).

---

### Plex non funziona correttamente

Plex ha logiche di autenticazione proprie che possono confliggere
con il tunnel. Soluzioni:

1. In Plex → Settings → Network → aggiungere
   `https://plex.tuodominio.com` in "Custom server access URLs"
2. Disabilitare "Relay" in Plex → Settings → Remote Access
3. Se il tunnel causa problemi con lo streaming, usare l'app Plex
   direttamente (ha il suo sistema di tunnel integrato)

---

### Synology Drive client desktop non si connette

Il client desktop Synology Drive non supporta Cloudflare Access.
Soluzioni:
- Non abilitare Access per `drive.tuodominio.com`
- Usare l'accesso web dal browser (funziona sempre)
- Configurare il client puntando direttamente all'URL del tunnel
  senza Access

---

### Verificare che il tunnel stia instradando correttamente

```bash
# Da qualsiasi browser o terminale con internet
curl -I https://nas.tuodominio.com
# Header "CF-Ray" nella risposta conferma che passa per Cloudflare
# HTTP 200 o 302 = servizio raggiungibile
# HTTP 502 = tunnel attivo ma servizio locale non risponde
# Timeout = tunnel non attivo (VM/NAS spento)
```

---

## Riepilogo finale

| Sottodominio | Servizio | URL locale |
|-------------|---------|-----------|
| `nas.tuodominio.com` | DSM | `localhost:5000` |
| `drive.tuodominio.com` | Synology Drive | `localhost:5000` |
| `photos.tuodominio.com` | Synology Photos | `localhost:5000` |
| `plex.tuodominio.com` | Plex | `localhost:32400` |
| `ssh.tuodominio.com` | SSH | `localhost:22` (tipo SSH) |
| `download.tuodominio.com` | Download Station | `localhost:5000` |

Ogni nuovo servizio che installi sul NAS richiede solo di aggiungere
un hostname in Cloudflare — nessuna modifica al router o al NAS.
