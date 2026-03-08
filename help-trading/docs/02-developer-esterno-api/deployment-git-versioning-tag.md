---
sidebar_position: 4
---

# Versioning con TAG

I tag permettono di fissare un punto preciso del codice (snapshot immutabile).

## Creazione tag versione

Esempio `v3.4.0`:

```bash
git fetch --all --tags
git checkout PAPER
git pull
git tag -a v3.4.0 -m "Release v3.4.0"
git push origin v3.4.0
```

## Buona pratica multi-repo

Applicare lo stesso tag su:

- `trading-system`
- `astraai`

cosi il release set resta allineato.

## Verifica tag

```bash
git tag -n
git show v3.4.0 --no-patch
```

## Convenzione consigliata

- formato semantico: `vMAJOR.MINOR.PATCH` (es. `v3.4.0`)
- incrementi:
  - `PATCH`: fix compatibili
  - `MINOR`: nuove feature compatibili
  - `MAJOR`: cambi breaking

