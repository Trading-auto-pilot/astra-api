# Template Microservizio (Standard)

> Copiare questo template per ogni microservizio e mantenere sempre la stessa struttura.

## 1) overview (`ms-<nome>.md`)

### Cosa fa
- Scopo principale del servizio.

### Ruoli e responsabilita
- Elenco responsabilita operative.

### Porta esposta
- Porta interna.
- Prefisso esterno (Traefik).

### Dipendenze
- Chi chiama questo servizio.
- Quali servizi/librerie usa.

### Pagine dedicate
- [Architettura e flussi](./ms-<nome>-architettura.md)
- [Endpoint dettagliati](./ms-<nome>-endpoint.md)
- [Implementazione per file](./ms-<nome>-file-e-ruoli.md)
- [Configurazione](./ms-<nome>-configurazione.md)
- [Runbook](./ms-<nome>-runbook.md)

## 2) architettura (`ms-<nome>-architettura.md`)

### Componenti principali
- Moduli principali e responsabilita.

### Flussi operativi
- Flusso richiesta principale (sync).
- Flusso asincrono (job/eventi).

### Integrazioni
- Redis, Datahub/MySQL, servizi esterni.

### Sicurezza
- Auth esterna e/o token interni.

## 3) endpoint (`ms-<nome>-endpoint.md`)

Tabella standard:

| Metodo | Path | Auth | Parametri | Risposta | Errori |
|---|---|---|---|---|---|

Separare:
- endpoint pubblici
- endpoint interni (`/internal/*`)
- endpoint standard (`/status`, `/settings`, `dbLogger`, ecc.)

## 4) file-e-ruoli (`ms-<nome>-file-e-ruoli.md`)

Tabella standard:

| File | Ruolo | Note implementative |
|---|---|---|

## 5) configurazione (`ms-<nome>-configurazione.md`)

### Docker compose
- Estratto servizio da `docker-compose.<env>.yml`.

### Variabili d'ambiente

| Variabile | Default | Obbligatoria | Descrizione |
|---|---|---|---|

### Profili e dipendenze
- `profiles`, `depends_on`, `healthcheck`.

## 6) runbook (`ms-<nome>-runbook.md`)

### Avvio e test rapido
- Comandi principali.

### Healthcheck
- Endpoint da verificare.

### Problemi comuni
- Sintomo
- Diagnosi
- Azione correttiva

### Osservabilita
- Log chiave
- Metriche
- Canali Redis
