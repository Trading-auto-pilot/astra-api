---
sidebar_position: 2
---

# Users

La pagina **Users** permette la gestione completa degli utenti della piattaforma: creazione, modifica e rimozione.

## Lista utenti e creazione nuovo utente

<img
  src="/img/utente/navigazione/users-lista.png"
  alt="Lista utenti e pulsante nuovo utente"
  style={{ width: "100%", maxWidth: "950px", display: "block", margin: "0 auto" }}
/>

Da questa vista puoi:

- visualizzare tutti gli utenti registrati;
- controllare stato (`Active`) e tipo (`Service`);
- creare un nuovo utente con il pulsante **Nuovo utente**.

### Differenza tra utente ordinario e utente Service

Nel backend (`authService`) il flag `Service` viene salvato come `is_service`:

- `Service = No`: utente ordinario (`type: "user"` nel token JWT).
- `Service = Yes`: utente di servizio (`type: "service"` nel token JWT), tipicamente usato per integrazioni/automazioni.

### Primo login e ultimo accesso

Alla creazione di un nuovo utente, al **primo login** il sistema richiede il cambio password.

Questo comportamento e basato sul campo `last_login_at`:

- se `last_login_at` e `null`, il login risponde con `requires_password_reset=true`;
- dopo login valido, `authService` aggiorna `last_login_at`;
- il timestamp e visibile nella colonna **Last login** della lista utenti.

## Modifica o eliminazione utente esistente

<img
  src="/img/utente/navigazione/users-dettaglio.png"
  alt="Dettaglio utente per modifica o eliminazione"
  style={{ width: "100%", maxWidth: "950px", display: "block", margin: "0 auto" }}
/>

Nel dettaglio utente puoi:

- aggiornare dati principali (nome, email, stato);
- gestire permessi applicativi;
- configurare la navigazione client disponibile per l'utente;
- salvare le modifiche con **Save**;
- eliminare l'utente con **Delete this user** (azione irreversibile).

### Eliminazione utente

Cliccando **Delete this user** viene richiesta una conferma. Dopo la conferma, l'utente viene eliminato dal sistema.

### Modifica utente: campi e comportamento

Le informazioni gestite in modifica sono le stesse della creazione:

- stato utente: `Active` / `non Active`;
- tipo utente: `Service` / ordinario;
- ruolo: `Admin` / ordinario.

Quando abiliti `Admin`, vengono applicati i diritti admin di default (evidenziati dal banner giallo) e non possono essere rimossi manualmente.

### Sezione Permissions

Nella sezione **Permissions** si configurano i permessi sulle chiamate backend con:

- `HTTP METHOD`
- `RESOURCE PATTERN` (path)

E possibile usare il carattere wildcard `*` nei path.

### Sezione Client Navigation

Nella sezione **Client Navigation** si definiscono pagine e sottopagine che l'utente puo navigare nel frontend.
