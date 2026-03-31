---
sidebar_position: 6
title: Frontend — Miglioramenti e fix
---

# Frontend — Miglioramenti e fix: note di brainstorm

> Documento di lavoro generato il 22 marzo 2026.
> Raccoglie tutti i punti emersi dal brainstorm. Da trasformare in ticket/task.

---

## 1. BUG LAYOUT — Schede che terminano oltre la status bar

### Problema

In diverse pagine dei microservizi, il contenuto delle schede (tab content, liste scrollabili, card) si estende oltre la barra di stato fissa in fondo alla pagina. L'ultimo elemento non è visibile o non è cliccabile. Non è solo un problema estetico — è un bug di usabilità che impedisce l'interazione con i controlli in fondo alla lista.

### Soluzione strutturale consigliata

Introdurre una CSS custom property globale `--status-bar-height` a livello di `:root` e usarla in tutti i componenti affetti. Questo garantisce che se in futuro l'altezza della status bar cambia, si modifica un solo valore e il fix si propaga ovunque.

```css
:root {
  --status-bar-height: 32px;        /* adattare al valore reale */
  --top-bar-height: 56px;           /* adattare al valore reale */
  --content-bottom-offset: calc(var(--status-bar-height) + 5px);
}

/* Classe riutilizzabile da applicare a tutti i contenitori scrollabili */
.microservice-tab-content {
  max-height: calc(
    100vh
    - var(--top-bar-height)
    - var(--content-bottom-offset)
  );
  overflow-y: auto;
}
```

Il margine di **5px** sopra la status bar è il valore concordato — non a filo, non sovrapposto.

### Pagine affette confermate

| Pagina / Sezione | Elemento affetto | Note |
|-----------------|-----------------|------|
| `/admin/microservice/cachemanager` | Tutte le schede | Tutte le tab si estendono oltre |
| `/admin/microservice/cachemanager` | Lista simboli in cache | Lista scrollabile — ultimo elemento non cliccabile |
| `alertingservice` → tab **Rule Engine** | Scheda delle regole | Lista regole finisce dietro la barra |
| `tickerScanner` | Schede del microservizio | Stesso problema di layout |

:::warning
Il problema è probabilmente presente in tutti i microservizi con tab scrollabili. Prima di fixare caso per caso, fare un audit visivo rapido di tutti i microservizi e aggiungere a questa lista ogni ulteriore occorrenza.
:::

### Approccio di fix consigliato

1. Aggiungere `--status-bar-height` e `--content-bottom-offset` al CSS globale/tema
2. Identificare il selettore comune dei contenitori tab (es. `.tab-pane`, `.v-tab-content`, `.tab-content`)
3. Applicare `max-height` + `overflow-y: auto` una sola volta sul selettore comune — non componente per componente
4. Verificare visivamente su tutti i microservizi
5. Se alcune schede hanno altezze diverse (es. toolbar interna aggiuntiva), usare `calc()` con offset aggiuntivo per quei casi specifici

---

## 2. CacheManager — Logo/immagini ticker da Polygon.io

### Backend — Recupero loghi

Durante `scanUniverse`, per ogni simbolo chiamare:

```
GET https://api.polygon.io/v3/reference/tickers/{ticker}?apiKey=...
```

Campi rilevanti nella risposta:
- `results.branding.logo_url` — logo full width (SVG, per uso in header/dettaglio)
- `results.branding.icon_url` — logo quadrato tipo favicon (per uso in liste)

**Strategia di storage consigliata — Opzione B (locale):**

Scaricare i file SVG/PNG durante lo scan e salvarli nel filesystem del container cacheManager in una directory `./branding/`:

```
./branding/
  AAPL/
    icon.svg
    logo.svg
  NVDA/
    icon.svg
    logo.svg
```

Serviti come static files da un endpoint dedicato:
```
GET /branding/{symbol}/icon
GET /branding/{symbol}/logo
```

