---
sidebar_position: 2
---

# Frontend

## Stack tecnologico

| Categoria | Tecnologia |
|---|---|
| Linguaggio | TypeScript ~5.9 |
| Framework | React 19 |
| Build tool | Vite 7 + `@vitejs/plugin-react-swc` |
| UI library | Material UI 6 + Emotion |
| Utility CSS | Tailwind CSS 3 |
| Icone | Iconify (`@iconify/react`) |
| Grafici | ApexCharts |
| Date | Day.js |

## Responsabilità principali

- Rendering UI applicativa (dashboard operativa, admin, landing)
- Navigazione lato client con routing hash-based (nessuna dipendenza da React Router)
- Chiamate verso le API REST dei microservizi tramite client HTTP centralizzato
- Ricezione eventi real-time via WebSocket (`redis-ws-bridge`)
- Gestione autenticazione JWT con auto-renewal silenzioso
- Presentazione stato microservizi, job asincroni e dati finanziari

## Struttura cartelle top-level

```
astraai/src/
├── api/           # Client HTTP per ogni dominio (auth, users, tickerscanner, scheduler, ...)
├── app/           # Layout app-level
├── assets/        # Media statici (logo, immagini, video)
├── components/
│   ├── atoms/     # Componenti elementari (button, input, typography, ...)
│   ├── molecules/ # Componenti compositi (chart, menu, pagination, ...)
│   ├── organisms/ # Blocchi UI complessi (AuthGuard, SettingsPanel, Gantt)
│   └── pages/     # Route-level components
├── config/        # Variabili ambiente e costanti
├── contexts/      # Context API (AuthContext)
├── hooks/         # Hook custom condivisi
├── layouts/       # Layout wrapper per tipologia di pagina
├── services/
│   └── ws/        # WebSocket client (redis-ws-bridge)
├── utils/         # Utility pure (routing, storage, textResolver)
├── App.tsx        # Root component con AuthProvider e routing
└── main.tsx       # Entry point React
```

## Variabili d'ambiente (Vite)

Le variabili devono essere prefissate con `VITE_` per essere esposte al bundle.

| Variabile | Default | Descrizione |
|---|---|---|
| `VITE_API_BASE_URL` | `https://api.trading.expovin.it` | Base URL del gateway Traefik. Alias: `VITE_API_BASE`. |
| `VITE_FMP_API_KEY` | — | API key Financial Modeling Prep, usata per fetch dati finanziari lato client. |
| `VITE_ENV` | — | Nome ambiente (`DEV`, `staging`, `prod`). |

## Scripts disponibili

```bash
npm run dev              # Dev server locale (Vite HMR)
npm run build            # Build produzione (tsc + vite build)
npm run preview          # Preview build locale
npm run lint             # ESLint check
npm run dev:staging      # Dev server in modalità staging
npm run build:staging    # Build staging
npm run preview:staging  # Preview staging
```

## Pagine dedicate

- [Architettura e routing](./frontend-architettura.md)
- [Catalogo componenti (Atomic Design)](./frontend-componenti.md)
- [Servizi condivisi (API, WebSocket, hook, utility)](./frontend-servizi.md)
- [Pagine e sezioni applicative](./frontend-pagine.md)
