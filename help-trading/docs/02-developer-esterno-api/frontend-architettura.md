---
sidebar_position: 3
---

# Frontend — Architettura e routing

## Entry point

### `main.tsx`
Monta l'albero React su `#root`:

```tsx
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

### `App.tsx`
Root component. Wrappa tutto in `<AuthProvider>` e gestisce il routing hash-based.

---

## Routing hash-based

Il progetto **non usa React Router**. Il routing è implementato tramite `window.location.hash` e un hook custom `useHashRouter`.

### Formato URL

```
http://host/#/dashboard/tickers/AAPL
         ↑   ↑___________↑______↑___
         #   routeId    subpath param
```

### Route principali

| Hash | RouteId | Accesso |
|---|---|---|
| `#/landing` | `landing` | Pubblico |
| `#/login` | `login` | Pubblico |
| `#/maintenance` | `maintenance` | Pubblico |
| `#/contact` | `contact` | Pubblico |
| `#/overview` | `overview` | Protetto |
| `#/dashboard` | `dashboard` | Protetto |
| `#/dashboard/tickers` | `dashboard` | Protetto |
| `#/dashboard/tickers/{symbol}` | `dashboard` | Protetto |
| `#/dashboard/user_tickers` | `dashboard` | Protetto |
| `#/dashboard/user-settings` | `dashboard` | Protetto |
| `#/admin` | `admin` | Protetto |
| `#/admin/users` | `admin` | Protetto |
| `#/admin/scheduler` | `admin` | Protetto |
| `#/admin/api_key` | `admin` | Protetto |
| `#/admin/logs` | `admin` | Protetto |
| `#/admin/alerts` | `admin` | Protetto |
| `#/admin/microservice` | `admin` | Protetto |
| `#/admin/microservice/{slug}` | `admin` | Protetto |
| `#/admin/ticker-scanner` | `admin` | Protetto |
| `#/404` | `404` | Pubblico |

### Route protette

```ts
const PROTECTED_ROUTES = new Set<RouteId>(["overview", "dashboard", "admin"]);
```

Per ogni navigazione verso una route protetta, `App` chiama `checkAuth()` prima di renderizzare la pagina. Se il permesso non è soddisfatto, redirect automatico a `#/login` o `#/404`.

### Hook `useHashRouter`

```ts
const {
  hash,          // Raw: "#/dashboard/tickers"
  path,          // Cleaned: "dashboard/tickers"
  parts,         // Array: ["dashboard", "tickers"]
  routeId,       // RouteId: "dashboard"
  permissionKey, // Permission string: "dashboard/tickers"
  navigate,      // (path: string) => void
  matches,       // (pattern: string) => boolean — supporta glob "dashboard/*"
} = useHashRouter();

// Specialized hooks
useMicroserviceSlug()  // "#/admin/microservice/cachemanager" → "cachemanager"
useTickerSymbol()      // "#/dashboard/tickers/AAPL" → "AAPL"
useUserSettingsTab()   // "#/dashboard/user-settings/filters" → "filters"
```

---

## Autenticazione

### Flusso login

```
LoginPage → POST /auth/login
         ← { token, requires_password_reset? }
                ↓
        localStorage (astraai:auth:token)
                ↓
        checkAuth() → GET /auth/admin/me
                   ← { user, allowedPages, navEntries }
                ↓
        navigate("#/overview")
```

Se `requires_password_reset = true`, l'app mostra il form di cambio password obbligatorio prima del redirect.

### Token management

Il token JWT è salvato in `localStorage` con chiave `astraai:auth:token`.

**Auto-renewal silenzioso:** `httpClient` controlla la scadenza del token ad ogni richiesta. Se mancano meno di 5 minuti alla scadenza, chiama automaticamente `POST /auth/renew` e aggiorna il token senza interrompere il flusso.

```ts
// In httpClient.ts
if (shouldRenewToken(token)) {
  const renewed = await fetch('/auth/renew', { ... });
  setToken(renewed.token);
}
```

### Permessi e pagine

Il server ritorna la lista delle pagine autorizzate per l'utente loggato (`allowedPages`). L'app espande eventuali wildcard:

```
"dashboard/*" → abilita tutte le sub-pagine di dashboard
"admin/*"     → abilita tutte le sub-pagine di admin
```

Le `navEntries` (voci del menu laterale) sono personalizzate per utente e cachate in `localStorage` con chiave `astraai:auth:clientNavigation`.

### Logout

```ts
logout() {
  localStorage.removeItem("astraai:auth:token");
  localStorage.removeItem("astraai:auth:clientNavigation");
  navigate("login");
}
```

---

## State management

L'app **non usa Redux né Zustand**. Lo stato globale è gestito esclusivamente tramite Context API.

### `AuthContext`

Unico context globale. Espone:

| Campo | Tipo | Descrizione |
|---|---|---|
| `user` | `UserInfo \| null` | Dati utente loggato |
| `token` | `string \| null` | JWT corrente |
| `isAuthenticated` | `boolean` | Flag auth |
| `isLoading` | `boolean` | Auth check in corso |
| `allowedPages` | `string[]` | Pagine autorizzate |
| `navEntries` | `NavEntry[]` | Voci menu dinamico |
| `login(creds)` | `function` | Autentica |
| `logout()` | `function` | Disconnette |
| `checkAuth(token?)` | `function` | Verifica permessi |

Gli stati locali delle singole pagine (job list, ticker data, ecc.) sono gestiti con `useState`/`useReducer` locali al componente.

---

## Layout

Ogni tipologia di pagina ha il suo layout wrapper in `src/layouts/`:

| Layout | Usato da |
|---|---|
| `LandingLayout` | Homepage, Contact, FAQ, Maintenance, ComingSoon |
| `AuthLayout` | LoginPage |
| `MainLayout` | Tutte le pagine dashboard e admin |

### `MainLayout`

Il layout principale include:
- Sidebar collapsibile (stato persistito in `localStorage: astraai:sidebar:collapsed`)
- Menu di navigazione dinamico generato dalle `navEntries` dell'utente
- User dropdown menu (logout, profilo)
- Indicatore stato gateway IBKR (verde/giallo/rosso)
- Indicatore stato market data
- Selettore account IBKR
- Modal release info

---

## Real-time (WebSocket)

Il componente `DashboardPage` mantiene una connessione WebSocket verso `redis-ws-bridge` tramite il singleton `redisWsBridgeClient` (`src/services/ws/redisWsBridgeClient.ts`).

```
Frontend ←──── WebSocket ────── redis-ws-bridge ←── Redis pub/sub ←── Microservizi
```

**Auto-reconnect** con backoff esponenziale (da 1s fino a 30s max).

**Subscription API:**

```ts
const unsubscribe = redisWsBridgeClient.subscribe({
  filter: (msg) => msg.type === 'telemetry',
  onMessage: (msg) => { /* aggiorna UI */ },
  onStatus: (status, detail) => { /* mostra icona */ },
});
// Chiama unsubscribe() al cleanup del componente
```

**Status possibili:** `idle | connecting | open | closed | error`

Usato principalmente per monitorare in real-time: stato gateway IBKR, status market data, telemetria job.
