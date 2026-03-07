# Datahub Migration Guide

This guide shows how to migrate microservices from DBManager to datahub using the datahub adapter.

## Quick Migration (Zero Code Changes)

For microservices using only `/settings` endpoint:

### 1. Change Environment Variable

```bash
# Before
DBMANAGER_URL=http://dbmanager:3002

# After
DBMANAGER_URL=http://datahub:3000
```

✅ **Done!** The `/settings` endpoint is 100% compatible.

---

## Full Migration (All Endpoints)

For microservices using DBManager for data access (CRUD operations):

### Option A: Using Auto-Adapter (Recommended)

Minimal code changes - just wrap your axios instance:

```javascript
// Before
const axios = require("axios");

const http = axios.create({
  baseURL: this.dbmanagerUrl,
  timeout: 15000,
  validateStatus: () => true,
});

// After
const axios = require("axios");
const { createDatahubAdapter, convertPathToDatahub } = require("../shared/datahubAdapter");

const http = createDatahubAdapter(axios.create({
  baseURL: this.datahubUrl, // Changed from dbmanagerUrl
  timeout: 15000,
  validateStatus: () => true,
}));
```

**Update endpoint paths:**

```javascript
// Before
const rulesResp = await this.http.get("/alerting-rules");
this.rules = Array.isArray(rulesResp.data?.items) ? rulesResp.data.items : [];

// After - Option 1: Auto path conversion
const { convertPathToDatahub } = require("../shared/datahubAdapter");
const rulesResp = await this.http.get(convertPathToDatahub("/alerting-rules"));
this.rules = Array.isArray(rulesResp.data?.items) ? rulesResp.data.items : [];
// ✅ Response is automatically converted to DBManager format!

// After - Option 2: Direct path
const rulesResp = await this.http.get("/api/table/alerting-rules");
this.rules = Array.isArray(rulesResp.data?.items) ? rulesResp.data.items : [];
// ✅ Response is automatically converted to DBManager format!
```

### Option B: Manual Adaptation

If you prefer more control:

```javascript
const { adaptDatahubResponse } = require("../shared/datahubAdapter");

// GET list
const rulesResp = await this.http.get("/api/table/alerting-rules");
const dbManagerFormat = adaptDatahubResponse(rulesResp.data, { type: 'list' });
this.rules = dbManagerFormat.items || [];

// GET single
const stateResp = await this.http.get("/api/table/alerting-state/123");
const state = adaptDatahubResponse(stateResp.data, { type: 'single' });

// POST
const createResp = await this.http.post("/api/table/alerting-state", { rule_id: 1 });
const created = adaptDatahubResponse(createResp.data, { type: 'post' });
console.log(created.id); // Works like DBManager!

// PUT
const updateResp = await this.http.put("/api/table/alerting-state/123", { enabled: true });
const updated = adaptDatahubResponse(updateResp.data, { type: 'put' });

// DELETE
const deleteResp = await this.http.delete("/api/table/alerting-state/123");
const result = adaptDatahubResponse(deleteResp.data, { type: 'delete' });
console.log(result.affectedRows);
```

---

## Example: Alerting Service Migration

### File: `alertingService/modules/RuleEngine.js`

```diff
  const axios = require("axios");
+ const { createDatahubAdapter, convertPathToDatahub } = require("../../shared/datahubAdapter");
  const TwilioClient = require("./twilio");
  const EmailClient = require("./email");

  class RuleEngine {
    constructor({ bus, logger, dbmanagerUrl, env }) {
      this.bus = bus;
      this.logger = logger;
-     this.dbmanagerUrl = dbmanagerUrl;
+     this.datahubUrl = process.env.DATAHUB_URL || dbmanagerUrl; // Backward compatible
      this.env = env || "DEV";

-     this.http = axios.create({
-       baseURL: this.dbmanagerUrl,
+     this.http = createDatahubAdapter(axios.create({
+       baseURL: this.datahubUrl,
        timeout: 15000,
        validateStatus: () => true,
-     });
+     }));
    }

    async reloadRules() {
-     const rulesResp = await this.http.get("/alerting-rules");
+     const rulesResp = await this.http.get(convertPathToDatahub("/alerting-rules"));
      // ✅ rulesResp.data is now { items: [...], count: N } - DBManager format!

      if (rulesResp.status >= 400) {
        this.logger.error(`[ruleEngine] reload rules failed status=${rulesResp.status}`);
        return { ok: false, error: "rules load failed", status: rulesResp.status };
      }

      this.rules = Array.isArray(rulesResp.data?.items) ? rulesResp.data.items : [];

-     const stateResp = await this.http.get("/alerting-state");
+     const stateResp = await this.http.get(convertPathToDatahub("/alerting-state"));
      // ✅ stateResp.data is now { items: [...], count: N } - DBManager format!

      if (stateResp.status < 400 && Array.isArray(stateResp.data?.items)) {
        this.stateByRuleId.clear();
        for (const st of stateResp.data.items) {
          if (st?.rule_id != null) this.stateByRuleId.set(Number(st.rule_id), st);
        }
      }

      return { ok: true, rules: this.rules.length, state: this.stateByRuleId.size };
    }

    async ensureState(ruleId) {
      const key = Number(ruleId);
      if (this.stateByRuleId.has(key)) return this.stateByRuleId.get(key);

-     const resp = await this.http.post("/alerting-state", { rule_id: key });
+     const resp = await this.http.post(convertPathToDatahub("/alerting-state"), { rule_id: key });
      // ✅ resp.data is now { id: X, rule_id: key } - DBManager format!

      if (resp.status >= 400) return null;
      const state = { rule_id: key, id: resp.data?.id };
      this.stateByRuleId.set(key, state);
      return state;
    }

    async updateState(ruleId, patch) {
      const state = await this.ensureState(ruleId);
      if (!state?.id) return;

-     const resp = await this.http.put(`/alerting-state/${state.id}`, {
+     const resp = await this.http.put(convertPathToDatahub(`/alerting-state`) + `/${state.id}`, {
        rule_id: ruleId,
        ...patch,
      });
      // ✅ resp.data is now { id: X, ...patch } - DBManager format!

      if (resp.status < 400) {
        this.stateByRuleId.set(Number(ruleId), {
          ...state,
          ...patch,
        });
      }
    }

    async applyRule(rule, event) {
      // ... (delivery logic)

      for (const d of deliveries) {
-       await this.http.post("/alerting-deliveries", {
+       await this.http.post(convertPathToDatahub("/alerting-deliveries"), {
          rule_id: ruleId,
          provider: d.provider,
          status: d.status,
          response_json: d.response_json,
        });
      }
    }
  }

  module.exports = RuleEngine;
```

