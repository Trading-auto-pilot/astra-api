---
sidebar_position: 3
---

# Flusso Operativo commit -> pipeline

Questa procedura vale sia per backend (`trading-system`) sia per frontend (`astraai`).

## Da LOCAL a PAPER

1. Sviluppa e testa in locale.
2. Commit su branch di lavoro.
3. Apri PR verso `main` (se usato come branch di integrazione).
4. Merge in `main`.
5. Porta le modifiche su `PAPER` (merge/cherry-pick secondo processo del team).
6. Push su `PAPER` -> trigger automatico CI/CD.
7. Verifica run GitHub Actions.
8. Verifica servizi in PAPER (healthcheck, log, smoke test UI/API).

## Promozione PAPER -> LIVE

1. Apri PR da `PAPER` a `LIVE`.
2. Esegui review.
3. Merge PR.
4. Workflow su `LIVE` esegue il deploy secondo regole del repository.

## Checklist minima prima del merge su PAPER

- `release.json` aggiornato dove richiesto.
- versioni immagini coerenti con compose/.env.
- `vars` e `secrets` Environment verificati.
- note release pronte (se previste dal flusso).

