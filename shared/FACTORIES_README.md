# Server & Status Router Factories

Documentazione completa per `serverFactory.js` e `statusRouterFactory.js` - componenti che eliminano la duplicazione nei file `server.js` e `status.js`.

---

## 📦 Overview

Questi factory completano la strategia di centralizzazione insieme a `BaseService.js`:

| File | Before | After | Riduzione |
|------|--------|-------|-----------|
| **modules/main.js** | ~450 righe | ~140 righe | **69%** (con BaseService) |
| **server.js** | ~120 righe | ~20 righe | **83%** (con serverFactory) |
| **status.js** | ~80 righe | **0 righe** | **100%** (eliminato!) |

**Totale per servizio:** ~650 righe → ~160 righe = **75% riduzione**

---

## statusRouterFactory.js

Factory che crea un router Express per `/status/*` con 7 endpoint standardizzati.

### Quick Start

```javascript
const buildStatusRouter = require('../shared/statusRouterFactory');

app.use('/status', buildStatusRouter({
  getServiceInstance: () => serviceInstance,
  logger,
  moduleName: 'RESTServer'
}));
```

### Endpoints

- `GET /status/health`
- `GET /status/info`
- `GET /status/communicationChannels`
- `PUT /status/communicationChannels`
- `GET /status/metrics`
- `GET /status/logLevel`
- `PUT /status/logLevel`

---

## serverFactory.js

Factory che crea un server Express completo con tutte le route standard, CORS, graceful shutdown.

### Quick Start

```javascript
const { createMicroserviceServer } = require('../shared/serverFactory');
const MyService = require('./modules/main');

createMicroserviceServer({
  ServiceClass: MyService,
  microservice: 'my-service',
  defaultPort: 3020,
  routes: [
    { path: '/api', router: apiRouter, protected: true }
  ]
});
```

### Standard Routes Incluse

- `GET /release`
- `GET /settings`
- `PUT /settings`
- `POST /settings/reload`
- `PUT /connect`
- `DELETE /connect`
- `GET /dbLogger`
- `PUT /dbLogger/:status`
- `+ /status/*` (se enableStatusRouter: true)

---

## 📊 Impact

### Per Servizio

- **server.js:** 120 → 25 righe (**79% riduzione**)
- **status.js:** 80 → 0 righe (**eliminato!**)

### System-Wide (14 servizi)

- **Total lines:** 9100 → 2310 (**75% riduzione**)
- **Files:** 42 → 14 (**67% fewer files**)
- **Duplicated code:** 93% eliminato

---

Per documentazione completa, vedi il file completo FACTORIES_README.md.
