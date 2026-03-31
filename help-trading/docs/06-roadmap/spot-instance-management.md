---
sidebar_position: 1
title: Spot Instance Management
---

# Spot Instance Management — Piano Implementativo

> **Documento di lavoro** — generato il 25 marzo 2026  
> Complementare a `market-simulator-implementation.md`.  
> Copre scheduling, provisioning, checkpoint/resume, cost tracking e multi-provider.

---

## Indice

1. [Principi e obiettivi](#1-principi-e-obiettivi)
2. [Architettura del sistema](#2-architettura-del-sistema)
3. [sim-scheduler — il microservizio centrale](#3-sim-scheduler--il-microservizio-centrale)
4. [sim_queue — schema e lifecycle](#4-sim_queue--schema-e-lifecycle)
5. [Provisioning automatico](#5-provisioning-automatico)
6. [Checkpoint e resume](#6-checkpoint-e-resume)
7. [Preemption handler](#7-preemption-handler)
8. [Cost tracking](#8-cost-tracking)
9. [Multi-provider — GCP, AWS, Azure](#9-multi-provider--gcp-aws-azure)
10. [Campi aggiuntivi in sim_runs](#10-campi-aggiuntivi-in-sim_runs)
11. [Cloudflare Tunnel e accesso remoto](#11-cloudflare-tunnel-e-accesso-remoto)
12. [Piano di implementazione](#12-piano-di-implementazione)
13. [Note operative](#13-note-operative)
14. [Analisi tempi e dimensionamento HW](#14-analisi-tempi-e-dimensionamento-hw)

---

## 1. Principi e obiettivi

### 1.1 Obiettivo

Eseguire simulazioni di trading su istanze spot cloud a costo minimo, con capacità di:
- accodare più simulazioni con parametri diversi (parameter sweep)
- lanciare automaticamente quando il prezzo spot scende sotto soglia
- riprendere automaticamente in caso di preemption senza perdere la run
- tracciare il costo reale di ogni simulazione
- supportare GCP oggi, AWS e Azure in futuro

### 1.2 Principi

**Stateless by design.** La spot instance non mantiene stato persistente. Tutto ciò che conta è nel DB principale prima che la VM venga distrutta. Se la VM viene killata senza preavviso, la run è recuperabile dall'ultimo checkpoint.

**Zero configurazione manuale.** Dal momento in cui una sim viene accodata, tutto il resto è automatico: price check, provisioning, startup, esecuzione, checkpoint, teardown, risultati.

**Costo trasparente.** Ogni run traccia il prezzo spot pagato, il tempo reale di esecuzione e il costo effettivo. Le stime pre-lancio sono confrontabili coi valori reali a posteriori.

**Multi-provider futuro-proof.** Il sim-scheduler astrae il provider — la logica di business non cambia se si aggiunge un nuovo cloud provider.

---

## 2. Architettura del sistema

```
┌─────────────────────────────────────────────────────────────────┐
│  VM PRINCIPALE (sempre attiva)                                  │
│                                                                 │
│  sim-scheduler                                                  │
│    · polling prezzi spot ogni 5 min (GCP / AWS / Azure API)     │
│    · legge sim_queue: status = PENDING                          │
│    · lancia se prezzo < max_price_threshold                     │
│    · sceglie provider più economico se preferred = ANY          │
│                                                                 │
│  sim_queue (DB)          DB principale                          │
│    · PENDING             · sim_runs                             │
│    · LAUNCHING           · sim_trades                           │
│    · RUNNING             · sim_checkpoints   ← chiave          │
│    · PAUSED              · sim_daily_snapshots                  │
│    · COMPLETED           · liquidity_index_daily                │
│    · FAILED                                                     │
└────────────────────┬────────────────────────────────────────────┘
                     │ provision + startup
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  SPOT INSTANCE (on demand — tirata su, esegue, distrutta)       │
│                                                                 │
│  sim-controller:SIMUL                                           │
│    · legge checkpoint da DB se run_id ha status PAUSED          │
│    · ripristina stato broker mock                               │
│    · avvia loop tick dal giorno successivo al checkpoint        │
│    · scrive checkpoint ad ogni EOD virtuale                     │
│    · flush risultati finali → DB                                │
│    · aggiorna sim_runs.status = COMPLETED                       │
│                                                                 │
│  preemption handler                                             │
│    · ascolta SIGTERM (30 sec preavviso GCP/Azure, 2 min AWS)    │
│    · flush checkpoint immediato (<5 sec)                        │
│    · status = PAUSED → scheduler rilancia su nuova spot         │
│                                                                 │
│  market-simulator:SIMUL  broker-mock:SIMUL  decision-engine:SIMUL│
│  Cloudflare Tunnel → simul.trading.expovin.it                   │
└────────────────────┬────────────────────────────────────────────┘
                     │ risultati + checkpoint
                     ▼
              DB principale (permanente)
```

---

## 3. sim-scheduler — il microservizio centrale

### 3.1 Responsabilità

- Polling periodico dei prezzi spot (ogni 5 minuti, configurabile)
- Scelta del provider più economico per il tipo di istanza richiesto
- Provisioning della spot instance quando il prezzo è sotto soglia
- Monitoraggio delle run in corso (`status = RUNNING`)
- Rilevamento di run interrotte (`status = PAUSED`) e rilancio automatico
- Registrazione del prezzo effettivo pagato per ogni run

### 3.2 Loop principale

```javascript
// sim-scheduler/main.js
const POLL_INTERVAL_MS = getSetting('SIM_SCHEDULER_POLL_INTERVAL_MS') || 5 * 60 * 1000;

async function schedulerLoop() {
  logger.info('[scheduler] avviato');

  while (true) {
    try {
      // 1. Rilancia run interrotte (PAUSED) — priorità assoluta
      const paused = await db.query(
        `SELECT * FROM sim_queue WHERE status = 'PAUSED' ORDER BY updated_at ASC`
      );
      for (const sim of paused) {
        await tryRelaunch(sim);
      }

      // 2. Lancia nuove run (PENDING) in ordine di priorità
      const pending = await db.query(
        `SELECT * FROM sim_queue WHERE status = 'PENDING'
         ORDER BY priority ASC, created_at ASC LIMIT 5`
      );
      for (const sim of pending) {
        await tryLaunch(sim);
      }

    } catch (err) {
      logger.error(`[scheduler] errore loop: ${err.message}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function tryLaunch(sim) {
  const spotPrice = await fetchBestSpotPrice({
    instanceType:      sim.required_instance_type,
    preferredProvider: sim.preferred_provider,
  });

  if (!spotPrice || spotPrice.price > sim.max_price_threshold) {
    logger.info(
      `[scheduler] ${sim.queue_id} skip — prezzo ${spotPrice?.price} > soglia ${sim.max_price_threshold}`
    );
    return;
  }

  logger.info(
    `[scheduler] lancio ${sim.queue_id} su ${spotPrice.provider} a $${spotPrice.price}/ora`
  );

  // Stima costo prima del lancio
  const estimatedCost = spotPrice.price * (sim.estimated_duration_min / 60);

  await db.update('sim_queue', sim.queue_id, {
    status:            'LAUNCHING',
    launched_at:       new Date(),
    estimated_cost_usd: estimatedCost,
  });

  await provisionSpotInstance(sim, spotPrice);
}

async function tryRelaunch(sim) {
  // Stessa logica di tryLaunch ma passa run_id esistente → il sim-controller
  // leggerà il checkpoint e riprenderà da dove si era fermato
  await tryLaunch({ ...sim, status: 'PENDING', resume: true });
}
```

### 3.3 Price fetcher multi-provider

```javascript
// sim-scheduler/lib/priceFetcher.js

async function fetchBestSpotPrice({ instanceType, preferredProvider }) {
  const providers = preferredProvider === 'ANY'
    ? ['GCP', 'AWS', 'AZURE']
    : [preferredProvider];

  const results = await Promise.allSettled(
    providers.map(p => fetchProviderPrice(p, instanceType))
  );

  const available = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value)
    .sort((a, b) => a.price - b.price);

  return available[0] ?? null;
}

async function fetchProviderPrice(provider, instanceType) {
  switch (provider) {
    case 'GCP':   return fetchGCPPrice(instanceType);
    case 'AWS':   return fetchAWSPrice(instanceType);
    case 'AZURE': return fetchAzurePrice(instanceType);
    default: return null;
  }
}

// GCP: prezzi spot accessibili via Cloud Billing API o Compute Engine API
async function fetchGCPPrice(instanceType) {
  // https://cloud.google.com/compute/docs/instances/spot#pricing
  const resp = await gcpClient.compute.machineTypes.get({
    project: GCP_PROJECT,
    zone:    GCP_ZONE,
    machineType: instanceType,
  });
  // Prezzo spot = ~60-91% di sconto sull'on-demand
  // Per prezzi precisi: Cloud Billing Catalog API
  const onDemandPrice = parseFloat(resp.data.description?.onDemandPrice || 0);
  const spotPrice     = onDemandPrice * 0.25; // approssimazione — usare API per valore esatto
  return { provider: 'GCP', instanceType, price: spotPrice, region: GCP_ZONE };
}

// AWS: SpotPrice API
async function fetchAWSPrice(instanceType) {
  const resp = await ec2Client.describeSpotPriceHistory({
    InstanceTypes:       [instanceType],
    ProductDescriptions: ['Linux/UNIX'],
    MaxResults:          1,
  }).promise();
  const latest = resp.SpotPriceHistory[0];
  if (!latest) return null;
  return {
    provider:     'AWS',
    instanceType: latest.InstanceType,
    price:        parseFloat(latest.SpotPrice),
    region:       AWS_REGION,
  };
}

// Azure: Retail Prices API (pubblica, no auth)
async function fetchAzurePrice(instanceType) {
  const url = `https://prices.azure.com/api/retail/prices?$filter=` +
    `serviceName eq 'Virtual Machines' and ` +
    `armSkuName eq '${instanceType}' and ` +
    `priceType eq 'Spot' and ` +
    `armRegionName eq '${AZURE_REGION}'`;
  const resp = await fetch(url).then(r => r.json());
  const item = resp.Items?.[0];
  if (!item) return null;
  return {
    provider:     'AZURE',
    instanceType: item.armSkuName,
    price:        item.retailPrice,
    region:       AZURE_REGION,
  };
}
```

---

## 4. sim_queue — schema e lifecycle

### 4.1 Schema

```sql
CREATE TABLE sim_queue (
  queue_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at              TIMESTAMP DEFAULT NOW(),
  updated_at              TIMESTAMP DEFAULT NOW(),

  status                  VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    -- PENDING    → in attesa di spot disponibile sotto soglia
    -- LAUNCHING  → provisioning in corso
    -- RUNNING    → sim in esecuzione sulla spot instance
    -- PAUSED     → interrotta da preemption, pronta per resume
    -- COMPLETED  → terminata con successo
    -- FAILED     → errore non recuperabile

  priority                INT DEFAULT 5,
    -- 1 = massima priorità, 10 = minima

  -- Configurazione simulazione
  sim_config              JSONB NOT NULL,
    -- { startDate, endDate, tickers, tf, speed, params... }
  sim_label               VARCHAR(100),
    -- nome leggibile es. "baseline_18mo" o "alpha_ema_0.3_sweep"

  -- Requisiti hardware
  required_instance_type  VARCHAR(40) DEFAULT 'n2-standard-4',
  max_price_threshold     DECIMAL(8,6) NOT NULL,
    -- $/ora massimo accettabile — se il prezzo supera questo la sim aspetta
  preferred_provider      VARCHAR(10) DEFAULT 'ANY',
    -- GCP / AWS / AZURE / ANY

  -- Tracking esecuzione
  run_id                  UUID REFERENCES sim_runs(run_id),
  instance_id             VARCHAR(100),
    -- ID istanza cloud (per riferimento e debug)
  launched_at             TIMESTAMP,
  completed_at            TIMESTAMP,

  -- Stime pre-lancio
  estimated_duration_min  INT,
  estimated_cost_usd      DECIMAL(8,4),

  -- Conteggio preemption
  preemption_count        INT DEFAULT 0,

  -- Errore se FAILED
  error_log               TEXT
);

CREATE INDEX idx_sim_queue_status   ON sim_queue(status, priority, created_at);
CREATE INDEX idx_sim_queue_run_id   ON sim_queue(run_id);
```

### 4.2 Transizioni di stato

```
PENDING
  → LAUNCHING   (scheduler trova prezzo ok, avvia provisioning)
  
LAUNCHING
  → RUNNING     (startup completato, sim-controller attivo)
  → FAILED      (provisioning fallito dopo N tentativi)

RUNNING
  → COMPLETED   (sim finita, risultati salvati, instance distrutta)
  → PAUSED      (preemption ricevuta, checkpoint salvato)
  → FAILED      (errore non recuperabile nel sim-controller)

PAUSED
  → LAUNCHING   (scheduler rilancia su nuova spot)
  → FAILED      (troppi tentativi di resume falliti)
```

---

## 5. Provisioning automatico

### 5.1 Script di startup (GCP)

```bash
#!/bin/bash
# sim-startup.sh — eseguito automaticamente all'avvio della spot instance

set -e
LOG="/var/log/sim-startup.log"
exec > >(tee -a $LOG) 2>&1

echo "=== sim-startup avviato $(date) ==="

# Variabili iniettate dal sim-scheduler via instance metadata
QUEUE_ID=$(curl -sf "http://metadata.google.internal/computeMetadata/v1/instance/attributes/queue-id" -H "Metadata-Flavor: Google")
RUN_ID=$(curl -sf "http://metadata.google.internal/computeMetadata/v1/instance/attributes/run-id" -H "Metadata-Flavor: Google")
DB_URL=$(curl -sf "http://metadata.google.internal/computeMetadata/v1/instance/attributes/db-url" -H "Metadata-Flavor: Google")
CF_TOKEN=$(curl -sf "http://metadata.google.internal/computeMetadata/v1/instance/attributes/cf-tunnel-token" -H "Metadata-Flavor: Google")
DOCKER_TAG=$(curl -sf "http://metadata.google.internal/computeMetadata/v1/instance/attributes/docker-tag" -H "Metadata-Flavor: Google")

echo "Queue ID: $QUEUE_ID | Run ID: $RUN_ID | Tag: $DOCKER_TAG"

# 1. Pull immagini Docker — versione SIMUL con hash commit
docker pull trading/market-simulator:${DOCKER_TAG}
docker pull trading/broker-mock:${DOCKER_TAG}
docker pull trading/decision-engine:${DOCKER_TAG}
docker pull trading/sim-controller:${DOCKER_TAG}

# 2. Avvia Cloudflare Tunnel per accesso remoto
cloudflared tunnel --token ${CF_TOKEN} \
  --hostname simul.trading.expovin.it \
  --url http://localhost:3030 &

# 3. Avvia servizi con docker-compose
DB_URL=${DB_URL} QUEUE_ID=${QUEUE_ID} RUN_ID=${RUN_ID} DOCKER_TAG=${DOCKER_TAG} \
  docker-compose -f /opt/sim/docker-compose.sim.yml up -d

echo "=== Servizi avviati, attendo sim-controller ==="

# 4. Attendi che il sim-controller sia healthy
MAX_WAIT=120
ELAPSED=0
until curl -sf http://localhost:3030/status/health > /dev/null; do
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo "TIMEOUT: sim-controller non risponde"
    exit 1
  fi
done

# 5. Lancia la simulazione (il sim-controller legge la config dal DB via QUEUE_ID)
curl -sf -X POST http://localhost:3030/sim/start \
  -H "Content-Type: application/json" \
  -d "{\"queue_id\": \"${QUEUE_ID}\", \"run_id\": \"${RUN_ID}\"}"

echo "=== Simulazione avviata ==="
```

### 5.2 Provisioning GCP dal sim-scheduler

```javascript
// sim-scheduler/lib/provisioner.js

async function provisionSpotInstance(sim, spotPrice) {
  const instanceName = `sim-${sim.queue_id.slice(0,8)}-${Date.now()}`;
  const dockerTag    = `SIMUL-${GIT_COMMIT_HASH}`; // tag con hash commit

  const config = {
    name: instanceName,
    machineType: `zones/${GCP_ZONE}/machineTypes/${sim.required_instance_type}`,
    scheduling: {
      provisioningModel: 'SPOT',
      instanceTerminationAction: 'DELETE',
    },
    disks: [{
      boot: true,
      autoDelete: true,
      initializeParams: { sourceImage: 'projects/cos-cloud/global/images/family/cos-stable' },
    }],
    metadata: {
      items: [
        { key: 'queue-id',      value: sim.queue_id },
        { key: 'run-id',        value: sim.run_id ?? '' },
        { key: 'db-url',        value: DB_URL },
        { key: 'cf-tunnel-token', value: CF_TUNNEL_TOKEN },
        { key: 'docker-tag',    value: dockerTag },
        { key: 'startup-script', value: fs.readFileSync('./sim-startup.sh', 'utf-8') },
      ],
    },
  };

  const [operation] = await computeClient.instances.insert({
    project: GCP_PROJECT,
    zone:    GCP_ZONE,
    requestBody: config,
  });

  await db.update('sim_queue', sim.queue_id, {
    status:      'RUNNING',
    instance_id: instanceName,
    launched_at: new Date(),
  });

  // Aggiorna sim_runs con i dettagli della spot instance
  if (sim.run_id) {
    await db.update('sim_runs', sim.run_id, {
      spot_provider:       spotPrice.provider,
      spot_region:         spotPrice.region,
      spot_instance_type:  sim.required_instance_type,
      spot_price_per_hour: spotPrice.price,
      status:              'RUNNING',
    });
  }

  logger.info(`[provisioner] istanza ${instanceName} avviata su ${spotPrice.provider}`);
  return instanceName;
}
```

### 5.3 docker-compose.sim.yml

```yaml
version: '3.8'

services:
  market-simulator:
    image: trading/market-simulator:${DOCKER_TAG}
    ports: ["3010:3010"]
    environment:
      - NODE_ENV=simulation
      - DB_URL=${DB_URL}
    restart: "no"

  broker-mock:
    image: trading/broker-mock:${DOCKER_TAG}
    ports: ["3020:3020"]
    environment:
      - NODE_ENV=simulation
      - DB_URL=${DB_URL}
      - SLIPPAGE_PCT=0.001
      - COMMISSION_PCT=0.0005
    restart: "no"

  decision-engine:
    image: trading/decision-engine:${DOCKER_TAG}
    ports: ["3001:3001"]
    environment:
      - NODE_ENV=simulation
      - DB_URL=${DB_URL}
      - BROKER_URL=http://broker-mock:3020
      - MARKETDATASERVICE_URL=http://market-simulator:3010
    restart: "no"

  sim-controller:
    image: trading/sim-controller:${DOCKER_TAG}
    ports: ["3030:3030"]
    environment:
      - NODE_ENV=simulation
      - DB_URL=${DB_URL}
      - QUEUE_ID=${QUEUE_ID}
      - RUN_ID=${RUN_ID}
      - MARKET_SIM_URL=http://market-simulator:3010
      - BROKER_URL=http://broker-mock:3020
      - DE_URL=http://decision-engine:3001
    depends_on:
      - market-simulator
      - broker-mock
      - decision-engine
    restart: "no"
```

---

## 6. Checkpoint e resume

### 6.1 Schema sim_checkpoints

```sql
CREATE TABLE sim_checkpoints (
  run_id              UUID NOT NULL REFERENCES sim_runs(run_id),
  checkpoint_date     DATE NOT NULL,
    -- data virtuale SimClock al momento del checkpoint
    -- la run riprenderà dal giorno successivo a questa data
  PRIMARY KEY (run_id, checkpoint_date),

  -- Stato broker mock (tutto il necessario per ripristinare il portafoglio)
  cash                DECIMAL(15,2) NOT NULL,
  open_positions      JSONB NOT NULL DEFAULT '[]',
    -- [{ ticker, qty, avgCost, direction, mae, mfe, entryDate,
    --    tp_adjustments, sl_adjustments, candles_to_fill }]
  pending_orders      JSONB NOT NULL DEFAULT '[]',
    -- ordini non ancora fillati al momento del checkpoint
  
  -- Metriche di avanzamento
  tick_count          INT NOT NULL,
  trades_count        INT NOT NULL DEFAULT 0,
    -- trade chiusi fino a questo punto (per verifica integrità al resume)
  
  -- Timing
  wall_time_elapsed_sec INT NOT NULL DEFAULT 0,
    -- secondi reali già consumati in tutti i segmenti precedenti
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sim_checkpoints_run ON sim_checkpoints(run_id, checkpoint_date DESC);
```

### 6.2 Scrittura checkpoint (ogni EOD virtuale)

```javascript
// sim-controller/lib/checkpointer.js
const SimClock = require('../../shared/SimClock');

async function writeCheckpoint(runId, startedAt) {
  const account   = await fetch(`${BROKER_URL}/account`).then(r => r.json());
  const positions = await fetch(`${BROKER_URL}/positions`).then(r => r.json());
  const orders    = await fetch(`${BROKER_URL}/orders`).then(r => r.json());
  const tradesCount = await db.count('sim_trades', { run_id: runId, exit_date: { not: null } });

  await db.upsert('sim_checkpoints', {
    run_id:               runId,
    checkpoint_date:      SimClock.dayOf(),
    cash:                 account.data.cash,
    open_positions:       positions.data,
    pending_orders:       orders.pending,
    tick_count:           simLoop.tickCount,
    trades_count:         tradesCount,
    wall_time_elapsed_sec: Math.floor((Date.now() - startedAt) / 1000),
  });
}

// Registra il listener EOD
SimScheduler.on('eod', async ({ date }) => {
  await writeCheckpoint(currentRunId, sessionStartedAt);
});
```

### 6.3 Resume al riavvio

```javascript
// sim-controller/lib/resumeManager.js

async function initSession(queueId) {
  const queue = await db.queryOne('SELECT * FROM sim_queue WHERE queue_id = $1', [queueId]);
  const simConfig = queue.sim_config;

  // Nuova run vs resume
  if (!queue.run_id) {
    // Prima esecuzione — crea sim_run
    const runId = await createSimRun(simConfig);
    await db.update('sim_queue', queueId, { run_id: runId });
    return { runId, startDate: simConfig.startDate, isResume: false };
  }

  // Resume — leggi checkpoint più recente
  const checkpoint = await db.queryOne(
    `SELECT * FROM sim_checkpoints WHERE run_id = $1 ORDER BY checkpoint_date DESC LIMIT 1`,
    [queue.run_id]
  );

  if (!checkpoint) {
    // run_id esiste ma nessun checkpoint (fallita prima del primo EOD)
    // Ricomincia dall'inizio
    return { runId: queue.run_id, startDate: simConfig.startDate, isResume: false };
  }

  // Ripristina stato broker mock
  await fetch(`${BROKER_URL}/reset`, {
    method: 'POST',
    body: JSON.stringify({
      initialCash:   checkpoint.cash,
      openPositions: checkpoint.open_positions,
      pendingOrders: checkpoint.pending_orders,
    }),
  });

  // Il giorno di ripresa è il successivo al checkpoint
  const resumeDate = addTradingDay(checkpoint.checkpoint_date);

  logger.info(`[resume] ripresa da ${resumeDate} (checkpoint: ${checkpoint.checkpoint_date})`);
  logger.info(`[resume] portafoglio ripristinato: cash=${checkpoint.cash} positions=${checkpoint.open_positions.length}`);

  // Aggiorna wall time precedente
  previousWallTimeSec = checkpoint.wall_time_elapsed_sec;

  return { runId: queue.run_id, startDate: resumeDate, isResume: true };
}
```

---

## 7. Preemption handler

### 7.1 Tempi di preavviso per provider

| Provider | Preavviso | Segnale | Note |
|---|---|---|---|
| GCP | 30 secondi | SIGTERM | Poi SIGKILL dopo 30s |
| Azure | 30 secondi | SIGTERM | Eviction notice via Scheduled Events |
| AWS | 2 minuti | SIGTERM | Spot interruption notice — più tempo per cleanup |

30 secondi è il vincolo più stretto. Il checkpoint deve completarsi in meno di 5 secondi per stare ampiamente nel margine.

### 7.2 Implementazione

```javascript
// sim-controller/lib/preemptionHandler.js
const SimClock = require('../../shared/SimClock');

let isHandlingPreemption = false;

process.on('SIGTERM', async () => {
  if (isHandlingPreemption) return;
  isHandlingPreemption = true;

  const startMs = Date.now();
  logger.warn('[preemption] SIGTERM ricevuto — avvio flush checkpoint');

  try {
    // 1. Ferma il loop tick immediatamente
    simLoop.pause();

    // 2. Legge stato corrente dal broker mock
    const [account, positions, orders] = await Promise.all([
      fetch(`${BROKER_URL}/account`).then(r => r.json()),
      fetch(`${BROKER_URL}/positions`).then(r => r.json()),
      fetch(`${BROKER_URL}/orders`).then(r => r.json()),
    ]);

    // 3. Scrive checkpoint (operazione singola atomica)
    const tradesCount = await db.count('sim_trades', {
      run_id: currentRunId, exit_date: { not: null }
    });

    await db.upsert('sim_checkpoints', {
      run_id:               currentRunId,
      checkpoint_date:      SimClock.dayOf(),
      cash:                 account.data.cash,
      open_positions:       positions.data,
      pending_orders:       orders.pending,
      tick_count:           simLoop.tickCount,
      trades_count:         tradesCount,
      wall_time_elapsed_sec: previousWallTimeSec +
        Math.floor((Date.now() - sessionStartedAt) / 1000),
    });

    // 4. Aggiorna sim_runs e sim_queue
    await Promise.all([
      db.update('sim_runs', currentRunId, {
        status:           'PAUSED',
        last_checkpoint:  SimClock.dayOf(),
        preemption_count: currentPreemptionCount + 1,
      }),
      db.update('sim_queue', currentQueueId, {
        status:           'PAUSED',
        preemption_count: currentPreemptionCount + 1,
      }),
    ]);

    const elapsed = Date.now() - startMs;
    logger.info(`[preemption] checkpoint salvato in ${elapsed}ms — data: ${SimClock.dayOf()}`);

  } catch (err) {
    logger.error(`[preemption] flush fallito: ${err.message}`);
    await db.update('sim_runs', currentRunId, { status: 'INTERRUPTED' }).catch(() => {});
  } finally {
    process.exit(0);
  }
});
```

### 7.3 Comportamento del sim-scheduler al rilevamento PAUSED

Il sim-scheduler controlla le run in stato `PAUSED` ad ogni ciclo di polling e le rilancia automaticamente con la stessa logica di una run nuova — ma passando il `run_id` esistente al sim-controller, che leggerà il checkpoint.

```javascript
// In schedulerLoop():
const paused = await db.query(
  `SELECT q.*, r.preemption_count
   FROM sim_queue q
   JOIN sim_runs r ON q.run_id = r.run_id
   WHERE q.status = 'PAUSED'
   AND r.preemption_count < $1   -- max tentativi configurabile
   ORDER BY q.updated_at ASC`,
  [MAX_PREEMPTION_RETRIES]        // default: 10
);
```

Se `preemption_count` supera `MAX_PREEMPTION_RETRIES`, la run viene marcata `FAILED` con un log esplicativo — potrebbe indicare un problema strutturale (tipo di istanza non disponibile in quella regione, prezzo sempre sopra soglia).

---

## 8. Cost tracking

### 8.1 Lettura prezzo spot dall'interno della VM

GCP espone il prezzo spot corrente tramite il metadata server, accessibile solo dall'interno della VM:

```javascript
// sim-controller/lib/costTracker.js

async function readSpotPrice() {
  try {
    // Solo su GCP — restituisce il prezzo $/ora corrente
    const resp = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/scheduling/preemptible',
      { headers: { 'Metadata-Flavor': 'Google' }, timeout: 2000 }
    );
    const isPreemptible = (await resp.text()) === 'true';
    if (!isPreemptible) return null;

    // Il prezzo preciso è nella Cloud Billing API — qui usiamo il valore
    // già registrato dal scheduler al momento del provisioning
    return null; // il sim-controller legge spot_price_per_hour da sim_runs
  } catch {
    return null; // non su GCP, o metadata non accessibile
  }
}

// Calcola e aggiorna il costo effettivo a fine run o a ogni checkpoint
async function updateActualCost(runId, startedAt) {
  const run = await db.queryOne('SELECT * FROM sim_runs WHERE run_id = $1', [runId]);
  if (!run?.spot_price_per_hour) return;

  const totalWallTimeSec = previousWallTimeSec +
    Math.floor((Date.now() - startedAt) / 1000);

  const actualCost = run.spot_price_per_hour * (totalWallTimeSec / 3600);

  await db.update('sim_runs', runId, {
    spot_actual_cost:    parseFloat(actualCost.toFixed(6)),
    total_wall_time_sec: totalWallTimeSec,
  });
}
```

### 8.2 Stima costo pre-lancio

Prima di lanciare, il sim-scheduler calcola la stima basandosi sulla durata attesa:

```javascript
function estimateCost(spotPricePerHour, estimatedDurationMin) {
  return spotPricePerHour * (estimatedDurationMin / 60);
}

// Durata attesa per daily tf (da analisi velocità):
// 6 mesi → ~4 sec → praticamente zero
// 18 mesi → ~11 sec → praticamente zero
// 18 mesi orarie → ~73 sec → ~$0.002 su n2-standard-4 a $0.10/ora
// 18 mesi 15min → ~5 min → ~$0.008
//
// Per simulazioni con parameter sweep (es. 20 run parallele 18mo daily):
// 20 × $0.001 = $0.02 totali — costo trascurabile
```

---

## 9. Multi-provider — GCP, AWS, Azure

### 9.1 Oggi (GCP)

GCP è il provider naturale: stesso ecosistema della VM principale, zero costi di egress verso il DB, Spot VMs fino al 91% di sconto, prezzi stabili (cambiano al massimo una volta al giorno).

### 9.2 Roadmap multi-provider

L'astrazione è già nel price fetcher — aggiungere un nuovo provider richiede solo:
1. Implementare `fetchXXXPrice(instanceType)` nel price fetcher
2. Implementare `provisionXXXInstance(sim, spotPrice)` nel provisioner
3. Aggiungere la logica di startup script per il nuovo provider (sostanzialmente identica)

La logica di business del sim-controller, del checkpoint e dei risultati è completamente indipendente dal provider.

### 9.3 Confronto preavvisi preemption

AWS dà 2 minuti di preavviso contro i 30 secondi di GCP e Azure. Questo rende AWS particolarmente interessante per simulazioni che richiedono checkpoint più pesanti in futuro (es. stato in-memory molto grande). Per ora 30 secondi è più che sufficiente — il checkpoint è una singola transazione DB da < 5 secondi.

### 9.4 Selezione automatica provider

Con `preferred_provider = 'ANY'`, il sim-scheduler interroga tutti i provider e sceglie il più economico tra quelli sotto soglia. Questo permette di pagare sempre il prezzo minimo di mercato indipendentemente da dove gira la sim.

```javascript
// Esempio di selezione con ANY:
// GCP n2-standard-4:   $0.048/ora
// AWS c5.xlarge:       $0.062/ora  (comparabile)
// Azure D4s_v5:        $0.041/ora  ← scelto (più economico)
```

---

## 10. Campi aggiuntivi in sim_runs

Aggiungere alla tabella `sim_runs` esistente:

```sql
ALTER TABLE sim_runs ADD COLUMN spot_provider          VARCHAR(10);
ALTER TABLE sim_runs ADD COLUMN spot_region            VARCHAR(40);
ALTER TABLE sim_runs ADD COLUMN spot_instance_type     VARCHAR(40);
ALTER TABLE sim_runs ADD COLUMN spot_price_per_hour    DECIMAL(8,6);
ALTER TABLE sim_runs ADD COLUMN spot_actual_cost       DECIMAL(10,6);
  -- costo reale = price × (total_wall_time_sec / 3600)
  -- aggiornato a ogni checkpoint e a fine run
ALTER TABLE sim_runs ADD COLUMN preemption_count       INT DEFAULT 0;
ALTER TABLE sim_runs ADD COLUMN total_wall_time_sec    INT;
  -- tempo reale totale inclusi tutti i segmenti (pre e post preemption)
ALTER TABLE sim_runs ADD COLUMN last_checkpoint        DATE;
  -- data virtuale dell'ultimo checkpoint scritto
ALTER TABLE sim_runs ADD COLUMN docker_tag             VARCHAR(60);
  -- es. SIMUL-a3f9c2b — per riproducibilità assoluta
```

### 10.1 Query utili per analisi costi

```sql
-- Confronto stima vs costo reale per tutte le run
SELECT
  run_id,
  sim_label,
  spot_provider,
  spot_instance_type,
  spot_price_per_hour,
  estimated_cost_usd,
  spot_actual_cost,
  ROUND((spot_actual_cost / NULLIF(estimated_cost_usd, 0) - 1) * 100, 1) AS cost_variance_pct,
  preemption_count,
  total_wall_time_sec,
  status
FROM sim_runs
JOIN sim_queue USING (run_id)
ORDER BY created_at DESC;

-- Run per provider con costo medio
SELECT
  spot_provider,
  COUNT(*) AS runs,
  AVG(spot_price_per_hour) AS avg_price,
  AVG(spot_actual_cost) AS avg_cost,
  SUM(spot_actual_cost) AS total_cost,
  AVG(preemption_count) AS avg_preemptions
FROM sim_runs
WHERE status = 'COMPLETED'
GROUP BY spot_provider;

-- Parameter sweep: confronto performance tra varianti
SELECT
  q.sim_label,
  r.total_return_pct,
  r.sharpe_ratio,
  r.max_drawdown_pct,
  r.win_rate,
  r.spot_actual_cost,
  r.total_wall_time_sec
FROM sim_runs r
JOIN sim_queue q ON r.run_id = q.run_id
WHERE q.sim_label LIKE 'sweep_%'
ORDER BY r.sharpe_ratio DESC;
```

---

## 11. Cloudflare Tunnel e accesso remoto

### 11.1 Setup

Il tunnel viene avviato nello startup script e distrutto automaticamente con la VM. Non richiede configurazione DNS manuale — il nome `simul.trading.expovin.it` è pre-configurato nel Cloudflare dashboard e viene attivato/disattivato dal tunnel.

```bash
# Avvio nel sim-startup.sh
cloudflared tunnel --token ${CF_TUNNEL_TOKEN} \
  --hostname simul.trading.expovin.it \
  --url http://localhost:3030 \
  --name sim-$(date +%s) &

echo "Tunnel attivo su simul.trading.expovin.it"
```

### 11.2 Endpoint utili durante la run

Accessibili via `https://simul.trading.expovin.it` durante l'esecuzione:

```
GET  /status/health          → health check del sim-controller
GET  /sim/status             → stato corrente della run (tick, data virtuale, P&L running)
GET  /sim/checkpoint/latest  → ultimo checkpoint scritto
POST /sim/pause              → pausa manuale la simulazione (senza preemption)
POST /sim/resume             → riprende dopo pausa manuale
GET  /session                → stato sessione market-simulator
GET  /subscriptions          → ticker attivi
```

### 11.3 Sicurezza

Il Cloudflare Tunnel autentica automaticamente le connessioni tramite il token. Per ulteriore sicurezza, il sim-controller in modalità SIMUL accetta connessioni solo con JWT firmato con la chiave di servizio — stessa infrastruttura auth già in uso nel sistema principale.

---

## 12. Piano di implementazione

### Sprint A — sim-scheduler base (prerequisito)

**Obiettivo:** scheduling automatico con polling GCP, senza preemption handling.

- Microservizio `sim-scheduler` con loop polling ogni 5 minuti
- Price fetcher GCP (Cloud Billing API o approssimazione)
- Provisioning GCP spot instance con startup script
- `sim_queue` schema e CRUD
- Teardown sicuro: attende `status=COMPLETED` sul DB prima di distruggere
- Test: accodare una sim, verificare lancio automatico e completamento

**Stima:** 3-4 giorni

---

### Sprint B — checkpoint e preemption handler

**Obiettivo:** simulazioni resilienti alla preemption.

- Schema `sim_checkpoints`
- Scrittura checkpoint ad ogni EOD virtuale nel sim-controller
- Preemption handler con SIGTERM nel sim-controller
- Resume manager: ripristino stato broker mock dal checkpoint
- Rilevamento `PAUSED` nel scheduler e rilancio automatico
- Test: simulare SIGTERM manuale durante una run, verificare resume corretto

**Stima:** 3-4 giorni

---

### Sprint C — cost tracking e reporting

**Obiettivo:** visibilità completa sui costi.

- Campi spot in `sim_runs` (ALTER TABLE)
- Lettura prezzo spot dal metadata server GCP
- Calcolo `spot_actual_cost` a ogni checkpoint e a fine run
- Stima costo pre-lancio nel sim-scheduler
- Query di analisi costi (confronto stima/reale, breakdown per provider)

**Stima:** 1-2 giorni

---

### Sprint D — multi-provider (fase avanzata)

**Obiettivo:** selezione automatica del provider più economico.

- Price fetcher AWS (SpotPrice API)
- Price fetcher Azure (Retail Prices API pubblica)
- Provisioner AWS e Azure
- Test: `preferred_provider = ANY`, verificare selezione automatica provider

**Stima:** 3-4 giorni

---

### Sprint E — parameter sweep e monitoring

**Obiettivo:** esecuzione parallela di N varianti della stessa sim.

- Accodamento batch: un comando crea N entry in `sim_queue` con parametri diversi
- Dashboard minimalista: lista run con stato, prezzo, P&L parziale
- Alert se una run rimane in `PAUSED` oltre N ore senza rilancio

**Stima:** 2-3 giorni

---

## 13. Note operative

**Soglia di prezzo.** Impostare `max_price_threshold` con un margine rispetto al prezzo tipico — es. se il prezzo medio è $0.05/ora, impostare $0.08/ora. Troppo rigido e la sim non parte mai; troppo alto e si perde il beneficio dello spot. Una buona regola: soglia = prezzo medio × 1.5.

**Tipo di istanza.** La raccomandazione HW dettagliata con stime di tempi per tf 15min e 5min è nella sezione 14. Per run singole su daily tf, una `n2-standard-4` è sufficiente. Per parameter sweep con 10 run parallele su 15min o 5min, vedere la raccomandazione in §14.4.

**Preemption count.** Se una run accumula più di 3-4 preemption sulla stessa regione/zona, considerare di cambiare zona nel rilancio — potrebbe indicare alta domanda di capacità in quella AZ.

**Checkpoint granularità.** Il checkpoint ogni EOD virtuale è la granularità giusta per daily tf. Per 15min e 5min, dove ogni giorno simulato contiene migliaia di tick, il checkpoint va fatto ogni N giornate virtuali (es. ogni 5 giorni) per ridurre il rischio di perdita dati in caso di preemption. Vedere §14.3 per la stima del dato perso per tf.

**Docker tag e riproducibilità.** Usare sempre tag con hash commit (`SIMUL-a3f9c2b`) nelle run ufficiali. Il tag `SIMUL` senza hash è accettabile solo per test rapidi. Il `docker_tag` viene salvato in `sim_runs` — questo garantisce che sia sempre possibile ricreare esattamente l'ambiente di una run specifica.

**Costo reale vs stima.** Per tf 15min e 5min il costo diventa rilevante — vedere §14.5 per le stime di costo per scenario. Monitorare il budget mensile con un alert su `SUM(spot_actual_cost)`.

---

## 14. Analisi tempi e dimensionamento HW

### 14.1 Parametri di base — volumi fissi

Questi parametri sono indipendenti dal timeframe e valgono per tutti gli scenari:

| Parametro | Valore | Note |
|---|---|---|
| Giorni di trading in 18 mesi | 378 | 252/anno × 1.5 |
| Aggiornamenti universo | 6 | ogni 3 mesi |
| Ticker universo (tickerscanner) | 500+ | input al ranking giornaliero |
| Ticker watchlist (post-ranking) | 75 | media top 50-100 |
| Sessione di mercato US | 6.5 ore | 09:30–16:00 ET |

### 14.2 Volumi tick per timeframe

| Timeframe | Candele/sessione/ticker | Tick intraday/giorno | Tick intraday totali (18m) |
|---|---|---|---|
| **15 min** | 26 | 26 × 75 = **1.950** | 1.950 × 378 = **~737.000** |
| **5 min** | 78 | 78 × 75 = **5.850** | 5.850 × 378 = **~2.211.000** |

A questi si aggiungono i **tick condivisi** (stessi per tutte le run parallele):

| Fase condivisa | Frequenza | Tick/operazioni | Totale 18 mesi |
|---|---|---|---|
| Tickerscanner (aggiorna universo) | ogni 3 mesi | 500+ ticker | 6 esecuzioni |
| BOD ranking + scoring | ogni giorno | 500 ticker ranked | 378 esecuzioni |
| EOD batch | ogni giorno | 1 op per run | 378 × N run |

### 14.3 Stima tempo per giorno simulato — singola run

Le fasi si dividono in due categorie nette:

**Fasi condivise** — eseguite una sola volta per giorno simulato, indipendentemente dal numero di run parallele. Il risultato (universo, ranking, watchlist) viene scritto in Redis e letto da tutti i worker.

| Fase | Senza Redis | Con Redis pre-calcolato | Note |
|---|---|---|---|
| Tickerscanner (ammortizzato) | ~65 ms/gg | ~0.5 ms/gg | Pre-calcolato in `ticker_universe_quarterly` |
| BOD ranking + scoring | ~1.000 ms | ~2 ms | Pre-calcolato in `ast_ranking_daily` |
| EOD batch + snapshot | ~200 ms | ~200 ms | Scrittura locale SQLite |
| **Totale fasi condivise** | **~1.265 ms** | **~202 ms** | |

**Fasi parallele** — eseguite da ogni worker in modo indipendente, ognuno con la propria configurazione di parametri. La latenza per tick è dominata dalla logica DE + broker mock, con dati già in Redis.

| Timeframe | Tick/giorno | Latenza/tick (Redis) | Totale intraday/giorno |
|---|---|---|---|
| **15 min** | 1.950 | ~1 ms | **~1.950 ms ≈ 2s** |
| **5 min** | 5.850 | ~1 ms | **~5.850 ms ≈ 6s** |

**Tempo totale per giorno simulato (singola run, con Redis locale):**

| Timeframe | Fasi condivise | Fasi parallele | Totale/giorno |
|---|---|---|---|
| **15 min** | ~202 ms | ~1.950 ms | **~2.2 s** |
| **5 min** | ~202 ms | ~5.850 ms | **~6.1 s** |

### 14.4 Stima durata simulazione 18 mesi — singola run vs 10 run parallele

**Chiave:** le fasi condivise si eseguono una volta sola anche con 10 run parallele. Le fasi parallele si eseguono simultaneamente su tutti i worker — il tempo rimane quello di una singola run se i core sono sufficienti.

#### Scenario A — Timeframe 15 min

| Configurazione | Fasi condivise (378 gg) | Fasi parallele (378 gg) | Durata totale | Note |
|---|---|---|---|---|
| 1 run, senza ottimiz. | ~8 min | ~82 min | **~90 min** | Tutto da DB remoto |
| 1 run, con Redis | ~1.3 min | ~12.3 min | **~14 min** | Redis preloaded |
| 10 run parallele, Redis | ~1.3 min (condivise) | ~12.3 min (parallele) | **~14 min** | Stesso tempo di 1 run |
| 10 run, Redis + tick async | ~1.3 min | ~4 min | **~5 min** | 75 ticker async per tick |

#### Scenario B — Timeframe 5 min

| Configurazione | Fasi condivise (378 gg) | Fasi parallele (378 gg) | Durata totale | Note |
|---|---|---|---|---|
| 1 run, senza ottimiz. | ~8 min | ~247 min | **~255 min** | Tutto da DB remoto |
| 1 run, con Redis | ~1.3 min | ~38 min | **~39 min** | Redis preloaded |
| 10 run parallele, Redis | ~1.3 min (condivise) | ~38 min (parallele) | **~39 min** | Stesso tempo di 1 run |
| 10 run, Redis + tick async | ~1.3 min | ~12 min | **~13 min** | 75 ticker async per tick |

> **Nota sul tick async:** processare i 75 ticker della watchlist in parallelo dentro ogni tick (Promise.all su 75 letture Redis + logica DE) riduce il tempo per tick da ~1ms a ~0.3ms. Con Node.js e I/O async questo è ottenibile senza multi-threading — basta non serializzare le letture Redis.

### 14.5 Volume dati da pre-caricare in Redis all'avvio

| Dataset | Cardinalità | Dimensione | Tempo caricamento |
|---|---|---|---|
| Candele 15min watchlist (75 × 26 × 378) | ~735.000 | ~74 MB | ~8s |
| Candele 5min watchlist (75 × 78 × 378) | ~2.205.000 | ~220 MB | ~22s |
| Candele daily universo (500 × 378) | ~189.000 | ~19 MB | ~3s |
| Ranking pre-calcolato (500 × 378) | ~189.000 | ~25 MB | ~3s |
| Liquidity index (378 giorni) | 378 | ~0.1 MB | &lt;1s |
| Fondamentali universo (500 × 6 trimestri) | ~3.000 | ~2 MB | &lt;1s |
| **Totale — 15 min** | **~1.1M entries** | **~120 MB** | **~15s** |
| **Totale — 5 min** | **~2.6M entries** | **~266 MB** | **~29s** |

Il preloading avviene una volta sola all'avvio della spot instance. È condiviso da tutte le run parallele — non si moltiplica per N.

### 14.6 Stima costo spot GCP per scenario

Prezzi spot GCP indicativi (regione us-central1, soggetti a variazione):

| Istanza | vCPU | RAM | Prezzo spot/ora | Prezzo on-demand/ora |
|---|---|---|---|---|
| `n2-standard-4` | 4 | 16 GB | ~$0.04 | ~$0.19 |
| `n2-standard-8` | 8 | 32 GB | ~$0.08 | ~$0.38 |
| `n2-standard-16` | 16 | 64 GB | ~$0.16 | ~$0.76 |
| `n2-highmem-16` | 16 | 128 GB | ~$0.22 | ~$1.06 |
| `c3-standard-22` | 22 | 88 GB | ~$0.19 | ~$0.93 |

| Scenario | Durata sim | Istanza consigliata | Costo stimato |
|---|---|---|---|
| 1 run, 15 min, con Redis | ~14 min | `n2-standard-4` | ~$0.01 |
| 10 run parallele, 15 min | ~14 min | `n2-standard-16` | ~$0.04 |
| 1 run, 5 min, con Redis | ~39 min | `n2-standard-4` | ~$0.03 |
| 10 run parallele, 5 min | ~39 min | `n2-standard-16` | ~$0.10 |
| 10 run parallele, 5 min, tick async | ~13 min | `n2-standard-16` | ~$0.03 |

### 14.7 Raccomandazione VM per 10 run parallele

#### Requisiti da soddisfare

- 10 worker Node.js in parallelo → minimo 10 core dedicati
- Redis locale con ~266 MB di dati (5min) → RAM sufficiente per Redis + processi
- SQLite locale su SSD veloce → disco NVMe locale preferibile
- Headroom per db-writer, preloader, sim-controller → 2-4 core aggiuntivi

#### Raccomandazione: `n2-highmem-16`

| Spec | Valore | Motivazione |
|---|---|---|
| vCPU | 16 | 10 worker + 2 Redis/infra + 2 db-writer/controller + 2 headroom |
| RAM | 128 GB | Redis 266 MB + 10 processi Node (~500 MB ciascuno) + OS = ~6 GB totali — ampio margine per crescere |
| Disco | SSD persistente 50 GB | SQLite risultati + logs. NVMe locale opzionale per massima velocità scrittura |
| Rete | 32 Gbps | Più che sufficiente per il preloading e la scrittura finale su DB |
| Prezzo spot | ~$0.22/ora | Per 10 run 5min in ~13 min = **~$0.05 per sweep completo** |

> Con `n2-highmem-16` si ha RAM abbondante per espandere a 20-30 run parallele in futuro senza cambiare VM — basta aggiungere worker. Il limite diventa la CPU (16 core), non la RAM.

#### Alternativa più economica: `c3-standard-22`

22 core a ~$0.19/ora spot — più core della highmem-16 a prezzo inferiore, ma con "solo" 88 GB di RAM. Per 10 run parallele su 5min è più che sufficiente, e i core aggiuntivi permettono tick async più aggressivo.

#### Quando serve di più

| Quando | Istanza | Note |
|---|---|---|
| 20+ run parallele | `n2-highmem-32` | 32 core, 256 GB RAM, ~$0.44/ora spot |
| GPU per ranking ML futuro | `n1-standard-8` + T4 | Solo se il ranking evolve verso modelli ML |
| Massimo throughput assoluto | `c3-highcpu-44` | 44 core, 88 GB, ~$0.38/ora spot |
