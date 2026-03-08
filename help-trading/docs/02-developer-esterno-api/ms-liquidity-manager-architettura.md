---
sidebar_position: 1
---

# Architettura e flussi

## Componenti principali

- `server.js`: bootstrap via `createMicroserviceServer`;
- `modules/main.js`: service runtime (`BaseService`) con engine/repository/task manager;
- `modules/engine/liquidityScoreEngine.js`: calcolo score e regime;
- `providers/*`: fetch dati provider (VIX, SPY, DXY, credit);
- `repositories/*`: persistenza snapshot e cache provider;
- `modules/tasks/recomputeTaskManager.js`: gestione task asincroni e stato;
- `controllers/liquidityScoreController.js` + `routes/liquidityScoreRoutes.js`: API REST.

## Flusso calcolo score

1. Trigger recompute (`POST /liquidity-score/recompute`).
2. Task manager crea task asincrono con stato RUNNING.
3. Engine chiama provider e normalizza componenti.
4. Aggregazione pesata -> `score`, `riskRegime`, `volatilityRegime`, `confidence`.
5. Snapshot salvato in repository + pruning storico.
6. Aggiornamenti task pubblicati su Redis data channel.

## Flusso osservabilita

- endpoint `/liquidity-score/tasks` e `/liquidity-score/tasks/:taskId` per tracking job;
- endpoint `/liquidity-score/providers/status` per health provider e fallback info.
