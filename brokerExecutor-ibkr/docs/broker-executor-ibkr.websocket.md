# broker-executor-ibkr WebSocket Orders Listener

## Overview

The microservice starts a dedicated IBKR Client Portal WebSocket listener at startup.

Main functions:
- subscribe to live orders (`sor+{}`)
- normalize incoming order updates
- update in-memory order state idempotently
- publish internal events on Redis bus (`<ENV>.broker-executor-ibkr.events`)
- trigger positions refresh when orders are filled/partially filled
- run periodic REST reconcile as safety net

## Environment Variables

- `IBKR_WS_URL`  
  Default: `wss://ibkrgw-paper:5000/v1/api/ws`

- `IBKR_WS_RECONNECT_MIN_MS`  
  Default: `1000`

- `IBKR_WS_RECONNECT_MAX_MS`  
  Default: `30000`

- `IBKR_WS_HEARTBEAT_MS`  
  Default: `25000`

- `IBKR_WS_RECONCILE_POLL_MS`  
  Default: `60000`

- `IBKR_POSITIONS_REFRESH_DEBOUNCE_MS`  
  Default: `3000`

- `IBKR_EXECUTOR_USE_BRIDGE`  
  Default: `true` (REST fallback/reconcile via `IBKRBRIDGE_URL` mirror proxy)

## Runtime Flow

1. Startup
- connect WS
- subscribe `sor+{}`
- start heartbeat
- run immediate reconcile via REST orders endpoint
- start periodic reconcile timer

2. On live message
- parse payload
- extract order updates (`orderId`, `parentOrderId`, status, filledQty, etc.)
- dedupe by `(orderId, status, filledQty)`
- publish events:
  - `broker.ibkr.order.updated`
  - `broker.ibkr.order.filled`
  - `broker.ibkr.order.cancelled`
- if fill/partial fill: trigger debounced positions refresh and publish:
  - `broker.ibkr.position.updated`

3. On disconnect/error
- log reason
- reconnect with exponential backoff + jitter
- on reconnect: resubscribe and run reconcile

4. Shutdown
- unsubscribe best effort (`uor+{}`)
- close socket
- stop timers

## Local Test

1. Rebuild service:

```bash
cd /Users/vincenzo.esposito/code/trading-system
docker compose --env-file .env.local -f docker-compose.local.yml --profile broker-executor-ibkr up -d --build broker-executor-ibkr
```

2. Check logs:

```bash
docker compose --env-file .env.local -f docker-compose.local.yml logs -f broker-executor-ibkr
```

Expected logs:
- `[start] starting IBKR WS orders listener`
- `[_onOpen] ws connected, subscribing live orders`
- `[runOnce] reconcile ok count=... reason=ws-connected`
- `[requestRefresh] positions refreshed count=... reason=ws-fill` (on fills)

3. Generate a live order event
- place/modify/cancel an order from IBKR or from broker-executor API.
- verify events published on Redis channel `<ENV>.broker-executor-ibkr.events`.

## Troubleshooting

- `No WebSocket client available`
  - ensure dependency `ws` is installed in `brokerExecutor-ibkr/package.json`.

- Frequent reconnect loop
  - verify gateway session is valid and CPAPI WS URL is reachable.
  - check cert/TLS and `IBKR_WS_URL`.

- No live updates but REST works
  - gateway may be authenticated for REST but not ready for WS feed.
  - check WS logs and subscribe ack messages.

- Positions not refreshing
  - verify fill events include status transitions to `FILLED` or `PARTIALLY_FILLED`.
  - check debounce value `IBKR_POSITIONS_REFRESH_DEBOUNCE_MS`.
