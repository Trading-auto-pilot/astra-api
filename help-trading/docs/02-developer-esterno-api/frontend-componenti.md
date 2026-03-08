---
sidebar_position: 4
---

# Frontend — Catalogo componenti (Atomic Design)

I componenti seguono il pattern **Atomic Design** organizzato in quattro livelli: Atoms → Molecules → Organisms → Pages.

```
src/components/
├── atoms/       # Elementi base, nessuna dipendenza da altri componenti interni
├── molecules/   # Combinazioni di atoms con logica specifica
├── organisms/   # Blocchi UI complessi, possono contenere state e side-effect
└── pages/       # Route-level components, una per schermata applicativa
```

---

## Atoms

Componenti elementari e riutilizzabili. Non contengono logica di business.

### `atoms/base/buttons/`
| Componente | Descrizione |
|---|---|
| `BaseButton` | Button con varianti (solid, outline, ghost). Base per tutti i button del progetto. |
| `IconButton` | Button icona-only. |
| `UploadButton` | Button che apre un file picker. |

### `atoms/form/`
| Componente | Descrizione |
|---|---|
| `TextInput` | Input testo con label e helper text. |
| `NumberInput` | Input numerico con validazione min/max. |
| `SelectInput` | Dropdown select. |
| `Checkbox` | Checkbox con label. |
| `Badge` | Badge visivo (count, status). |
| `Chip` | Chip selezionabile o removibile. |
| `FormLabel` | Label per elemento form. |
| `FormControl` | Wrapper form con stato error/disabled. |
| `VisuallyHiddenInput` | Input nascosto accessibile (per file upload). |

### `atoms/typography/`
| Componente | Descrizione |
|---|---|
| `Title` | Heading configurabile h1–h6. |
| `Subtitle` | Sottotitolo. |
| `Caption` | Testo piccolo/secondario. |
| `BodyText` | Paragrafo body. |
| `Code` | Testo inline in stile codice. |

### `atoms/icon/`
| Componente | Descrizione |
|---|---|
| `AppIcon` | Wrapper Iconify. Accetta qualsiasi icon set (`mdi:*`, `tabler:*`, ecc.). |
| `AppImage` | Wrapper `<img>` con fallback e lazy loading. |

### `atoms/media/`
| Componente | Descrizione |
|---|---|
| `Logo` | Logo applicazione. |
| `StatusAvatar` | Avatar con indicatore di stato colorato. |
| `AppVideo` | Player video. |

### `atoms/layout/`
| Componente | Descrizione |
|---|---|
| `AnchorLinkContainer` | Wrapper per link con anchor id (usato dallo ScrollSpy). |
| `CardHeaderAction` | Azioni allineate nell'header di una card MUI. |

### `atoms/feedback/`
| Componente | Descrizione |
|---|---|
| `Spinner` | Loading spinner circolare. |

---

## Molecules

Combinazioni di atoms con logica specifica. Possono avere stato locale.

### `molecules/inputs/`
| Componente | Descrizione |
|---|---|
| `ColorPicker` | Selettore colore. |
| `DateRangePicker` | Selezione intervallo date (Day.js + MUI X). |
| `PasswordInput` | Input password con toggle show/hide. |
| `PhoneInput` | Input telefono con formattazione e prefisso paese. |
| `EmojiPicker` | Selettore emoji. |
| `CountrySelect` | Dropdown con flag paese (`react-country-flag`). |
| `DashboardSelectMenu` | Menu select per item dashboard. |

### `molecules/charts/`
| Componente | Descrizione |
|---|---|
| `ECharts` | Wrapper Apache ECharts. |
| `ChartLegend` | Legenda grafico riutilizzabile. |

### `molecules/content/`
| Componente | Descrizione |
|---|---|
| `SectionHeader` | Header sezione con titolo, sottotitolo e azioni. |
| `CodeBlock` | Blocco codice con syntax highlighting. |
| `LiveProvider` | Provider per live code editor. |
| `TextResolverHelpModal` | Modal con documentazione dei placeholder `[[...]]` supportati dal `textResolver`. |

### `molecules/navigation/`
| Componente | Descrizione |
|---|---|
| `DashboardMenu` | Menu laterale sidebar del dashboard con supporto nesting. |
| `UserMenu` | Dropdown menu utente (logout, profilo). |
| `ScrollSpy` | Navigation che evidenzia automaticamente la voce corrispondente alla sezione visibile. |
| `ScrollSpyNavItem` | Singola voce dello ScrollSpy. |
| `ScrollSpyContent` | Contenitore sezione per ScrollSpy. |

