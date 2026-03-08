---
sidebar_position: 1
---

# Developer

Questa sezione e pensata per chi integra o estende il sistema dal lato sviluppo.

## Architettura ad alto livello

Il progetto e suddiviso in due macro-aree:

1. **Frontend**: applicazione client per UI e interazione utente.
2. **Backend**: insieme di microservizi che espongono API e gestiscono logica di business, dati e integrazioni esterne.

```text
Frontend (astraai)
  -> chiama API HTTP/WebSocket
Backend (trading-system microservices)
  -> orchestration, auth, market data, scheduler, execution
```

## Tecnologie usate

### Frontend

- **Framework UI**: React 19 + TypeScript
- **Build tool**: Vite
- **UI system**: Material UI + Tailwind CSS
- **Repo**: workspace/repo frontend separato (`astraai`)

Approfondimento: [Sezione Frontend](./frontend.md)

### Backend

- **Runtime**: Node.js
- **Stack principale**: Express (REST), WebSocket, Redis, MySQL
- **Architettura**: microservizi in cartelle dedicate (`authService`, `decision-engine`, `scheduler`, ecc.)
- **Repo**: `trading-system`

Approfondimento: [Sezione Backend](./backend.md)

## Prossimi step in questa sezione

- `auth.md`: autenticazione esterna e gestione token/API key.
- `endpoints.md`: catalogo endpoint e payload.
- `webhooks.md`: eventi e strategie di retry/idempotenza.
