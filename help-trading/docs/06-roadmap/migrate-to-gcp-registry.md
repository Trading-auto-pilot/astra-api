---
sidebar_position: 8
title: Migrate to GCP Registry
---

# Migrazione Docker Hub → GCP Artifact Registry

> **Documento operativo** — generato il 26 marzo 2026  
> Descrive tutti i passi necessari per migrare il registry delle immagini Docker  
> da Docker Hub (piano gratuito) a GCP Artifact Registry.  
> Il workflow GitHub Actions aggiornato è in `deploy.yml`.

---

## Indice

1. [Perché migrare](#1-perché-migrare)
2. [Prerequisiti](#2-prerequisiti)
3. [Setup GCP — una tantum](#3-setup-gcp--una-tantum)
4. [Configurare la VM principale](#4-configurare-la-vm-principale)
5. [Configurare GitHub Actions](#5-configurare-github-actions)
6. [Migrare le immagini esistenti](#6-migrare-le-immagini-esistenti)
7. [Aggiornare i docker-compose](#7-aggiornare-i-docker-compose)
8. [Verifica finale](#8-verifica-finale)
9. [Rollback](#9-rollback)
10. [Note operative](#10-note-operative)

---

## 1. Perché migrare

| Problema con Docker Hub free | Soluzione con Artifact Registry |
|---|---|
| 1 solo repository privato | Repository privati illimitati |
| 100 pull/ora rate limit (authenticated) | Nessun rate limit dalla rete GCP |
| Pull della spot instance passano da internet | Pull gratuiti sulla rete interna GCP |
| Credenziali da gestire e ruotare | Autenticazione via Service Account IAM |
| Costo $9/mese per piano Pro | Solo storage (~pochi cent/mese per qualche GB) |

---

## 2. Prerequisiti

- Account GCP con billing attivo
- `gcloud` CLI installata e autenticata localmente
- Accesso admin al progetto GCP
- Accesso admin al repository GitHub
- Variabili `GCP_PROJECT_ID` e `PROJECT_NUMBER` a portata di mano

```bash
# Recupera i valori necessari
gcloud config get-value project
# → es. trading-system-123456  (questo è GCP_PROJECT_ID)

gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)"
# → es. 987654321098  (questo è PROJECT_NUMBER)
```

---

## 3. Setup GCP — una tantum

Tutti i comandi vanno eseguiti **una sola volta** dal tuo ambiente locale con `gcloud` autenticato.

Sostituisci le variabili prima di eseguire:

```bash
PROJECT_ID="trading-system-123456"      # il tuo GCP project ID
PROJECT_NUMBER="987654321098"           # il tuo GCP project number
REGION="us-central1"                    # regione del registry (stessa delle VM)
REPO_NAME="trading"                     # nome del repository Artifact Registry
GITHUB_USER="vincenzo"                  # il tuo username GitHub
GITHUB_REPO="trading-system"           # il nome del repo GitHub (monorepo)
SA_NAME="github-actions-ci"             # nome del service account CI
```

### 3.1 Abilita le API necessarie

```bash
gcloud services enable \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  --project=$PROJECT_ID
```

### 3.2 Crea il repository Artifact Registry

```bash
gcloud artifacts repositories create $REPO_NAME \
  --repository-format=docker \
  --location=$REGION \
  --description="Trading system Docker images" \
  --project=$PROJECT_ID

# Verifica
gcloud artifacts repositories list --location=$REGION --project=$PROJECT_ID
```

L'URL del registry sarà: `${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}`  
Esempio: `us-central1-docker.pkg.dev/trading-system-123456/trading`

### 3.3 Crea il Service Account per GitHub Actions CI

```bash
gcloud iam service-accounts create $SA_NAME \
  --display-name="GitHub Actions CI" \
  --description="Usato dalla CI per build e push immagini su Artifact Registry" \
  --project=$PROJECT_ID

# Verifica
gcloud iam service-accounts list --project=$PROJECT_ID
```

### 3.4 Assegna i permessi al Service Account CI

```bash
# Permesso di scrivere immagini sul registry (push)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"
```

### 3.5 Configura Workload Identity Federation

Permette a GitHub Actions di autenticarsi su GCP senza service account key files.

```bash
# Crea il pool WIF
gcloud iam workload-identity-pools create "github-pool" \
  --location="global" \
  --display-name="GitHub Actions pool" \
  --project=$PROJECT_ID

# Crea il provider OIDC nel pool
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub provider" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='${GITHUB_USER}/${GITHUB_REPO}'" \
  --project=$PROJECT_ID
```

### 3.6 Lega il Service Account al pool WIF

```bash
gcloud iam service-accounts add-iam-policy-binding \
  "${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/${GITHUB_USER}/${GITHUB_REPO}" \
  --project=$PROJECT_ID
```

### 3.7 Recupera i valori per i GitHub Secrets

```bash
# GCP_WIF_PROVIDER — da inserire nei GitHub Secrets
echo "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/providers/github-provider"

# GCP_SA_EMAIL — da inserire nei GitHub Secrets
echo "${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
```

---

## 4. Configurare la VM principale

La VM GCP usa il suo Service Account per pullare le immagini — nessuna credenziale Docker Hub necessaria. Questi comandi vanno eseguiti **sulla VM principale** (PAPER e LIVE).

### 4.1 Verifica che il Service Account della VM abbia accesso al registry

```bash
# Dalla tua macchina locale — trova il SA della VM
VM_NAME="nome-della-tua-vm"
VM_ZONE="us-central1-a"

gcloud compute instances describe $VM_NAME \
  --zone=$VM_ZONE \
  --format="value(serviceAccounts[0].email)"
# → es. 123456789-compute@developer.gserviceaccount.com
```

```bash
# Assegna il permesso di lettura al SA della VM
VM_SA="123456789-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${VM_SA}" \
  --role="roles/artifactregistry.reader"
```

### 4.2 Configura Docker sulla VM per usare Artifact Registry

```bash
# SSH sulla VM e lancia questo comando una volta
gcloud compute ssh $VM_NAME --zone=$VM_ZONE -- \
  "gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet"

# Verifica che sia stato scritto in ~/.docker/config.json
gcloud compute ssh $VM_NAME --zone=$VM_ZONE -- \
  "cat ~/.docker/config.json | grep ${REGION}"
```

### 4.3 Test pull dalla VM

```bash
# SSH sulla VM e testa un pull dal registry
gcloud compute ssh $VM_NAME --zone=$VM_ZONE -- \
  "docker pull ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/decision-engine:latest"
# Deve funzionare senza docker login
```

---

## 5. Configurare GitHub Actions

### 5.1 Aggiungi i Secrets in GitHub

Vai su: **GitHub → Repository → Settings → Secrets and variables → Actions → Secrets**

Aggiungi i seguenti secret (validi per tutti gli environment):

| Secret | Valore | Note |
|---|---|---|
| `GCP_WIF_PROVIDER` | `projects/987654321098/locations/global/workloadIdentityPools/github-pool/providers/github-provider` | Recuperato al §3.7 |
| `GCP_SA_EMAIL` | `github-actions-ci@trading-system-123456.iam.gserviceaccount.com` | Recuperato al §3.7 |

**Rimuovi** (dopo aver verificato che tutto funzioni):
- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

### 5.2 Aggiungi le Variables negli Environment

Vai su: **GitHub → Repository → Settings → Environments → PAPER (e poi LIVE)**  
Aggiungi per **entrambi** gli environment:

| Variable | Valore esempio | Descrizione |
|---|---|---|
| `GCP_PROJECT_ID` | `trading-system-123456` | Il tuo GCP project ID |
| `GCP_REGISTRY_REGION` | `us-central1` | Regione del registry |
| `GCP_REGISTRY_REPO` | `trading` | Nome del repository in Artifact Registry |

### 5.3 Sostituisci il workflow

Copia il file `deploy.yml` aggiornato in `.github/workflows/deploy.yml` nel repository.

Le modifiche rispetto alla versione precedente sono:

- Rimosso: step `Login to DockerHub` con `docker/login-action`
- Aggiunto: step `Authenticate to Google Cloud` con `google-github-actions/auth`
- Aggiunto: step `Configure Docker for Artifact Registry` con `gcloud auth configure-docker`
- Modificato: prefisso immagini da `$DOCKERHUB_USERNAME/name` a `$REGISTRY/$GCP_PROJECT_ID/$REPO_NAME/name`
- Modificato: cache buildx da Docker Hub a Artifact Registry
- Modificato: build IBKR sul server — rimosso `docker login`, usa SA della VM
- Aggiunto: `REGISTRY_PREFIX` nel `.env` generato e nella validation

---

## 6. Migrare le immagini esistenti

Le immagini già presenti su Docker Hub vanno copiate su Artifact Registry **prima** di switchare la pipeline. In questo modo non c'è downtime.

```bash
REGISTRY_PREFIX="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}"
DOCKERHUB_USER="expovin"   # il tuo username Docker Hub

# Lista dei servizi da migrare
services=(
  cachemanager
  alertingservice
  scheduler
  tickerscanner
  authservice
  astraai-frontend
  servicecontrolplane
  ibkr-bridge
  decision-engine
  ibkr-keepalive
  market-data-service
  redis-ws-bridge
  liquidity-manager
  broker-executor-ibkr
  datahub
  mcp-gateway
  capital-manager
  help-trading
  ibkr-login-desktop
  market-simulator
  ibkr-clientportal
)

# Configura docker locale per Artifact Registry
gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet

for service in "${services[@]}"; do
  echo "🔄 Migrazione $service..."

  # Pull da Docker Hub
  docker pull ${DOCKERHUB_USER}/${service}:latest || {
    echo "⚠️  $service non trovato su Docker Hub, skip"
    continue
  }

  # Retag per Artifact Registry
  docker tag ${DOCKERHUB_USER}/${service}:latest \
    ${REGISTRY_PREFIX}/${service}:latest

  # Push su Artifact Registry
  docker push ${REGISTRY_PREFIX}/${service}:latest

  echo "✅ $service migrato"
done

echo "🎉 Migrazione completata"
```

> **Nota:** le versioni specifiche (es. `:1.2.3`) vengono rigenerate automaticamente al primo push della pipeline aggiornata. Non è necessario migrare ogni tag di versione — solo `:latest` per garantire che la VM possa fare il pull immediatamente.

---

## 7. Aggiornare i docker-compose

I file `docker-compose.paper.yml` e `docker-compose.live.yml` usano oggi immagini del tipo:

```yaml
image: expovin/decision-engine:${DECISIONENGINE_VERSION}
```

Vanno aggiornati per usare `REGISTRY_PREFIX`:

```yaml
image: ${REGISTRY_PREFIX}/decision-engine:${DECISIONENGINE_VERSION}
```

La variabile `REGISTRY_PREFIX` viene iniettata nel `.env` dalla pipeline aggiornata:

```
REGISTRY_PREFIX=us-central1-docker.pkg.dev/trading-system-123456/trading
```

### Script di aggiornamento automatico

```bash
# Esegui nella root del monorepo
DOCKERHUB_USER="expovin"
REGISTRY_PREFIX="us-central1-docker.pkg.dev/trading-system-123456/trading"

for compose_file in docker-compose.*.yml; do
  echo "📝 Aggiorno $compose_file..."
  sed -i "s|image: ${DOCKERHUB_USER}/|image: \${REGISTRY_PREFIX}/|g" "$compose_file"
  echo "✅ $compose_file aggiornato"
done
```

Dopo l'aggiornamento verifica che i file siano corretti:

```bash
grep "image:" docker-compose.paper.yml | head -20
# Deve mostrare: image: ${REGISTRY_PREFIX}/nome-servizio:${VERSION}
```

---

## 8. Verifica finale

### 8.1 Test in locale

```bash
# Configura docker per il registry
gcloud auth configure-docker us-central1-docker.pkg.dev --quiet

# Lista le immagini nel registry
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME} \
  --include-tags

# Testa un pull
docker pull us-central1-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/decision-engine:latest
```

### 8.2 Test pipeline

1. Fai un piccolo commit su branch `PAPER` (es. aggiorna un `release.json`)
2. Verifica che la pipeline GitHub Actions completi senza errori
3. Controlla nel GCP Console → Artifact Registry che le immagini siano state pushate
4. Verifica che la VM abbia eseguito il pull correttamente dai log della pipeline

### 8.3 Checklist pre-go-live

```
□ Repository Artifact Registry creato e raggiungibile
□ Service Account CI con ruolo artifactregistry.writer
□ Workload Identity Federation configurato e testato
□ VM principale configurata con gcloud auth configure-docker
□ SA della VM con ruolo artifactregistry.reader
□ GitHub Secrets GCP_WIF_PROVIDER e GCP_SA_EMAIL aggiunti
□ GitHub Variables GCP_PROJECT_ID, GCP_REGISTRY_REGION, GCP_REGISTRY_REPO aggiunti
□ Immagini esistenti migrate da Docker Hub
□ docker-compose aggiornati con REGISTRY_PREFIX
□ Pipeline testata su PAPER con successo
□ VM pull verificato senza docker login
```

---

## 9. Rollback

Se qualcosa va storto è possibile tornare a Docker Hub ripristinando tre cose:

```bash
# 1. Ripristina il workflow originale
git checkout <commit-prima-della-migrazione> -- .github/workflows/deploy.yml
git commit -m "revert: rollback a Docker Hub"
git push

# 2. Ripristina i docker-compose
git checkout <commit-prima-della-migrazione> -- docker-compose.paper.yml docker-compose.live.yml
git commit -m "revert: ripristina docker-compose con Docker Hub"
git push

# 3. Sulla VM — torna a docker login Docker Hub
ssh $GCP_USER@$GCP_HOST
docker login -u $DOCKERHUB_USERNAME --password-stdin <<< $DOCKERHUB_TOKEN
```

---

## 10. Note operative

**Rate limit sulla spot instance.** Con Artifact Registry nella stessa regione GCP delle spot instance, i pull sono sulla rete interna — zero costo e zero rate limit. Ogni startup script che fa `docker pull` di 4-5 immagini funziona senza rischi.

**Costo Artifact Registry.** Lo storage costa circa $0.10/GB/mese. Con immagini Node.js tipicamente da 200-400 MB compressi, per 20 microservizi con 3-4 tag ciascuno (latest, versione corrente, versione precedente, cache) si parla di ~10-15 GB → circa $1-1.5/mese. Zero costi di pull dalla rete interna GCP.

**Cache buildx.** Il tag `:cache` usato dalla pipeline per la cache buildx non è un'immagine eseguibile — è un layer cache di buildkit. Non conta verso i limiti di versione e può essere pulito periodicamente con `gcloud artifacts docker images delete`.

**Artifact Registry per le spot instance.** Quando verrà implementata la spot instance per le simulazioni, il pull delle immagini `:SIMUL` avverrà automaticamente senza nessuna configurazione aggiuntiva — la VM spot eredita il Service Account GCP con accesso al registry, esattamente come la VM principale.

**Pulizia immagini vecchie.** Configurare una cleanup policy su Artifact Registry per rimuovere automaticamente i tag più vecchi di N giorni (esclusi `latest` e `SIMUL`):

```bash
gcloud artifacts repositories set-cleanup-policies $REPO_NAME \
  --location=$REGION \
  --policy='{
    "name": "keep-last-10-versions",
    "action": {"type": "Delete"},
    "condition": {
      "tagState": "TAGGED",
      "olderThan": "90d",
      "tagPrefixes": ["0.", "1.", "2."]
    }
  }'
```

**Monitoring.** I pull e i push su Artifact Registry sono visibili in GCP Console → Artifact Registry → Repository → immagine → History. Utile per debug se un deploy non trova l'immagine.

---

## 11. File `deploy.yml` riscritto

File completo da copiare in `.github/workflows/deploy.yml` nel repository.

Rispetto alla versione precedente con Docker Hub:
- Rimosso lo step `Login to DockerHub` — sostituito con `Authenticate to Google Cloud` via Workload Identity Federation (nessuna chiave JSON)
- Aggiunto `Configure Docker for Artifact Registry` con `gcloud auth configure-docker`
- Prefisso immagini cambiato da `$DOCKERHUB_USERNAME/name` a `$REGISTRY/$GCP_PROJECT_ID/$REPO_NAME/name`
- Cache buildx spostata da Docker Hub ad Artifact Registry
- Build IBKR sul server: rimosso `docker login`, la VM usa il suo Service Account GCP
- `REGISTRY_PREFIX` aggiunto nel `.env` generato e nella validation

```yaml
name: CI/CD for PAPER/LIVE Branch

on:
  push:
    branches:
      - PAPER
      - LIVE

env:
  # ── GCP Artifact Registry ──────────────────────────────────────────────────
  # Sostituisce DOCKERHUB_USERNAME / DOCKERHUB_TOKEN
  # Configura in GitHub → Settings → Environments → PAPER/LIVE → Variables:
  #   GCP_PROJECT_ID      es. trading-system-123456
  #   GCP_REGISTRY_REGION es. us-central1
  #   GCP_REGISTRY_REPO   es. trading
  # Configura in Secrets:
  #   GCP_WIF_PROVIDER    es. projects/123/locations/global/workloadIdentityPools/github-pool/providers/github-provider
  #   GCP_SA_EMAIL        es. github-actions-ci@trading-system-123456.iam.gserviceaccount.com
  # ──────────────────────────────────────────────────────────────────────────
  GCP_PROJECT_ID:      ${{ vars.GCP_PROJECT_ID }}
  GCP_REGISTRY_REGION: ${{ vars.GCP_REGISTRY_REGION }}
  GCP_REGISTRY_REPO:   ${{ vars.GCP_REGISTRY_REPO }}
  REGISTRY:            ${{ vars.GCP_REGISTRY_REGION }}-docker.pkg.dev

  # Variabili infrastruttura — invariate
  GCP_HOST:            ${{ secrets.GCP_HOST }}
  GCP_USER:            ${{ secrets.GCP_USER }}
  GH_TOKEN:            ${{ secrets.GH_TOKEN }}
  SKIP_PUSH:           false
  CREATE_RELEASE:      true

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment: ${{ github.ref_name }}

    # Permessi necessari per Workload Identity Federation (niente chiavi JSON)
    permissions:
      contents:      read
      id-token:      write
      pull-requests: read

    steps:
    - name: Checkout repository
      uses: actions/checkout@v4
      with:
        clean:       true
        fetch-depth: 2   # fetch-depth: 2 necessario per git diff nella detection servizi

    - name: Set up Node.js
      uses: actions/setup-node@v4
      with:
        node-version:          '20'
        cache:                 'npm'
        cache-dependency-path: help-trading/package-lock.json

    - name: Build help-trading documentation
      run: |
        cd help-trading
        npm ci
        npm run build
        echo "✅ help-trading build completata"

    - name: Set up Docker Buildx
      uses: docker/setup-buildx-action@v3

    # ── AUTENTICAZIONE GCP ────────────────────────────────────────────────────
    # Sostituisce: docker/login-action con DOCKERHUB_USERNAME / DOCKERHUB_TOKEN
    # Usa Workload Identity Federation — niente service account key files
    - name: Authenticate to Google Cloud
      id: auth
      uses: google-github-actions/auth@v2
      with:
        workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
        service_account:            ${{ secrets.GCP_SA_EMAIL }}

    - name: Configure Docker for Artifact Registry
      run: |
        gcloud auth configure-docker ${{ env.REGISTRY }} --quiet
        echo "✅ Docker configurato per ${{ env.REGISTRY }}"

    # ─────────────────────────────────────────────────────────────────────────

    - name: 🚦 Verifica modalità di deploy su LIVE
      run: |
        BRANCH_NAME="${{ github.ref_name }}"
        EVENT_NAME="${{ github.event_name }}"
        SOURCE_BRANCH="${{ github.event.pull_request.head.ref }}"
        TARGET_BRANCH="${{ github.event.pull_request.base.ref }}"

        echo "🔍 Branch: $BRANCH_NAME, Evento: $EVENT_NAME, PR Source: $SOURCE_BRANCH, PR Target: $TARGET_BRANCH"

        if [[ "$BRANCH_NAME" == "LIVE" ]]; then
          if [[ "$EVENT_NAME" != "pull_request" ]]; then
            echo "❌ Deploy su LIVE permesso solo tramite Pull Request da PAPER"
            exit 1
          fi
          if [[ "$SOURCE_BRANCH" != "PAPER" || "$TARGET_BRANCH" != "LIVE" ]]; then
            echo "❌ Solo PR da PAPER a LIVE sono consentite"
            exit 1
          fi
        fi

        echo "✅ Controllo superato, proseguo con il deploy..."

    - name: Build and push all Docker images
      run: |
        if [[ "${{ github.ref_name }}" == "LIVE" ]]; then
          echo "⚠️  Skip build e push: il branch LIVE deve solo eseguire il deploy di immagini già pubblicate."
          exit 0
        fi

        # Prefisso registry GCP — sostituisce DOCKERHUB_USERNAME come prefisso immagine
        REGISTRY_PREFIX="${{ env.REGISTRY }}/${{ env.GCP_PROJECT_ID }}/${{ env.GCP_REGISTRY_REPO }}"

        services=(
          cacheManager
          alertingService
          scheduler
          tickerScanner
          authService
          astraai-frontend
          serviceControlPlane
          ibkr-bridge
          decision-engine
          ibkr-keepalive
          market-data-service
          redisWsBridge
          liquidity-manager
          brokerExecutor-ibkr
          datahub
          mcp-gateway
          capital-manager
          help-trading
          ibkr-login-desktop
          market-simulator
        )

        for service in "${services[@]}"; do
          name=$(basename "$service" | tr '[:upper:]' '[:lower:]')
          if [[ "$service" == "redisWsBridge" ]]; then
            name="redis-ws-bridge"
          elif [[ "$service" == "brokerExecutor-ibkr" ]]; then
            name="broker-executor-ibkr"
          fi

          RELEASE_FILE="$service/release.json"
          IMAGE="${REGISTRY_PREFIX}/${name}"

          if [[ ! -f "$service/Dockerfile" ]]; then
            echo "⚠️  Nessun Dockerfile per $service, salto build/push..."
            continue
          fi

          VERSION=""
          if [[ -f "$RELEASE_FILE" ]]; then
            VERSION=$(grep -oE '"version"[[:space:]]*:[[:space:]]*"([^"]+)"' "$RELEASE_FILE" | head -n1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
          else
            echo "⚠️  $RELEASE_FILE non trovato per $service, userò solo :latest"
          fi

          if [[ -z "$VERSION" ]]; then
            echo "🏷  Nessuna versione specifica per $name → tag solo :latest"
            TAG_ARGS=( --tag "${IMAGE}:latest" )
          else
            echo "🏷  Versione per $name: $VERSION (userò :$VERSION e :latest)"
            TAG_ARGS=( --tag "${IMAGE}:latest" --tag "${IMAGE}:${VERSION}" )
          fi

          echo "🔧 Building $name da directory $service..."

          if [ "$SKIP_PUSH" != "true" ]; then
            # Cache su Artifact Registry — sostituisce cache su Docker Hub
            docker buildx build \
              --platform linux/amd64 \
              --push \
              "${TAG_ARGS[@]}" \
              --cache-from "type=registry,ref=${IMAGE}:cache" \
              --cache-to   "type=registry,ref=${IMAGE}:cache,mode=max" \
              -f "$service/Dockerfile" .
          fi
        done

    - name: Setup SSH key
      uses: webfactory/ssh-agent@v0.8.0
      with:
        ssh-private-key: ${{ secrets.SSH_PRIVATE_KEY }}

    - name: Build IBKR API Gateway on server and push
      run: |
        if [[ "${{ github.ref_name }}" == "LIVE" ]]; then
          echo "⚠️  Skip build: il branch LIVE deve solo eseguire il deploy di immagini già pubblicate."
          exit 0
        fi

        IBKR_VERSION=$(jq -r .version IBKR_API_Gateway/release.json)
        if [[ -z "$IBKR_VERSION" || "$IBKR_VERSION" == "null" ]]; then
          echo "❌ Versione non trovata in IBKR_API_Gateway/release.json"
          exit 1
        fi

        REGISTRY_PREFIX="${{ env.REGISTRY }}/${{ env.GCP_PROJECT_ID }}/${{ env.GCP_REGISTRY_REPO }}"
        IBKR_IMAGE="${REGISTRY_PREFIX}/ibkr-clientportal"

        echo "📦 Copio IBKR_API_Gateway (solo file config) sul server..."
        scp -o StrictHostKeyChecking=no \
          IBKR_API_Gateway/Dockerfile \
          IBKR_API_Gateway/release.json \
          IBKR_API_Gateway/conf.local.expopaper.yaml \
          $GCP_USER@$GCP_HOST:/tmp/

        echo "🐳 Build e push su server: ${IBKR_IMAGE}:$IBKR_VERSION"

        # Passiamo al server le variabili GCP invece delle credenziali Docker Hub
        ssh -o StrictHostKeyChecking=no $GCP_USER@$GCP_HOST \
          "IBKR_IMAGE=${IBKR_IMAGE} IBKR_VERSION=${IBKR_VERSION} bash -s" <<'EOF'
          set -e
          retry() {
            local max_attempts="$1"
            local sleep_seconds="$2"
            shift 2
            local attempt=1
            until "$@"; do
              if [ "$attempt" -ge "$max_attempts" ]; then
                echo "❌ Comando fallito dopo $attempt tentativi: $*"
                return 1
              fi
              echo "⚠️ Tentativo $attempt/$max_attempts fallito: $*"
              echo "↻ Riprovo tra ${sleep_seconds}s..."
              sleep "$sleep_seconds"
              attempt=$((attempt + 1))
            done
          }

          sudo mkdir -p /home/$USER/deploy/IBKR_API_Gateway
          if [ -d /home/$USER/deploy/IBKR_API_Gateway/SW ]; then
            echo "✅ SW già presente su server, la mantengo"
          else
            echo "❌ SW non presente su server. Carica clientportal.gw.zip in /home/$USER/deploy/IBKR_API_Gateway/SW"
            exit 1
          fi
          sudo mv /tmp/Dockerfile         /home/$USER/deploy/IBKR_API_Gateway/Dockerfile
          sudo mv /tmp/release.json        /home/$USER/deploy/IBKR_API_Gateway/release.json
          sudo mv /tmp/conf.local.expopaper.yaml /home/$USER/deploy/IBKR_API_Gateway/conf.local.expopaper.yaml
          sudo chown -R $USER:$USER /home/$USER/deploy/IBKR_API_Gateway

          if [ ! -f /home/$USER/deploy/IBKR_API_Gateway/SW/clientportal.gw.zip ]; then
            echo "❌ File mancante: /home/$USER/deploy/IBKR_API_Gateway/SW/clientportal.gw.zip"
            ls -la /home/$USER/deploy/IBKR_API_Gateway     || true
            ls -la /home/$USER/deploy/IBKR_API_Gateway/SW  || true
            exit 1
          fi

          echo "🔎 Debug build context"
          pwd
          ls -la /home/$USER/deploy/IBKR_API_Gateway
          ls -la /home/$USER/deploy/IBKR_API_Gateway/SW

          cd /home/$USER/deploy/IBKR_API_Gateway

          # La VM GCP usa il suo Service Account — nessun login esplicito necessario
          # gcloud auth configure-docker è già stato eseguito al provisioning della VM
          retry 5 20 docker pull eclipse-temurin:17-jre-jammy
          retry 5 20 docker build --pull \
            -t "${IBKR_IMAGE}:${IBKR_VERSION}" \
            -t "${IBKR_IMAGE}:latest" \
            -f /home/$USER/deploy/IBKR_API_Gateway/Dockerfile \
            /home/$USER/deploy/IBKR_API_Gateway
          retry 5 15 docker push "${IBKR_IMAGE}:${IBKR_VERSION}"
          retry 5 15 docker push "${IBKR_IMAGE}:latest"
        EOF

    - name: Creazione release su github
      run: |
        if [ "${{ github.ref_name }}" == "LIVE" ] && [ "$CREATE_RELEASE" != "false" ]; then
          TAG=$(jq -r .version release.json)
          TITLE=$(jq -r .note release.json)
          bash ./generate-release-notes.sh
          gh release create "$TAG" \
            --title "$TITLE" \
            --notes-file release-notes.md \
            --target PAPER \
            --repo $GITHUB_REPOSITORY
        else
          echo "🚫 Skip: Creazione release abilitata solo su LIVE o CREATE_RELEASE=false"
        fi

    - name: Generate .env for server
      run: |
        # ── Registry GCP — sostituisce riferimenti a DOCKERHUB_USERNAME ──────
        REGISTRY_PREFIX="${{ env.REGISTRY }}/${{ env.GCP_PROJECT_ID }}/${{ env.GCP_REGISTRY_REPO }}"
        echo "REGISTRY_PREFIX=${REGISTRY_PREFIX}" > .env
        echo "GCP_REGISTRY_REGION=${{ env.GCP_REGISTRY_REGION }}" >> .env
        # ─────────────────────────────────────────────────────────────────────

        echo "LOG_LEVEL=${{ vars.LOG_LEVEL }}" >> .env
        echo "ENV_NAME=${{ github.ref_name }}" >> .env
        echo "ENV=${{ github.ref_name }}" >> .env
        echo "LETSENCRYPT_EMAIL=${{ github.LETSENCRYPT_EMAIL }}" >> .env
        echo "MYSQL_ROOT_PASSWORD='${{ secrets.MYSQL_ROOT_PASSWORD }}'" >> .env
        echo "MYSQL_PASSWORD='${{ secrets.MYSQL_PASSWORD }}'" >> .env
        echo "MYSQL_DATABASE=${{ vars.MYSQL_DATABASE }}" >> .env
        echo "MYSQL_USER=${{ vars.MYSQL_USER }}" >> .env
        echo "MYSQL_HOST=${{vars.MYSQL_HOST}}" >> .env
        echo "ALPACA_MARKET_FEED=${{ vars.ALPACA_MARKET_FEED }}" >> .env
        echo "ENV_MARKET=${{ vars.ENV_MARKET }}" >> .env
        echo "ENV_ORDERS=${{ vars.ENV_ORDERS }}" >> .env
        echo "ENV_TRADING=${{ vars.ENV_TRADING }}" >> .env
        echo "NETWORK=${{ vars.NETWORK }}" >> .env
        echo "JWT_SECRET='${{ secrets.JWT_SECRET }}'" >> .env
        echo "JWT_EXPIRES_IN=${{ vars.JWT_EXPIRES_IN }}" >> .env
        echo "ENABLE_DB_LOG=${{ vars.ENABLE_DB_LOG }}" >> .env
        echo "DBMANAGER_VERSION=${{ vars.DBMANAGER_VERSION }}" >> .env
        echo "DATAHUB_VERSION=${{ vars.DATAHUB_VERSION }}" >> .env
        echo "CACHEMANAGER_VERSION=${{ vars.CACHEMANAGER_VERSION }}" >> .env
        echo "TICKERSCANNER_VERSION=${{ vars.TICKERSCANNER_VERSION }}" >> .env
        echo "AUTHSERVICE_VERSION=${{ vars.AUTHSERVICE_VERSION }}" >> .env
        echo "SCHEDULER_VERSION=${{ vars.SCHEDULER_VERSION }}" >> .env
        echo "MYSQL_PORT=${{vars.MYSQL_PORT}}" >> .env
        echo "APCA_API_KEY_ID='${{secrets.APCA_API_KEY_ID}}'" >> .env
        echo "APCA_API_SECRET_KEY='${{secrets.APCA_API_SECRET_KEY}}'" >> .env
        echo "FRED_API_KEY='${{secrets.FRED_API_KEY}}'" >> .env
        echo "FMP_API_KEY='${{secrets.FMP_API_KEY}}'" >> .env
        echo "SMTP_PASSWORD='${{ secrets.SMTP_PASSWORD }}'" >> .env
        echo "TWILIO_ACCOUNT_SID='${{ secrets.TWILIO_ACCOUNT_SID }}'" >> .env
        echo "TWILIO_AUTH_TOKEN='${{ secrets.TWILIO_AUTH_TOKEN }}'" >> .env
        echo "TWILIO_CONTENT_SID='${{ secrets.TWILIO_CONTENT_SID }}'" >> .env
        echo "ALERTING_DEDUP_SECONDS='${{ vars.ALERTING_DEDUP_SECONDS }}'" >> .env
        echo "ALERTING_DEFAULT_EMAIL_TO='${{ vars.ALERTING_DEFAULT_EMAIL_TO }}'" >> .env
        echo "ALERTING_MAX_PER_WINDOW='${{ vars.ALERTING_MAX_PER_WINDOW }}'" >> .env
        echo "ALERTING_WINDOW_SECONDS='${{ vars.ALERTING_WINDOW_SECONDS }}'" >> .env
        echo "BODY_LIMIT='${{ vars.BODY_LIMIT }}'" >> .env
        echo "DATA_SERVICE_VERSION='${{ vars.DATA_SERVICE_VERSION }}'" >> .env
        echo "IBKR_REQUEST_TIMEOUT_MS='${{ vars.IBKR_REQUEST_TIMEOUT_MS }}'" >> .env
        echo "CACHEMANAGER_TIMEOUT_MS='${{ vars.CACHEMANAGER_TIMEOUT_MS }}'" >> .env
        echo "IBKR_SSODH_INIT_INTERVAL_MS='${{ vars.IBKR_SSODH_INIT_INTERVAL_MS }}'" >> .env
        echo "INTERNAL_JWT_EXP_SECONDS='${{ vars.INTERNAL_JWT_EXP_SECONDS }}'" >> .env
        echo "INTERNAL_JWT_ISS='${{ vars.INTERNAL_JWT_ISS }}'" >> .env
        echo "MARKET_DAILY_CONCURRENCY='${{ vars.MARKET_DAILY_CONCURRENCY }}'" >> .env
        echo "SCAN_BULK_SIZE='${{ vars.SCAN_BULK_SIZE }}'" >> .env
        echo "SCAN_FMP_CONCURRENCY='${{ vars.SCAN_FMP_CONCURRENCY }}'" >> .env
        echo "SCAN_MISSING_BATCH='${{ vars.SCAN_MISSING_BATCH }}'" >> .env
        echo "SMTP_FROM='${{ vars.SMTP_FROM }}'" >> .env
        echo "SMTP_HOST='${{ vars.SMTP_HOST }}'" >> .env
        echo "SMTP_PORT='${{ vars.SMTP_PORT }}'" >> .env
        echo "SMTP_USER='${{ vars.SMTP_USER }}'" >> .env
        echo "DBMANAGER_URL=${{vars.DBMANAGER_URL}}" >> .env
        echo "ALERTINGMANAGER_URL=${{vars.ALERTINGMANAGER_URL}}" >> .env
        echo "CACHEMANAGER_URL=${{vars.CACHEMANAGER_URL}}" >> .env
        echo "REDIS_URL=${{vars.REDIS_URL}}" >> .env
        echo "SCHEDULER_URL=${{vars.SCHEDULER_URL}}" >> .env
        echo "TICKERSCANNER_URL=${{vars.TICKERSCANNER_URL}}" >> .env
        echo "AUTHSERVICE_URL=${{vars.AUTHSERVICE_URL}}" >> .env
        echo "ASTRAAI_VERSION=${{vars.ASTRAAI_VERSION}}" >> .env
        echo "HELPTRADING_VERSION=${{vars.HELPTRADING_VERSION}}" >> .env
        echo "ALERTINGSERVICE_VERSION=${{vars.ALERTINGSERVICE_VERSION}}" >> .env
        echo "CORS_ORIGIN=${{vars.CORS_ORIGIN}}" >> .env
        echo "SERVICECONTROLPLANE_VERSION=${{vars.SERVICECONTROLPLANE_VERSION}}" >> .env
        echo "DECISIONENGINE_VERSION=${{vars.DECISIONENGINE_VERSION}}" >> .env
        echo "DECISIONENGINE_URL=${{vars.DECISIONENGINE_URL}}" >> .env
        echo "IBKRBRIDGE_VERSION=${{vars.IBKRBRIDGE_VERSION}}" >> .env
        echo "IBKRBRIDGE_URL=${{vars.IBKRBRIDGE_URL}}" >> .env
        echo "IBKRKEEPALIVE_VERSION=${{vars.IBKRKEEPALIVE_VERSION}}" >> .env
        echo "IBKRKEEPALIVE_URL=${{vars.IBKRKEEPALIVE_URL}}" >> .env
        echo "IBKRGW_URL=${{vars.IBKRGW_URL}}" >> .env
        echo "IBKRGW_VERSION=${{vars.IBKRGW_VERSION}}" >> .env
        echo "MARKETDATASERVICE_VERSION=${{vars.MARKETDATASERVICE_VERSION}}" >> .env
        echo "IBKRGW_BASE_URL=${{vars.IBKRGW_BASE_URL}}" >> .env
        echo "IBKR_INSECURE_TLS=${{vars.IBKR_INSECURE_TLS}}" >> .env
        echo "TICKLE_INTERVAL_MS=${{vars.TICKLE_INTERVAL_MS}}" >> .env
        echo "AUTH_CHECK_INTERVAL_MS=${{vars.AUTH_CHECK_INTERVAL_MS}}" >> .env
        echo "REDISWSBRIDGE_VERSION=${{vars.REDISWSBRIDGE_VERSION}}" >> .env
        echo "INTERNAL_JWT_PRIVATE_KEY='${{secrets.INTERNAL_JWT_PRIVATE_KEY}}'" >> .env
        echo "INTERNAL_JWT_PUBLIC_KEY='${{secrets.INTERNAL_JWT_PUBLIC_KEY || vars.INTERNAL_JWT_PUBLIC_KEY}}'" >> .env
        echo "COMPOSE_PROFILES=${{vars.COMPOSE_PROFILES}}" >> .env
        echo "TIMEZONE=${{vars.TIMEZONE}}" >> .env
        echo "LOG_BATCH_MAX_BYTES=${{vars.LOG_BATCH_MAX_BYTES}}" >> .env
        echo "MAX_RETRY_DELAY=${{vars.MAX_RETRY_DELAY}}" >> .env
        echo "ALERTING_LOGS_PATTERN=${{vars.ALERTING_LOGS_PATTERN}}" >> .env
        echo "REDIS_PATTERNS=${{vars.REDIS_PATTERNS}}" >> .env
        echo "MARKETDATASERVICE_URL=${{vars.MARKETDATASERVICE_URL}}" >> .env
        echo "DATAHUB_URL=${{vars.DATAHUB_URL}}" >> .env
        echo "SERVICECONTROLPLANE_URL=${{vars.SERVICECONTROLPLANE_URL}}" >> .env
        echo "LIQUIDITY_MANAGER_URL=${{vars.LIQUIDITY_MANAGER_URL}}" >> .env
        echo "LIQUIDITY_MANAGER_VERSION=${{vars.LIQUIDITY_MANAGER_VERSION}}" >> .env
        echo "BROKER_EXECUTOR_IBKR_VERSION=${{vars.BROKER_EXECUTOR_IBKR_VERSION}}" >> .env
        echo "BROKER_EXECUTOR_IBKR_URL=${{vars.BROKER_EXECUTOR_IBKR_URL}}" >> .env
        echo "IBKR_LOGIN_DESKTOP_VERSION=${{vars.IBKR_LOGIN_DESKTOP_VERSION}}" >> .env
        echo "MCPGATEWAY_URL=${{vars.MCPGATEWAY_URL}}" >> .env
        echo "MPC_GATEWAY_VERSION=${{vars.MPC_GATEWAY_VERSION}}" >> .env
        echo "IBKR_BRIDGE_URL=${{vars.IBKR_BRIDGE_URL}}" >> .env
        echo "TRADING_API_KEY=${{secrets.TRADING_API_KEY}}" >> .env

    - name: Validate .env variables
      run: |
        set -euo pipefail
        echo "🔍 Validating required environment variables..."
        set -a && source .env && set +a
        REQUIRED=(
          DATAHUB_URL DATAHUB_VERSION
          AUTHSERVICE_URL AUTHSERVICE_VERSION
          SERVICECONTROLPLANE_URL SERVICECONTROLPLANE_VERSION
          LIQUIDITY_MANAGER_URL LIQUIDITY_MANAGER_VERSION BROKER_EXECUTOR_IBKR_VERSION
          BROKER_EXECUTOR_IBKR_URL REDIS_URL MYSQL_HOST MYSQL_DATABASE
          CACHEMANAGER_URL TICKERSCANNER_VERSION SCHEDULER_VERSION
          INTERNAL_JWT_PRIVATE_KEY INTERNAL_JWT_PUBLIC_KEY
          NETWORK TIMEZONE IBKR_LOGIN_DESKTOP_VERSION
          REGISTRY_PREFIX
        )
        FAILED=0
        for var in "${REQUIRED[@]}"; do
          val="${!var:-}"
          if [[ -z "$val" ]]; then
            echo "  ❌ $var is empty"
            FAILED=1
          fi
        done
        if [[ $FAILED -eq 1 ]]; then
          echo ""
          echo "❌ One or more required variables are empty — aborting deploy."
          echo "   Set them in: GitHub → Settings → Environments → ${{ github.ref_name }} → Variables"
          exit 1
        fi
        echo "✅ All required variables are set"

    - name: Copy .env to server
      run: |
        scp -o StrictHostKeyChecking=no .env $GCP_USER@$GCP_HOST:/home/$GCP_USER/deploy/.env

    - name: Copy docker-compose files to server
      run: |
        ENV_NAME="${{ github.ref_name }}"
        LOWER_ENV_NAME=$(echo "$ENV_NAME" | tr '[:upper:]' '[:lower:]')
        SRC_COMPOSE_FILE="docker-compose.${LOWER_ENV_NAME}.yml"

        echo "🔍 Cerco file nel repo: $SRC_COMPOSE_FILE"
        if [ ! -f "$SRC_COMPOSE_FILE" ]; then
          echo "❌ File $SRC_COMPOSE_FILE non trovato nel repo!"
          ls -l .
          exit 1
        fi

        echo "📤 Copio $SRC_COMPOSE_FILE su server..."
        scp -o StrictHostKeyChecking=no \
          "$SRC_COMPOSE_FILE" \
          $GCP_USER@$GCP_HOST:/home/$GCP_USER/deploy/

        ssh -o StrictHostKeyChecking=no $GCP_USER@$GCP_HOST << EOF
          cd ~/deploy
          echo "🔁 Rinomino $SRC_COMPOSE_FILE → docker-compose.${LOWER_ENV_NAME}.yml"
          mv "$SRC_COMPOSE_FILE" "docker-compose.${LOWER_ENV_NAME}.yml"
          echo "✅ docker-compose.${LOWER_ENV_NAME}.yml aggiornato"
        EOF

    - name: Copy DB restore script and dump to server
      if: false  # DB restore manuale
      run: |
        TAR_FILE=$(ls -1t db/Trading_${{ github.ref_name }}_*.tar.gz 2>/dev/null | head -n 1)
        if [[ -z "$TAR_FILE" ]]; then
          echo "❌ Nessun file db/Trading_${{ github.ref_name }}_*.tar.gz trovato"
          exit 1
        fi
        echo "📦 Tarball trovato: $TAR_FILE"
        scp -o StrictHostKeyChecking=no \
          restore-env-db.sh \
          "$TAR_FILE" \
          $GCP_USER@$GCP_HOST:/home/$GCP_USER/deploy/

    - name: Restore DB on server
      if: false  # DB restore manuale
      run: |
        ssh -o StrictHostKeyChecking=no $GCP_USER@$GCP_HOST "ENV_NAME=${{ github.ref_name }} bash -e -s" <<'EOF'
          set -e
          cd ~/deploy
          set -a
          . .env
          set +a
          TAR_FILE=$(ls -1t Trading_${ENV_NAME}_*.tar.gz 2>/dev/null | head -n 1)
          if [[ -z "$TAR_FILE" ]]; then
            echo "❌ Nessun file Trading_${ENV_NAME}_*.tar.gz trovato per il restore"
            exit 1
          fi
          MARKER_FILE=".last_db_restore_${ENV_NAME}.txt"
          if [[ -f "$MARKER_FILE" ]]; then
            LAST_RESTORED=$(cat "$MARKER_FILE")
          else
            LAST_RESTORED=""
          fi
          echo "📦 Dump corrente : $TAR_FILE"
          echo "📝 Ultimo import : ${LAST_RESTORED:-<none>}"
          if [[ "$TAR_FILE" == "$LAST_RESTORED" ]]; then
            echo "✅ Il dump è lo stesso dell'ultimo restore. Skip ripristino DB."
            COMPOSE_FILE="docker-compose.${ENV_NAME,,}.yml"
            LOWER_PROJECT_NAME=$(echo "$ENV_NAME" | tr '[:upper:]' '[:lower:]')
            echo "▶️ Avvio servizi core: mysql redis traefik"
            docker compose -f "$COMPOSE_FILE" --env-file .env -p "$LOWER_PROJECT_NAME" up -d mysql redis traefik
            exit 0
          fi
          echo "♻️ Ripristino DB Trading_${ENV_NAME} da $TAR_FILE"
          bash restore-env-db.sh "$ENV_NAME" "$TAR_FILE"
          if [[ $? -eq 0 ]]; then
            echo "$TAR_FILE" > "$MARKER_FILE"
            echo "📝 Aggiornato marker di ultimo restore: $MARKER_FILE"
          else
            echo "❌ Errore nel restore, marker NON aggiornato."
            exit 1
          fi
        EOF

    - name: Copy deploy-with-profiles.sh to server
      run: |
        scp -o StrictHostKeyChecking=no \
          deploy-with-profiles.sh \
          $GCP_USER@$GCP_HOST:/home/$GCP_USER/deploy/deploy-with-profiles.sh
        ssh -o StrictHostKeyChecking=no $GCP_USER@$GCP_HOST << 'EOF'
          cd ~/deploy
          chmod +x deploy-with-profiles.sh
        EOF

    - name: Start all containers (profiles)
      run: |
        ssh -o StrictHostKeyChecking=no $GCP_USER@$GCP_HOST "ENV_NAME=${{ github.ref_name }} bash -e -s" <<'EOF'
          set -e
          cd ~/deploy
          LOWER_PROJECT_NAME=$(echo "$ENV_NAME" | tr '[:upper:]' '[:lower:]')
          COMPOSE_FILE="docker-compose.${ENV_NAME,,}.yml"
          if [ ! -f "$COMPOSE_FILE" ]; then
            echo "❌ File $COMPOSE_FILE non trovato!"
            exit 1
          fi
          if [ ! -f "./deploy-with-profiles.sh" ]; then
            echo "❌ Script deploy-with-profiles.sh non trovato in ~/deploy!"
            exit 1
          fi
          echo "▶️ Avvio microservizi dinamici per ambiente $ENV_NAME usando profili dal DB"
          ./deploy-with-profiles.sh "$ENV_NAME" "$COMPOSE_FILE" ".env"
          echo "🧹 Pulizia immagini Docker"
          docker image prune -a -f
        EOF

    - name: Crea shared cache volume se non esistente
      if: false
      run: |
        ssh -o StrictHostKeyChecking=no $GCP_USER@$GCP_HOST <<EOF
          if ! docker volume ls --format '{{.Name}}' | grep -q '^shared_cache_data$'; then
            echo "🛠️  Creo volume condiviso shared_cache_data..."
            docker volume create shared_cache_data
          else
            echo "✅ Volume shared_cache_data già esistente, proseguo..."
          fi
        EOF

    - name: Start all containers (no-recreate)
      run: |
        ssh -o StrictHostKeyChecking=no $GCP_USER@$GCP_HOST "ENV_NAME=${{ github.ref_name }} bash -e -s" <<'EOF'
          set -e
          cd ~/deploy
          LOWER_PROJECT_NAME=$(echo "$ENV_NAME" | tr '[:upper:]' '[:lower:]')
          docker compose \
            -f "docker-compose.${ENV_NAME,,}.yml" \
            --env-file .env \
            -p "$LOWER_PROJECT_NAME" \
            up -d --remove-orphans --no-recreate
          docker image prune -a -f
        EOF

    - name: Verify deploy health
      run: |
        ssh -o StrictHostKeyChecking=no $GCP_USER@$GCP_HOST "ENV_NAME=${{ github.ref_name }} bash -e -s" <<'EOF'
          set -e
          LOWER=$(echo "$ENV_NAME" | tr '[:upper:]' '[:lower:]')
          echo "⏳ Waiting 20s for containers to stabilize..."
          sleep 20
          echo "🔍 Checking for exited containers in project '${LOWER}'..."
          EXITED=$(docker ps -a --filter "name=${LOWER}-" --filter "status=exited" --format "{{.Names}}" 2>/dev/null || true)
          if [[ -n "$EXITED" ]]; then
            echo "❌ These containers exited unexpectedly:"
            echo "$EXITED"
            echo ""
            echo "--- Last logs (tail 30) ---"
            while IFS= read -r cname; do
              echo ">>> $cname"
              docker logs --tail=30 "$cname" 2>&1 || true
            done <<< "$EXITED"
            exit 1
          fi
          echo "✅ No containers exited — deploy looks healthy"
          docker ps --filter "name=${LOWER}-" --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
        EOF

    - name: Cleanup .env on server
      run: |
        ssh -o StrictHostKeyChecking=no $GCP_USER@$GCP_HOST << 'EOF'
          rm -f /home/$GCP_USER/deploy/.env
        EOF
```