Vantaggi: zero dipendenza da Polygon in runtime, zero quota consumata per il rendering del frontend, velocità.

**Campi da aggiungere alla tabella `universe`:**

```sql
ALTER TABLE universe
  ADD COLUMN branding_logo_url  VARCHAR(500) NULL,
  ADD COLUMN branding_icon_url  VARCHAR(500) NULL,
  ADD COLUMN branding_cached_at DATETIME NULL;
```

`branding_cached_at` permette di aggiornare i loghi periodicamente (es. mensile) senza riscaricaricare tutto l'universo.

**Fallback frontend:** per simboli senza branding Polygon, generare un avatar con le iniziali del ticker su sfondo colorato deterministico (colore derivato dall'hash del ticker — stesso simbolo = sempre stesso colore):

```javascript
function tickerColor(symbol) {
  const hash = symbol.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const hue  = hash % 360;
  return `hsl(${hue}, 60%, 45%)`;
}
```

### Frontend — Utilizzo dei loghi

| Dove | Elemento | Dimensione consigliata |
|------|----------|----------------------|
| Lista simboli cache `/admin/microservice/cachemanager` | `icon` accanto al ticker | 24×24px |
| Dettaglio simbolo (se esiste) | `logo` in header | 120px width auto height |
| Pagina overview posizioni aperte | `icon` accanto al ticker | 24×24px |
| Ranking ticker / universe | `icon` accanto al ticker | 24×24px |

---

## 3. CacheManager — Indicatore qualità semaforo per ticker

### Design semaforo a 4 livelli

| Score | Colore | Label | Significato operativo |
|-------|--------|-------|----------------------|
| 90–100 | 🟢 Verde | Ottimo | Cache completa, dati freschi |
| 70–89 | 🟡 Giallo | Buono | Qualche gap minore o mese corrente non freschissimo |
| 40–69 | 🟠 Arancio | Degradato | File vuoti o gap significativi — SMA potrebbe essere imprecisa |
| 0–39 | 🔴 Rosso | Critico | Dati gravemente incompleti — SMA_200 a rischio |

### Rendering nella lista ticker

Ogni riga della lista simboli mostra:

```
[icon] NVDA    🟢 94%   ████████████░░  22 candele/mese  Agg: 2h fa
[icon] UTI     🔴 31%   ████░░░░░░░░░░  File vuoti       Agg: 3gg fa
[icon] AAPL    🟠 58%   ███████░░░░░░░  Gap interni      Agg: 1gg fa
```

- **Dot colorato** (●) + **percentuale** — compatto, leggibile a colpo d'occhio
- **Barra orizzontale sottile** — rappresentazione visiva dello score
- **Label breve** — causa principale del degrado (se score < 90)
- **Timestamp** dell'ultimo aggiornamento della cache per quel simbolo

### Tooltip/modal al click sul semaforo

Cliccando sul semaforo si apre un tooltip o pannello laterale con il breakdown:

```
NVDA — Qualità cache: 94/100  🟢

  Completeness  ████████████░  98%   (11/12 mesi presenti)
  Gap score     ███████████░░  92%   (227/247 giorni)
  Validity      ████████████   100%  (tutte le candele valide)
  Freshness     █████████░░░░  78%   (aggiornato 14h fa)

  Ultimo inspect: 22/03/2026 06:00
  [▶ Run Inspect]  [🗑 Clear Cache]
```

---

## 4. CacheManager — Sezione Data Provider con 4° provider e quality score

### Card per provider (layout proposto)

```
┌──────────────────────────────────────┐
│ 🟢  ALPACA                  Score 98 │
│  Storico illimitato                  │
│  Recency: ~T-15gg (SIP limit)        │
│  Chiamate oggi: —                    │
└──────────────────────────────────────┘
┌──────────────────────────────────────┐
│ 🟢  POLYGON                 Score 95 │
│  Storico: fino a 2 anni              │
│  Recency: T-1 (chiusura ieri)        │
│  Chiamate oggi: 142                  │
└──────────────────────────────────────┘
┌──────────────────────────────────────┐
│ 🟡  FMP                     Score 71 │
│  Storico completo                    │
│  Quota mensile: 1.247 / 10.000       │
│  Chiamate oggi: 89                   │
└──────────────────────────────────────┘
┌──────────────────────────────────────┐
│ 🟢  IBKR                    Score 92 │
│  Mercati: US, EU (da verificare)     │
│  Connessione: ✓ attiva               │
│  Chiamate oggi: 34                   │
└──────────────────────────────────────┘
```

### Quality score totale sistema

In cima alla sezione provider, un indicatore prominente:

```
┌─────────────────────────────────────────────────┐
│  QUALITÀ CACHE UNIVERSO           87 / 100  🟢  │
│  ████████████████████░░░░                       │
│  Simboli OK: 138   Degradati: 4   Critici: 0    │
│  Ultimo inspect: 22/03/2026 06:00               │
│                          [▶ Run Inspect Now]    │
└─────────────────────────────────────────────────┘
```

---

## 5. Overview — Widget Liquidity Manager

### Verifica duplicazione codice

Prima di aggiungere funzionalità, verificare nel codice frontend che:

- [ ] Il widget overview chiama lo stesso endpoint del microservizio (`/liquidity-manager/liquidity-score`) e non un endpoint proxy/aggregato che duplica logica
- [ ] La logica di rendering (colori regime, soglie, label) è in un componente condiviso `<LiquidityScoreCard>` e non scritta inline due volte
- [ ] Se la logica è duplicata → estrarre il componente condiviso prima di aggiungere nuovi campi

### Score lento e score giornaliero

Con i miglioramenti proposti per il liquidity-manager (EMA fast/slow), il widget deve mostrare entrambi:

```
┌──────────────────────────────────────────┐
│  LIQUIDITY SCORE                         │
│                                          │
│  Score giornaliero (fast)   72           │
│  ████████████░░░░░░░░░                   │
│                                          │
│  Score strutturale (slow)   68           │
│  ███████████░░░░░░░░░░░                   │
│                                          │
│  Regime:     🟡 NEUTRAL                  │
│  Volatilità: 🟡 NORMAL  (VIX: 18.4)     │
│  Confidence: 85%                         │
│  EMA staleness: 0 giorni                 │
└──────────────────────────────────────────┘
```

Mostrare la **divergenza** fast/slow quando significativa (es. fast < slow - 10) con un indicatore visivo — segnala che c'è uno spike temporaneo, non un cambio di regime reale.

### Dettaglio 4 componenti (sezione espandibile)

```
▼ Dettaglio componenti

  VIX           Score: 45   Peso: 35%   Contributo: 15.75   🔴
  SPY Trend     Score: 78   Peso: 35%   Contributo: 27.30   🟢
  DXY           Score: 62   Peso: 15%   Contributo:  9.30   🟡
  Credit Spread Score: 71   Peso: 15%   Contributo: 10.65   🟡
                                        ──────────────────
                              Totale:        63.00

  Confidence: 85%  (4/4 componenti disponibili)
  Alpha EMA last:  0.17  (confidence-weighted)
  EMA staleness:   0 giorni
```

Se un componente non è disponibile, mostrarlo esplicitamente:

```
  DXY           ⚠️ N/D      Peso: 15%   Contributo: —       ⚫
```

### Fix volatilità mai riportata

Il campo `volatilityRegime` (`LOW`, `NORMAL`, `HIGH`, `UNKNOWN`) esiste nella risposta del liquidity-manager ma non viene renderizzato.

**Cause probabili da verificare:**
1. Typo nel nome campo — il componente legge `volatility_regime` ma l'API restituisce `volatilityRegime` (o viceversa)
2. Il case `UNKNOWN` non è mappato → rendering vuoto
3. Il campo non arriva quando VIX non è disponibile — il componente non gestisce `undefined`

**Fix:**

```javascript
// Sempre definire un fallback esplicito per ogni valore possibile
const VOLATILITY_MAP = {
  LOW:     { label: 'Bassa',   color: 'green',  icon: '🟢' },
  NORMAL:  { label: 'Normale', color: 'yellow', icon: '🟡' },
  HIGH:    { label: 'Alta',    color: 'red',    icon: '🔴' },
  UNKNOWN: { label: 'N/D',     color: 'gray',   icon: '⚫' },
};

// Usare ?? 'UNKNOWN' per gestire undefined/null
const volatility = VOLATILITY_MAP[score.volatilityRegime ?? 'UNKNOWN'];
```

Mostrare sempre la volatilità — anche `N/D` è informativo (segnala che VIX non è disponibile).

---

## 6. General Settings — Grayout quando servizio è spento

### Comportamento desiderato

Se un microservizio non è in stato `READY`/`OK`, il tab **General Settings** si apre ma il contenuto è:
- Visibile in sola lettura (i valori attuali rimangono visibili — utili per diagnostica)
- Coperto da un overlay semitrasparente
- Con un banner prominente in cima

```
┌──────────────────────────────────────────────┐
│  ⚠️  Servizio non in esecuzione              │
│  I settings sono in sola lettura.            │
│  Avvia il servizio per modificarli.          │
└──────────────────────────────────────────────┘
│  [contenuto grayout sotto]                   │
```

### Comportamento tecnico

- Tutti gli `<input>`, `<select>`, `<textarea>` → attributo `disabled` (non solo `readonly`)
- Il bottone "Salva" → nascosto o `disabled` con tooltip "Servizio offline"
- I valori restano visibili — non nasconderli

### Implementazione come composable riutilizzabile

```javascript
// composables/useServiceStatus.js
export function useServiceStatus(serviceUrl) {
  const isRunning = ref(false);
  const status    = ref('UNKNOWN');

  const checkStatus = async () => {
    try {
      const res   = await axios.get(`${serviceUrl}/status/health`);
      const s     = res.data?.status ?? 'UNKNOWN';
      isRunning.value = ['OK', 'READY'].includes(s);
      status.value    = s;
    } catch {
      isRunning.value = false;
      status.value    = 'UNREACHABLE';
    }
  };

  onMounted(checkStatus);
  const interval = setInterval(checkStatus, 30_000); // refresh ogni 30s
  onUnmounted(() => clearInterval(interval));

  return { isRunning, status };
}
```

```html
<!-- Nel template del tab General Settings -->
<ServiceOfflineBanner v-if="!isRunning" :status="status" />

<fieldset :disabled="!isRunning" class="settings-form">
  <!-- tutti gli input ereditano disabled dal fieldset -->
  ...
</fieldset>

<button :disabled="!isRunning" @click="save">Salva</button>
```

Usare `<fieldset disabled>` è la soluzione più elegante — tutti gli input figli ereditano automaticamente `disabled` senza toccarli uno per uno.

### Microservizi dove va applicato

Vale per **tutti** i microservizi con tab General Settings:

- tickerScanner
- cacheManager
- decision-engine
- liquidity-manager
- capital-manager
- alertingService
- market-data-service
- ibkr-bridge
- serviceControlPlane

---

## TODO — Da esplorare nei prossimi brainstorm

- [ ] Pagine overview: altri widget da verificare per duplicazione logica
- [ ] Mobile: adattamento responsive delle pagine microservizi
- [ ] Dark/light mode: consistenza colori semaforo in entrambe le modalità
- [ ] Accessibility: tab navigation e screen reader per le nuove card provider
- [ ] Performance: lazy loading loghi ticker per liste lunghe (IntersectionObserver)

---

*Documento da aggiornare man mano che emergono nuovi punti nel brainstorm.*