### `molecules/loading/`
| Componente | Descrizione |
|---|---|
| `PageLoader` | Loader a schermo intero per transizioni di pagina. |
| `DefaultLoader` | Loader standard inline. |
| `Splash` | Splash screen all'avvio dell'app. |

### `molecules/feedback/`
| Componente | Descrizione |
|---|---|
| `SnackbarIcon` | Snackbar con icona colorata per feedback azioni. |
| `SnackbarCloseButton` | Bottone di chiusura per snackbar. |

### `molecules/pagination/`
| Componente | Descrizione |
|---|---|
| `TableLabelDisplayedRows` | Etichetta "N–M di tot" per tabelle MUI. |
| `CustomTablePaginationAction` | Azioni paginazione personalizzate (prima, precedente, prossima, ultima). |

### `molecules/upload/`
| Componente | Descrizione |
|---|---|
| `FileDropZone` | Area drag-and-drop per upload file (`react-dropzone`). |
| `FileDropBox` | Box contenitore drop zone. |
| `FilePreview` | Anteprima file caricato. |

### `molecules/microservice/`
Card riutilizzabili per la pagina di dettaglio di ogni microservizio:

| Componente | Descrizione |
|---|---|
| `MicroserviceGeneralTab` | Tab info generali (release, health, versione). |
| `MicroserviceCommunicationChannelsCard` | Card per gestire i canali Redis del microservizio. |
| `MicroserviceDataProviderCard` | Card per il data provider configurabile. |
| `MicroserviceDbSettingsCard` | Card impostazioni DB logger. |
| `MicroserviceIbkrBridgeCard` | Card specifica IBKR Bridge. |
| `MicroserviceLogsCard` | Card log viewer del microservizio. |

### `molecules/settings/`
Pannello impostazioni UI (tema, direzione testo, layout nav):

| Componente | Descrizione |
|---|---|
| `ThemeModeToggleTab` | Toggle dark/light mode. |
| `TextDirectionPanel` | Selezione LTR/RTL. |
| `SidenavShapePanel` | Forma sidenav (rounded, flat). |
| `TopnavShapePanel` | Forma top nav. |
| `NavColorPanel` | Colore navigation. |
| `SettingsItem` | Item singolo nel pannello settings. |
| `SettingPanelToggler` | Bottone toggle apertura pannello. |
| `SettingsPanelRadioGroup` | Radio group nel pannello settings. |

### `molecules/layout/`
| Componente | Descrizione |
|---|---|
| `SimpleBar` | Scrollbar custom stilizzata. |
| `VibrantBackground` | Background con effetto vibrante/gradiente. |

### `molecules/styled/`
Componenti MUI pre-stilizzati con Emotion:

| Componente | Descrizione |
|---|---|
| `OutlinedBadge` | Badge con stile outlined. |
| `StyledChip` | Chip con varianti custom. |
| `StyledFormControl` | FormControl con spacing predefinito. |

### `molecules/media/`
| Componente | Descrizione |
|---|---|
| `Lightbox` | Visualizzatore immagine a schermo intero. |
| `Swiper` | Slider/carousel. |

### `molecules/calendar/`
| Componente | Descrizione |
|---|---|
| `FullCalendar` | Calendario interattivo. |

---

## Organisms

Blocchi UI complessi con logica e side-effect. Combinano molecules e contengono spesso chiamate API o accesso al context.

| Componente | Path | Descrizione |
|---|---|---|
| `AuthGuard` | `organisms/auth/` | HOC che redirige a login se l'utente non è autenticato. |
| `GuestGuard` | `organisms/auth/` | HOC che redirige alla dashboard se l'utente è già loggato. |
| `SettingsPanel` | `organisms/settings/` | Pannello laterale completo per le impostazioni UI (tema, layout). |
| `SvelteGanttChart` | `organisms/gantt/` | Gantt chart per la visualizzazione temporale dei job scheduler. |
| `Mapbox` | `organisms/map/` | Mappa interattiva Mapbox. |

---

## Pages

Componenti route-level. Ogni Page corrisponde a una schermata dell'app. Contengono tutta la logica di pagina (fetch dati, stato locale, composizione di organisms/molecules).

Vedi la documentazione completa in [Pagine e sezioni applicative](./frontend-pagine.md).
