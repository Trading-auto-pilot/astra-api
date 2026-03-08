---
sidebar_position: 1
---

# Come creare un alert

Questa guida mostra il flusso operativo per creare e gestire una regola alert dal pannello admin.

## Immagine 1 - Elenco alert esistenti

![Elenco regole alert](/img/utente/alertmanager/alert-create-step-1.png)

Nella tabella vedi tutte le regole configurate, il loro stato e l'ultimo run.

- Le icone sulla sinistra della riga permettono di modificare o cancellare la regola.
- In alto a destra trovi `Ricarica regole` e `Nuova regola`.
- `Ricarica regole` forza il reload del motore alerting (utile dopo modifiche massive o aggiornamenti catalogo).
- `Nuova regola` apre il wizard di creazione.

## Immagine 2 - Nuova regola: Step 1 Match

![Nuova regola - Match Logs](/img/utente/alertmanager/alert-create-step-2.png)

All'apertura del modal:

- `Nome regola` e obbligatorio.
- Puoi attivare/disattivare subito la regola con `Attiva la regola`.
- Il wizard ha due step: `Match` e `Actions`.

Nel passo `Match` puoi scegliere due modalita:

- `Logs`: filtri per livelli (`trace/debug/info/warning/error`), microservizio e fuzzy search sul messaggio.
- `Eventi`: match su catalogo eventi (`microservizio + eventKey`) con metadati associati.

:::warning Uso dei Log alert
Gli alert basati su log vanno usati come eccezione temporanea. Tenere regole log sempre attive implica ascolto continuo di una coda molto busy (`*.logs.*`). Per regole stabili, preferisci gli eventi da catalogo.
:::

## Immagine 3 - Match su catalogo eventi (scelta consigliata)

![Nuova regola - Match Eventi](/img/utente/alertmanager/alert-create-step-3.png)

Questo approccio e il piu robusto:

- scegli `Microservizio evento`;
- scegli l'`Evento` dal catalogo;
- verifica `Description` e `Severity` proposte.

Poi clicca `NEXT` per passare allo step `Actions`.

## Immagine 4 - Step 2 Actions

![Nuova regola - Actions](/img/utente/alertmanager/alert-create-step-4.png)

Nello step `Actions` configuri come inviare la notifica:

- canali di invio: `WhatsApp`, `Email` (uno o entrambi);
- destinatari email e subject;
- template messaggio.

Nel template puoi usare i tag dinamici, per esempio:

- `{{message}}`, `{{id}}`, `{{service}}`, `{{function}}`
- `{{time}}`, `{{level}}`, `{{module}}`

Infine clicca `Crea regola` per salvare.

## Link utili

- [Catalogo eventi (alert disponibili)](./alertmanager-catalogo-eventi)
- [Pagina principale alertmanager](./alertmanager)

:::info Screenshot reali
Se vuoi, al prossimo passaggio sostituisco i file immagine con i tuoi screenshot reali mantenendo questa struttura e i testi.
:::
