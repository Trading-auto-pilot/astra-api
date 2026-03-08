---
sidebar_position: 5
---

# Rollback stabile e ambiente congelato

Tornare a un tag Git non basta, da solo, a ricreare un ambiente identico.

## Cosa serve per rollback affidabile

1. Codice:
- tag git su `trading-system` e `astraai`.

2. Immagini Docker:
- tag immagine esistenti su registry;
- meglio ancora digest immutabili (`image@sha256:...`).

3. Configurazione runtime:
- snapshot file `.env` dell'ambiente (`paper` o `live`).

4. GitHub Environment:
- `vars` e `secrets` coerenti con la release.

5. Infrastruttura:
- compose, Traefik, DNS/certificati allineati alla release.

6. Dati:
- backup DB compatibile con quella versione applicativa.

## Procedura sintetica di ritorno a una versione

1. Checkout/branch dal tag in entrambi i repository.
2. Se necessario, re-deploy delle immagini della stessa versione.
3. Ripristino snapshot `.env` e variabili Environment.
4. Ripristino DB dal backup coerente.
5. Avvio stack e smoke test.

## Rischi tipici se manca il congelamento

- codice corretto ma variabili diverse;
- immagini taggate uguali ma contenuto diverso;
- mismatch schema DB vs codice;
- comportamenti diversi su integrazioni esterne.

