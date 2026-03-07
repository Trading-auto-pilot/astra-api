# BaseService Migration Example

This document provides a step-by-step example of migrating the `decision-engine` microservice to use BaseService.

## Before Migration

### File Structure
```
decision-engine/
├── modules/
│   └── main.js          (~450 lines)
├── server.js            (~120 lines)
├── status.js            (~80 lines)
├── package.json
└── release.json
```

### main.js (Before) - 450 lines

```javascript
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const fs = require("fs").promises;
const createLogger = require("../../shared/logger");
const {
  initializeSettings,
  getSetting,
  getAllSettings,
  reloadSettings,
  setSetting,
} = require("../../shared/loadSettings");
const { RedisBus } = require("../../shared/redisBus");
const { publishEventsManifest } = require("../../shared/eventsManifestRegistry");
const { asBool, asInt } = require("../../shared/helpers");

const MICROSERVICE    = "decision-engine";
const MODULE_NAME     = "main";
const MODULE_VERSION  = "0.1.0";

class DecisionEngine {
  constructor() {
    // =====================================================
    // URL DI TUTTI I MICROSERVIZI STANDARD DEL SISTEMA
    // =====================================================
    this.dbmanagerUrl = process.env.DBMANAGER_URL || "http://dbmanager:3002";
    this.marketsimulatorUrl = process.env.MARKETSIMULATOR_URL || "http://marketsimulator:3003";
    this.ordersimulatorUrl = process.env.ORDERSIMULATOR_URL || "http://ordersimulator:3004";
    this.orderlistnerUrl = process.env.ORDERLISTNER_URL || "http://orderlistner:3005";
    this.cachemanagerUrl = process.env.CACHEMANAGER_URL || "http://cachemanager:3006";
    this.strategyUtilsUrl = process.env.STRATEGYUTILS_URL || "http://strategyUtils:3007";
    this.alertingserviceUrl = process.env.ALERTINGSERVICE_URL || "http://alertingservice:3008";
    this.capitalmanagerUrl = process.env.CAPITALMANAGER_URL || "http://capitalmanager:3009";
    this.smaUrl = process.env.SMA_URL || "http://sma:3010";
    this.sltpUrl = process.env.SLTP_URL || "http://sltp:3011";
    this.livemarketlistnerUrl = process.env.LIVEMARKETLISTNER_URL || "http://livemarketlistner:3012";
    this.tickerscannerUrl = process.env.TICKERSCANNER_URL || "http://tickerscanner:3013";
    this.schedulerUrl = process.env.SCHEDULER_URL || "http://scheduler:3014";
    this.authServiceUrl = process.env.AUTHSERVICE_URL || "http://authService:3015";
    this.servicecontrolplaneUrl = process.env.SERVICECONTROLPLANE_URL || "http://servicecontrolplane:3016";
    this.ibkrbridgeUrl = process.env.IBKRBRIDGE_URL || "http://ibkr-bridge:3017";
    this.decisionengineUrl = process.env.DECISIONENGINE_URL || "http://decision-engine:3018";

    // =====================================================
    // Ambiente
    // =====================================================
    this.env = process.env.ENV || "DEV";

    // =====================================================
    // Canali Redis standard
    // =====================================================
    this.redisTelemetyChannel = `${this.env}.${MICROSERVICE}.telemetry`;
    this.redisStatusChannel   = `${this.env}.${MICROSERVICE}.status`;
    this.redisDataChannel     = `${this.env}.${MICROSERVICE}.data`;
    this.redisLogsChannel     = `${this.env}.${MICROSERVICE}.logs`;
    this.redisEventsChannel   = `${this.env}.${MICROSERVICE}.events`;
    this.redisMarketDataChannel = `${this.env}.market-data-service.data`;
    this._marketDataSubscribed = false;
    this._marketDataHandlers = new Set();

    this._status       = "STARTING";
    this.statusDetails = null;

    // =====================================================
    // Configurazione standard dei canali del Redis Bus
    // =====================================================
    this.communicationChannels = {
      telemetry: { on: true, params: { intervalsMs: 1000 } },
      metrics:   { on: true, params: { intervalsMs: 1000 } },
      data:      { on: true, params: { intervalsMs: 0    } },
      logs:      { on: true, params: { intervalsMs: 0    } },
      events:    { on: true, params: { intervalsMs: 0    } },
    };

    // =====================================================
    // Redis BUS
    // =====================================================
    this.bus = new RedisBus({
      channels: this.communicationChannels,
      name: MICROSERVICE
    });

    // =====================================================
    // LOGGER
    // =====================================================
    process.env.MICROSERVICE_NAME = process.env.MICROSERVICE_NAME || MICROSERVICE;
    this.logger = createLogger(
      MICROSERVICE,
      MODULE_NAME,
      MODULE_VERSION,
      process.env.LOG_LEVEL || "info",
      {
        bus: null,
        busTopicPrefix: this.env,
        console: true,
        enqueueDb: true,
      }
    );

    this.bus.setLogger(this.logger);
    this.metrics = [];
  }

  async init() {
    this.logger.info("[init] Initializing...");

    // 1) CONNECT REDIS BUS
    await this.bus.connect();
    this.logger.attachBus(this.bus);
    await publishEventsManifest({
      bus: this.bus,
      logger: this.logger,
      microserviceName: MICROSERVICE,
      serviceRootDir: path.resolve(__dirname, ".."),
    });
    await this._maybeSubscribeMarketData();

    // STATUS: STARTING
    await this.bus.publish(this.redisStatusChannel, {
      status: "STARTING",
      details: "Loading DB settings"
    });

    // 2) LOAD SETTINGS DAL DB
    const ok = await initializeSettings(this.dbmanagerUrl);
    if (!ok) {
      this._status = "ERROR";
      this.statusDetails = "DB unreachable";
      await this.bus.publish(this.redisStatusChannel, {
        status: this._status,
        details: this.statusDetails
      });
      this.logger.error("[init] Failed DB initialization");
      process.exit(1);
    }

    // 3) APPLY COMMON SETTINGS
    this.delayBetweenMessages = asInt(
      getSetting("PROCESS_DELAY_BETWEEN_MESSAGES"),
      500
    );

    this.logger.info(
      `[init] Settings loaded: delayBetweenMessages=${this.delayBetweenMessages}`
    );

    // 4) HOOK EVENTUALE
    await this.afterInit();

    // 5) READY
    this._status = "READY";
    this.statusDetails = "Initialization complete";

    await this.bus.publish(this.redisStatusChannel, {
      status: this._status,
      details: this.statusDetails
    });
  }

  async afterInit() {
    this.logger.info("[afterInit] No custom logic implemented (template).");
  }

  async getReleaseInfo() {
    // ... 40 lines of release.json loading logic
  }

  async reloadSettings() {
    // ... 30 lines of settings reload logic
  }

  getAllSettings() {
    return getAllSettings();
  }

  setSetting(key, value) {
    return setSetting(key, value);
  }

  getMetricsSnapshot(max = 100) {
    return this.metrics.slice(-max);
  }

  pushMetric(metric) {
    metric.ts = Date.now();
    this.metrics.push(metric);
    if (this.metrics.length > 2000) this.metrics.shift();
  }

  normalizeChannels(inCfg = {}, prev = {}) {
    // ... 30 lines
  }

  async updateCommunicationChannel(newConf) {
    // ... 40 lines
  }

  getInfo() {
    return {
      MICROSERVICE,
      MODULE_NAME,
      MODULE_VERSION,
      STATUS: this._status,
      STATUS_DETAILS: this.statusDetails,
      ENV: this.env,
      communicationChannels: this.communicationChannels,
      BusChannels: {
        telemetry: this.redisTelemetyChannel,
        status:    this.redisStatusChannel,
        data:      this.redisDataChannel,
        logs:      this.redisLogsChannel,
        events:    this.redisEventsChannel,
      },
    };
  }

  async disconnect() {
    // ... 20 lines
  }

  addMarketDataHandler(handler) {
    // ... service-specific logic
  }

  _handleMarketDataMessage(parsed, raw) {
    // ... service-specific logic
  }

  async _maybeSubscribeMarketData() {
    // ... service-specific logic
  }

  getDbLogStatus() {
    // ... 10 lines
  }

  setDbLogStatus(status) {
    // ... 10 lines
  }

  getLogLevel() {
    // ... 10 lines
  }

  setLogLevel(level) {
    // ... 10 lines
  }

  getBus()    { return this.bus; }
  getLogger() { return this.logger; }
  get status() { return this._status; }
}

module.exports = DecisionEngine;
```

