# brokerExecutor-ibkr env vars

- `IBKRGW_BASE_URL`  
  URL base IBKR gateway (es. `https://ibkrgw-paper:5000`).

- `IBKR_BASE_URL`  
  Fallback se `IBKRGW_BASE_URL` non è valorizzata.

- `IBKR_ACCOUNT_ID`  
  Account IBKR target per leggere/inserire/modificare ordini.

- `IBKR_REQUEST_TIMEOUT_MS`  
  Timeout richieste HTTP verso IBKR (default: `20000`).

- `IBKR_INSECURE_TLS`  
  `true|false` per TLS self-signed (default: `false`).

- `IBKR_AUTO_REPLY_CONFIRM`  
  `true|false` per auto-confermare risposte interattive (`/iserver/reply/:id`) (default: `true`).

- `IBKR_IDEMPOTENCY_HOURS`  
  Finestra idempotenza su `externalCorrelationId` (default: `6`).

- `INTERNAL_JWT_PUBLIC_KEY`  
  Chiave pubblica per validazione `X-Internal-Token`.

- `INTERNAL_JWT_ISSUER`  
  Issuer atteso del token interno (default: `astraai-internal`).

- `INTERNAL_JWT_AUDIENCE`  
  Audience attesa (opzionale).

- `INTERNAL_JWT_SCOPE`  
  Scope richiesto (opzionale).
