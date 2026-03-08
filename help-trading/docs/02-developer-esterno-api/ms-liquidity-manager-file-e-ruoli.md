---
sidebar_position: 3
---

# Implementazione per file

## Struttura principale

- `liquidity-manager/server.js`
- `liquidity-manager/modules/main.js`
- `liquidity-manager/routes/liquidityScoreRoutes.js`
- `liquidity-manager/controllers/liquidityScoreController.js`
- `liquidity-manager/modules/engine/liquidityScoreEngine.js`
- `liquidity-manager/modules/tasks/recomputeTaskManager.js`

## Layer provider / normalizer / repository

- provider: `providers/vixProvider.js`, `providers/spyProvider.js`, `providers/dxyProvider*.js`, `providers/creditProvider.js`
- normalizer: `modules/normalizers/*.js`
- repository: `repositories/liquidityScoreRepository.js`, `repositories/yahooCacheRepository.js`, `repositories/impl/*.js`

## Ruolo dei file

### `modules/main.js`

- inizializza engine/repository/task manager;
- espone metodi business (`getLiquidityScore`, `recomputeLiquidityScore`, `getLiquidityTasks`, ...);
- pubblica progress task sul bus Redis.

### `modules/engine/liquidityScoreEngine.js`

- definisce componenti e pesi score;
- esegue fetch provider + normalizzazione;
- calcola score finale, confidence e regimi.

### `controllers` + `routes`

- espongono API read/recompute/history/providers/tasks.

### `modules/tasks/recomputeTaskManager.js`

- crea task id univoco, stato e cronologia step;
- supporta list/filter task e lookup per id.

### `repositories/*`

- astrazione storage snapshot e history;
- implementazioni in-memory/file per diversi contesti runtime/test.