**Total:** ~450 lines
- **Boilerplate:** ~350 lines (78%)
- **Service-specific:** ~100 lines (22%)

---

## After Migration

### File Structure (Unchanged)
```
decision-engine/
├── modules/
│   └── main.js          (~140 lines) ⬇️ 69% reduction
├── server.js            (~120 lines) - no change
├── status.js            (~80 lines)  - no change
├── package.json
└── release.json
```

### main.js (After) - 140 lines

```javascript
"use strict";

const BaseService = require("../../shared/BaseService");

const MICROSERVICE    = "decision-engine";
const MODULE_NAME     = "main";
const MODULE_VERSION  = "3.3.0";

class DecisionEngine extends BaseService {
  constructor() {
    // Initialize BaseService with config
    super({
      microservice: MICROSERVICE,
      moduleName: MODULE_NAME,
      moduleVersion: MODULE_VERSION,
      customChannels: {
        // Service-specific channel
        redisMarketDataChannel: `${process.env.ENV || 'DEV'}.market-data-service.data`
      }
    });

    // =====================================================
    // SERVICE-SPECIFIC PROPERTIES ONLY
    // =====================================================
    this.redisMarketDataChannel = `${this.env}.market-data-service.data`;
    this._marketDataSubscribed = false;
    this._marketDataHandlers = new Set();
  }

  // =========================================================
  // Custom initialization - replaces afterInit()
  // =========================================================
  async _onInit() {
    this.logger.info("[_onInit] Setting up market data subscription...");
    await this._maybeSubscribeMarketData();
  }

  // =========================================================
  // SERVICE-SPECIFIC METHODS (unchanged)
  // =========================================================

  /**
   * Add a handler for market data messages
   */
  addMarketDataHandler(handler) {
    if (typeof handler !== "function") return () => {};
    this._marketDataHandlers.add(handler);
    return () => this._marketDataHandlers.delete(handler);
  }

  /**
   * Handle incoming market data message
   */
  _handleMarketDataMessage(parsed, raw) {
    if (!this.communicationChannels?.data?.on) return;

    const payload =
      parsed && typeof parsed === "object"
        ? parsed
        : typeof raw === "string"
          ? raw
          : String(raw);

    const printable =
      typeof payload === "string" ? payload : JSON.stringify(payload);

    this.logger.trace(`[marketData][${this.redisMarketDataChannel}] ${printable}`);

    for (const handler of this._marketDataHandlers) {
      try {
        handler(parsed, raw);
      } catch (err) {
        this.logger.warning(
          `[marketData] handler failed: ${err?.message || String(err)}`
        );
      }
    }
  }

  /**
   * Subscribe to market data channel if data channel is enabled
   */
  async _maybeSubscribeMarketData() {
    const dataOn = this.communicationChannels?.data?.on;
    if (!dataOn || this._marketDataSubscribed) return;

    try {
      await this.bus.subscribe(this.redisMarketDataChannel, (parsed, raw) => {
        this._handleMarketDataMessage(parsed, raw);
      });
      this._marketDataSubscribed = true;
      this.logger.info(`[marketData] subscribed to ${this.redisMarketDataChannel}`);
    } catch (e) {
      this.logger.warning(
        `[marketData] subscribe failed: ${e?.message || String(e)}`
      );
    }
  }

  // =========================================================
  // Hook: called when channels are updated
  // =========================================================
  async _onChannelUpdate(cfg) {
    // Re-subscribe if data channel was just enabled
    await this._maybeSubscribeMarketData();
  }

  // =========================================================
  // Hook: cleanup on shutdown
  // =========================================================
  async _onShutdown() {
    this.logger.info("[_onShutdown] Cleaning up market data handlers...");
    this._marketDataHandlers.clear();
  }
}

module.exports = DecisionEngine;
```

