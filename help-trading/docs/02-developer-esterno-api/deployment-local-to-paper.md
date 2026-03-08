---
sidebar_position: 1
---

# LOCAL -> PAPER

Questa pagina riassume i comandi Git operativi per:

- deploy da `main` a `PAPER`
- creazione tag versione
- ritorno a una versione precedente

## Deploy da LOCAL verso PAPER

Assumendo `org` come remote:

```bash
git branch --show-current
git checkout main
git pull org main

git add .
git commit -m "commento"
git push org main

git checkout PAPER
git pull org PAPER
git merge main
git push org PAPER

git checkout main
```

## Creazione TAG versione

Esempio versione `v3.4.0`:

```bash
git checkout PAPER
git pull org PAPER
git tag -a v3.4.0 -m "Release v3.4.0"
git push org v3.4.0
git checkout main
```

## Tornare a una versione diversa

### Opzione 1: branch di restore dal tag (consigliata)

```bash
git fetch --all --tags
git checkout -b restore-v3.4.0 v3.4.0
```

### Opzione 2: checkout temporaneo del tag (read-only)

```bash
git fetch --all --tags
git checkout v3.4.0
```

### Opzione 3: riallineare un branch al tag (operazione invasiva)

```bash
git checkout PAPER
git reset --hard v3.4.0
git push --force-with-lease org PAPER
```

Usare l'opzione 3 solo quando concordata con il team.