### File: `alertingService/modules/main.js`

```diff
  class AlertingService extends BaseService {
    constructor() {
      super({
        microservice: "alertingService",
        moduleName: "main",
        moduleVersion: "1.0.0",
      });

-     this.dbmanagerUrl = process.env.DBMANAGER_URL || "http://dbmanager:3002";
+     // Use datahub if available, fallback to dbmanager
+     this.datahubUrl = process.env.DATAHUB_URL || process.env.DBMANAGER_URL || "http://datahub:3000";
    }

    async _onInit() {
-     const ok = await initializeSettings(this.dbmanagerUrl);
+     const ok = await initializeSettings(this.datahubUrl);

      this.ruleEngine = new RuleEngine({
        bus: this.bus,
        logger: this.logger,
-       dbmanagerUrl: this.dbmanagerUrl,
+       dbmanagerUrl: this.datahubUrl, // Keep param name for backward compat
        env: this.env,
      });
    }

    async reloadSettings() {
-     const ok = await reloadSettings(this.dbmanagerUrl);
+     const ok = await reloadSettings(this.datahubUrl);
    }
  }
```

### Environment Variables

Update `.env.local`:

```bash
# New variable (preferred)
DATAHUB_URL=http://datahub:3000

# Or rename existing
# DBMANAGER_URL=http://datahub:3000
```

---

## Response Format Comparison

### GET List (e.g., `/alerting-rules`)

**DBManager:**
```json
{
  "items": [
    { "id": 1, "name": "Rule 1", "enabled": true },
    { "id": 2, "name": "Rule 2", "enabled": false }
  ],
  "count": 2
}
```

**Datahub (raw):**
```json
{
  "ok": true,
  "data": [
    { "id": 1, "name": "Rule 1", "enabled": true },
    { "id": 2, "name": "Rule 2", "enabled": false }
  ],
  "count": 2,
  "total": 2,
  "limit": 100,
  "offset": 0
}
```

**Datahub (with adapter):**
```json
{
  "items": [
    { "id": 1, "name": "Rule 1", "enabled": true },
    { "id": 2, "name": "Rule 2", "enabled": false }
  ],
  "count": 2
}
```
✅ **Identical to DBManager!**

### POST (e.g., `/alerting-state`)

**DBManager:**
```json
{
  "id": 123,
  "rule_id": 1,
  "last_sent_at": null
}
```

**Datahub (raw):**
```json
{
  "ok": true,
  "insertedId": 123,
  "data": {
    "id": 123,
    "rule_id": 1,
    "last_sent_at": null
  }
}
```

**Datahub (with adapter):**
```json
{
  "id": 123,
  "rule_id": 1,
  "last_sent_at": null
}
```
✅ **Identical to DBManager!**

---

## Testing Migration

### 1. Test with curl

```bash
# Test settings endpoint (already compatible)
curl http://localhost:8080/datahub/settings | jq '.[0:2]'

# Test table endpoint (requires adapter)
curl http://localhost:8080/datahub/api/table/alerting-rules | jq '.data[0:2]'
```

### 2. Test in code

```javascript
// Test script
const axios = require('axios');
const { createDatahubAdapter } = require('./shared/datahubAdapter');

const http = createDatahubAdapter(axios.create({
  baseURL: 'http://localhost:8080/datahub',
  timeout: 5000,
}));

async function test() {
  // Test GET list
  const rules = await http.get('/api/table/alerting-rules');
  console.log('Rules:', rules.data.items); // DBManager format!

  // Test POST
  const created = await http.post('/api/table/alerting-state', { rule_id: 1 });
  console.log('Created ID:', created.data.id); // DBManager format!
}

test().catch(console.error);
```

---

## Rollback Plan

If issues occur, rollback is simple:

```bash
# Revert environment variable
DBMANAGER_URL=http://dbmanager:3002

# Or
DATAHUB_URL=http://dbmanager:3002
```

The adapter is backward-compatible and will pass through DBManager responses unchanged.

---

## Benefits

✅ **Zero downtime** - Change one service at a time
✅ **Backward compatible** - Works with both DBManager and datahub
✅ **Minimal code changes** - Just wrap axios instance
✅ **Type safety** - Same response format
✅ **Easy rollback** - Just change env var

---

## Next Steps

1. Start with non-critical microservices
2. Test thoroughly in dev/staging
3. Monitor logs for errors
4. Migrate production services one by one
5. Deprecate DBManager after all services migrated