**Total:** ~140 lines
- **BaseService:** ~0 lines (inherited)
- **Service-specific:** ~140 lines (100%)

---

## Migration Steps

### Step 1: Backup Original File

```bash
cd /Users/vincenzo.esposito/code/trading-system/decision-engine
cp modules/main.js modules/main.js.backup
```

### Step 2: Update Imports

**Remove:**
```javascript
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const fs = require("fs").promises;
const createLogger = require("../../shared/logger");
const {
  initializeSettings,
  getSetting,
  getAllSettings,
  reloadSettings,
  setSetting,
} = require("../../shared/loadSettings");
const { RedisBus } = require("../../shared/redisBus");
const { publishEventsManifest } = require("../../shared/eventsManifestRegistry");
const { asBool, asInt } = require("../../shared/helpers");
```

**Add:**
```javascript
const BaseService = require("../../shared/BaseService");
```

### Step 3: Update Constructor

**Remove 300+ lines of boilerplate:**
- Service URLs (17 lines)
- Environment setup (3 lines)
- Redis channel names (6 lines)
- Communication channels config (7 lines)
- RedisBus initialization (5 lines)
- Logger initialization (12 lines)
- Metrics array (1 line)

**Replace with:**
```javascript
constructor() {
  super({
    microservice: MICROSERVICE,
    moduleName: MODULE_NAME,
    moduleVersion: MODULE_VERSION,
    customChannels: {
      redisMarketDataChannel: `${process.env.ENV || 'DEV'}.market-data-service.data`
    }
  });

  // Service-specific properties only
  this.redisMarketDataChannel = `${this.env}.market-data-service.data`;
  this._marketDataSubscribed = false;
  this._marketDataHandlers = new Set();
}
```

