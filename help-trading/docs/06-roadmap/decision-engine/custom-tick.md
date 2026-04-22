---
sidebar_position: 4
title: Custom Tick
---

# Custom Tick

## Obiettivo

Consentire all'utente di aggiungere manualmente uno o più titoli a quelli prodotti dal TickerScanner, in modo che il Decision Engine applichi su di essi **la stessa identica logica di valutazione** già operativa sugli altri strumenti: livelli tecnici, flag, guardrail, ingresso, SL e TP.

Il flusso si distingue dalla normale pipeline perché il punto di ingresso non è generato algoritmicamente ma **scelto dall'utente**, che tuttavia delega al sistema la gestione di tutto ciò che segue.

---

## Casi d'uso

- L'utente vuole seguire un titolo specifico (es. dopo una notizia o un'analisi personale) senza attendere che il TickerScanner lo includa nel ranking.
- L'utente vuole affiancare alla lista prodotta dal ranking una lista stabile di ETF settoriali come proxy di mercato.
- L'utente vuole testare rapidamente un'idea operativa su un ticker preciso, sfruttando tutti i guardrail già in produzione.

---

## Funzionalità previste

### 1. Watchdog su titoli custom

L'utente può definire una lista di ticker da monitorare continuativamente, indipendentemente dal TickerScanner. Ogni giorno, al momento della valutazione live, questi ticker vengono affiancati automaticamente alla lista prodotta dal ranking giornaliero.

Comportamento atteso:
- I ticker custom passano per lo stesso pipe del Decision Engine (spot-finder, flag evaluation, live update).
- I ticker custom non scalano posizioni nella lista di ranking: coesistono con essa.
- La lista è configurabile per utente/pipe e persiste tra una sessione e l'altra.

### 2. Ingresso su tick deciso dall'utente

Anziché attendere che il sistema individui autonomamente un setup, l'utente può richiedere esplicitamente la valutazione di un ticker in un momento preciso. Il sistema risponde proponendo:

- **Punto di ingresso** (entry price) basato sul livello tecnico più vicino e sulla logica attuale di breakout/pullback/retracement.
- **Stop Loss** calcolato secondo la logica ATR già in uso (o basato sul livello di supporto/resistenza).
- **Take Profit** calcolato con il rapporto rischio/rendimento configurato nella pipe.

Tutti e tre i valori sono **editabili dall'utente** prima della conferma: il sistema propone, l'utente decide.

### 3. Filtro su eventi a calendario

Prima di validare l'ingresso su un tick custom, il sistema verifica la presenza di eventi economici rilevanti nelle ore successive (earnings, FOMC, dati macro). Se sono presenti eventi ad alto impatto, l'ingresso viene bloccato o segnalato con un warning, con possibilità di override manuale.

Fonti dati previste:
- Feed calendario economico (es. integrazione con il servizio già usato per i filtri live).
- Flag di prossimità earnings (già parzialmente disponibile nel Decision Engine).

### 4. Riuso della logica di ingresso esistente

Il flusso custom non reimplementa la logica: richiama gli stessi moduli già in uso per i ticker automatici.

Moduli coinvolti:
- `spotFinder` — individuazione livelli tecnici e flag pattern.
- `live-manager` — aggiornamento flags in tempo reale su candle live.
- `guardrail` — verifiche pre-ordine (capitale disponibile, exposure, cooldown).
- `fillEngine` (in sim mode) — simulazione fill per preview prima dell'invio reale.

### 5. Watchdog giornaliero affiancato al TickerScanner

Un job schedulato giornaliero (simile al job ranking) processa la lista dei ticker custom dell'utente insieme a quelli prodotti dal TickerScanner. L'output è una lista unificata che alimenta il live update della sessione.

Flusso previsto:

```
TickerScanner ranking job
         +
Lista ticker custom utente
         ↓
Merge → spot-finder per ogni ticker
         ↓
Snapshot Redis per sessione live
         ↓
Live update su candle intraday
         ↓
Ingresso / Guardrail / Ordine
```

---

## Configurazione per utente/pipe

I ticker custom sono associati alla pipe dell'utente e configurabili tramite frontend (tab Configurazione Pipe):

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `customTickers` | `string[]` | Lista di ticker da affiancare al ranking |
| `customTickerTf` | `string` | Timeframe da usare per la valutazione (default: quello della pipe) |
| `calendarFilterEnabled` | `boolean` | Attiva il blocco su eventi a calendario ad alto impatto |
| `calendarFilterHoursAhead` | `number` | Ore di anticipo per considerare un evento "imminente" (default: 4) |

---

## Proposta UI

Nel frontend (tab live del Decision Engine o pagina dedicata):

1. **Campo ticker** — l'utente digita o cerca il ticker da aggiungere.
2. **Bottone "Analizza"** — avvia la valutazione spot-finder sul ticker e mostra entry / SL / TP proposti.
3. **Form editabile** — l'utente può modificare entry, SL e TP prima di confermare.
4. **Warning calendario** — se ci sono eventi imminenti, appare un banner con l'elenco degli eventi e la possibilità di procedere comunque.
5. **Bottone "Aggiungi a watchdog"** — aggiunge il ticker alla lista persistente affiancata al ranking giornaliero.

---

## Note implementative

- La lista custom deve essere salvata nel database della pipe (tabella `pipe_config` o equivalente), non solo in memoria.
- Il merge con la lista ranking deve avvenire **prima** del calcolo dello snapshot Redis, non dopo, per garantire che i ticker custom ricevano il pieno ciclo di valutazione.
- Il filtro calendario deve essere opzionale e disattivabile per singola pipe, per non interferire con strategie che operano deliberatamente in prossimità di eventi.
- L'override manuale di entry/SL/TP deve essere loggato con `symref` per tracciabilità completa.
