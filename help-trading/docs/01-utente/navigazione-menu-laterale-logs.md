---
sidebar_position: 4
---

# Logs

La pagina **Logs** permette di leggere i log dal backend e osservare i log live ricevuti via websocket.

## Barra filtri (parte superiore)

<img
  src="/img/utente/navigazione/logs-filtri.png"
  alt="Logs con barra filtri"
  style={{ width: "100%", maxWidth: "950px", display: "block", margin: "0 auto" }}
/>

Nella parte superiore e presente la barra dei filtri. Puoi filtrare per:

- livello: `ERROR`, `WARNING`, `INFO`, `LOG`, `TRACE`;
- formato orario: `UTC` oppure `Asia/Dubai`;
- microservizio;
- modulo;
- funzione;
- data (intervallo);
- testo messaggio;
- reset completo dei filtri.

E disponibile anche il flag **Questo servizio** (quando la scheda Logs e aperta dentro la pagina di un microservizio):

- se attivo, i log vengono filtrati automaticamente per quel microservizio;
- il filtro viene applicato sia ai log letti dal backend sia ai log live websocket.

## Tipi di log visualizzati

I log letti dal backend:

- hanno sfondo bianco;
- hanno ID numerico.

I log live via websocket:

- hanno sfondo giallo paglierino;
- hanno ID che inizia con `L`.

Con il tasto **Aggiorna**:

- i log live temporanei spariscono;
- la tabella viene riletta dal backend e le righe tornano nel formato persistito.

## Paginazione (parte inferiore)

<img
  src="/img/utente/navigazione/logs-paginazione.png"
  alt="Logs con barra di paginazione"
  style={{ width: "100%", maxWidth: "950px", display: "block", margin: "0 auto" }}
/>

Nella parte bassa e presente la barra di paginazione:

- puoi impostare il numero di record per pagina (limite della query/select);
- puoi navigare tra le pagine dei risultati con i controlli di paginazione.