### Step 4: Replace init() with _onInit()

**Remove entire init() method (80 lines)**

**Add hook:**
```javascript
async _onInit() {
  this.logger.info("[_onInit] Setting up market data subscription...");
  await this._maybeSubscribeMarketData();
}
```

### Step 5: Remove Standard Methods

**Delete these methods (now inherited from BaseService):**
- `getReleaseInfo()` - 40 lines
- `reloadSettings()` - 30 lines
- `getAllSettings()` - 1 line
- `setSetting()` - 1 line
- `getMetricsSnapshot()` - 1 line
- `pushMetric()` - 4 lines
- `normalizeChannels()` - 30 lines
- `updateCommunicationChannel()` - 40 lines
- `getInfo()` - 15 lines
- `disconnect()` - 20 lines
- `getDbLogStatus()` - 10 lines
- `setDbLogStatus()` - 10 lines
- `getLogLevel()` - 10 lines
- `setLogLevel()` - 10 lines
- `getBus()` - 1 line
- `getLogger()` - 1 line
- `get status()` - 1 line

**Total removed:** ~225 lines of standard methods

### Step 6: Keep Service-Specific Methods

Keep these methods (they're unique to decision-engine):
- `addMarketDataHandler()`
- `_handleMarketDataMessage()`
- `_maybeSubscribeMarketData()`

### Step 7: Add Lifecycle Hooks (Optional)

```javascript
async _onChannelUpdate(cfg) {
  await this._maybeSubscribeMarketData();
}

async _onShutdown() {
  this.logger.info("[_onShutdown] Cleaning up...");
  this._marketDataHandlers.clear();
}
```

### Step 8: Test

```bash
# Start the service
cd /Users/vincenzo.esposito/code/trading-system
docker-compose up decision-engine

# Check logs
docker-compose logs -f decision-engine

# Verify endpoints
curl http://localhost:3018/status/health
curl http://localhost:3018/status/info
```

### Step 9: Verify Functionality

**Check that these still work:**
- ✅ Service starts successfully
- ✅ Redis connection established
- ✅ Settings loaded from DB
- ✅ Events manifest published
- ✅ Market data subscription active
- ✅ `/status/health` returns 200
- ✅ `/status/info` returns correct data
- ✅ Logging to console and DB works
- ✅ Metrics are collected
- ✅ Graceful shutdown works

### Step 10: Cleanup Backup (If All Tests Pass)

```bash
rm modules/main.js.backup
```

---

## Comparison

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Total lines | 450 | 140 | ⬇️ **69%** |
| Constructor | 55 | 15 | ⬇️ **73%** |
| init() method | 80 | 5 (_onInit) | ⬇️ **94%** |
| Standard methods | 225 | 0 | ⬇️ **100%** |
| Service-specific code | 90 | 120 | ⬆️ **33%** (more focus) |
| Boilerplate ratio | 78% | 0% | ⬇️ **100%** |
| Maintainability | Low | High | ⬆️ **Significant** |

---

## Common Pitfalls

### ❌ DON'T override init()

```javascript
// WRONG!
async init() {
  await super.init(); // Calling super is ok, but...
  this.data = await this._loadData(); // This should be in _onInit()
}
```

### ✅ DO use _onInit() hook

```javascript
// CORRECT!
async _onInit() {
  this.data = await this._loadData();
}
```

### ❌ DON'T redefine standard properties

```javascript
// WRONG!
constructor() {
  super({ microservice: 'my-service' });
  this.env = 'PRODUCTION'; // Already set by BaseService!
}
```

### ✅ DO use inherited properties

```javascript
// CORRECT!
constructor() {
  super({ microservice: 'my-service' });
  // this.env is already available from BaseService
}
```

### ❌ DON'T hardcode service URLs

```javascript
// WRONG!
async fetchData() {
  const url = 'http://cachemanager:3006/data';
  return axios.get(url);
}
```

### ✅ DO use inherited URLs

```javascript
// CORRECT!
async fetchData() {
  return axios.get(`${this.cachemanagerUrl}/data`);
}
```

---

## Rollback Plan

If migration causes issues:

```bash
# 1. Restore backup
cd /Users/vincenzo.esposito/code/trading-system/decision-engine
cp modules/main.js.backup modules/main.js

# 2. Restart service
docker-compose restart decision-engine

# 3. Report issue
# Create GitHub issue with error logs
```

---

## Next Steps

After successfully migrating decision-engine:

1. ✅ **decision-engine** (pilot - DONE)
2. 🔄 **scheduler** (similar complexity)
3. 🔄 **tickerScanner** (medium complexity)
4. 🔄 **alertingService** (simple)
5. 🔄 **cacheManager** (complex - save for later)
6. 🔄 Remaining services...

---

## Support

Questions or issues during migration?

1. Check [BaseService.README.md](./BaseService.README.md)
2. Review test cases in [BaseService.test.js](./BaseService.test.js)
3. Look at migrated services for examples
4. Contact platform team

---

**Migration Checklist:**

- [ ] Backup original file
- [ ] Update imports (remove old, add BaseService)
- [ ] Update constructor (use super())
- [ ] Replace init() with _onInit()
- [ ] Remove standard methods
- [ ] Add lifecycle hooks (optional)
- [ ] Test locally
- [ ] Verify all endpoints
- [ ] Check logs for errors
- [ ] Monitor metrics
- [ ] Remove backup (if successful)
- [ ] Update documentation
- [ ] Notify team

**Estimated Time:** 15-30 minutes per service
