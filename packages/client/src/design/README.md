# Quiltor Design-System

Dieser Ordner ist die verbindliche Quelle für Quiltors wiederverwendbare visuelle Sprache,
UI-Komponenten und deren Qualitätsvertrag.

## Öffentliche Einstiege

Produktcode importiert React-APIs ausschließlich aus dem öffentlichen Barrel:

```tsx
import { Button, ConfirmDialog, TextField, WorkspaceToolbar } from "../../design";
```

Nicht erlaubt sind Deep Imports aus `design/primitives`, `design/components`, `design/patterns` oder
`design/internal`. Die frühere Übergangsschicht `shared/ui` ist entfernt; Importe daraus sind ohne
Ausnahme verboten. Nicht visuelle Hilfen liegen bei ihrem App-, Modul- oder Shared-Owner.

`index.css` ist der globale Einstieg für Foundations. Dazu gehört `typography.css` mit den kleinen
semantischen Text-Utilities `.muted` und `.section-label`; es enthält keine interaktiven oder
strukturellen UI-Rezepte. React-Komponenten importieren ihre colocated Styles selbst; Produkt-CSS
darf deren Darstellung nicht neu definieren.

## Schichten und Ownership

```text
app/modules -> patterns -> components -> primitives -> foundations
```

- **Foundations**: Farben, semantische Tokens, Themes, Typografie, Materialien und Motion.
- **Primitives**: dünne, zugängliche Bausteine über nativen Controls.
- **Components**: zusammengesetzte, fachneutrale UI wie Dialog, Toolbar oder SidePanel.
- **Patterns**: wiederkehrende, weiterhin fachneutrale Abläufe wie ConfirmDialog oder CommandPalette.
- **Internal**: nicht öffentliche Implementierungsdetails.

Design-Code importiert weder Produktmodule noch Plattformadapter. Übersetzte und fachliche Texte
werden immer über Props übergeben; Design-Komponenten verwenden kein `useI18n`.

Jeder öffentliche Ordner besitzt genau einen visuellen Owner. Lose Styles direkt unter
`design/components` sind verboten. Es gibt keinen Legacy-Styles-Einstieg mehr. `design/internal`
enthält ausschließlich nicht öffentliche Implementierungsdetails wie den gemeinsamen
Overlay-Fokusvertrag.

## Fünf Akzentfamilien als semantischer Vertrag

Akzentfarbe kommuniziert Bedeutung und darf nicht nur Dekoration sein. Jede Akzentfamilie besitzt
vier Rollen: `base` für graphische Fills und starke Marken, `soft` für getönte Flächen, `text` für
kleine Schrift und Icons sowie `border` für Zustandsränder und Linien.

| Familie  | Bedeutung                                           | Typische Verwendung                               |
| -------- | --------------------------------------------------- | ------------------------------------------------- |
| Gold     | Marke, aktive Auswahl und aktueller Arbeitskontext  | Selection, aktive Navigation, priorisierte Aktion |
| Rose     | Fehler, destruktive Aktion und entferntes Element   | Error, Danger, Diff-Delete, Beziehungsgraph       |
| Moss     | Erfolg, Bestätigung und hinzugefügtes Element       | SaveStatus, Success, Diff-Add, Präsenzmarke       |
| Ink Blue | Tastaturfokus, Information, Link und Editierziel    | Focus Ring, Info, Link, Drop-Fläche               |
| Copper   | ausschließlich Warning und konfliktfreie Vorwarnung | Warning Alert/Toast/Banner/Formfeedback           |

Für Text und Icons wird immer `*-text`, für bedeutungstragende Linien und Ränder `*-border` und
für getönte Hintergründe `*-soft` verwendet. `base` bleibt graphischen Fills vorbehalten.
Komponenten konsumieren bevorzugt semantische Rollen wie `--info-*`, `--success-*`,
`--warning-*`, `--error-*`, `--accent-primary-*` und `--focus-*`. Produkt-CSS verwendet direkte
Familienrollen nur in explizit geprüften Visualisierungen.

Goldene Akzente ersetzen niemals Copper-Warning oder Rose-Error/Danger. Die Kontrasttests lösen
auch Alias-Ketten auf und sichern kleine Schrift mit mindestens 4,5:1 sowie nicht-textuelle
Zustände mit mindestens 3:1 in beiden Themes und auf interaktiven Materialflächen ab. Zusätzlich
erzwingen OKLab-Farbdistanz und Hue-Abstand, dass Warning insbesondere im Light Mode klar von Gold
unterscheidbar bleibt.

## Spacing-Rhythmus und Ausnahmeratchet

Die numerische `--space-*`-Skala ist ausschließlich Geometriequelle. Öffentliche Design-CSS-Owner
verwenden für Layoutabstände semantische `--spacing-*`-Rollen aus vier geprüften Rhythmen:

| Rhythmus | Werte    | Einsatz                                      |
| -------- | -------- | -------------------------------------------- |
| Optical  | 1–4 px   | feine Icon-, Label- und Fokusbeziehungen     |
| Compact  | 6–8 px   | dichte Controls und zusammengehörige Inhalte |
| Regular  | 12–16 px | Karten, Felder und reguläre Inhaltsgruppen   |
| Section  | 24–32 px | Panels, Abschnitte und große Inhaltsflächen  |

Die bestehenden 9-/10-px-Beziehungen sind als benannte `--spacing-transition-*`-Rollen
eingefroren. Neue Transition-Rollen sind nicht erlaubt. Der Ratchet prüft alle öffentlichen
Primitive-, Component- und Pattern-CSS-Dateien für `padding`, `margin`, `gap`, logische und
physische Insets, Scroll-Insets sowie `border-spacing`. Ein direkter numerischer Token ist dort nur
zulässig, wenn er in `testing/spacingExceptions.ts` exakt mit Owner, Property, Wert, Tokenfolge,
Beziehungsname und belastbarer Begründung registriert ist. Anonyme Mengen- oder Maximalbudgets gibt
es nicht.

Die wenigen verbleibenden 18-/20-/28-px-Geometrien sind so deklarationsgenau eingefroren. Eine
Änderung an Wert oder Vorkommen schlägt fehl. Nach browsergeprüfter Normalisierung wird der Eintrag
gelöscht; neue Einträge dürfen den Ratchet nicht als bequemen Ersatz für eine semantische Rolle
verwenden. Größen-, Border- oder Transform-Geometrie außerhalb von Layoutabständen bleibt weiterhin
bei ihrem jeweils zuständigen Größenvertrag.

## Öffentlicher Katalog

Der öffentliche Barrel umfasst 34 vollständig colocated APIs. Ihre Architektur ist stabil; ihre
visuellen Zustände werden zusätzlich durch die maschinenlesbare Auditmatrix unter
`testing/gallery/auditProfiles.ts` geratet.

### Primitives

| API                | Zweck                                                     |
| ------------------ | --------------------------------------------------------- |
| `Button`           | Beschriftete Aktionen mit Tone, Size, Loading und Pressed |
| `Checkbox`         | Native Checkbox mit Messages und sicherem Touchziel       |
| `Field`            | Label-, Description-, Hint- und Error-Vertrag             |
| `IconButton`       | Icon-only-Aktion mit verpflichtendem Accessible Name      |
| `SegmentedControl` | Zugängliche exklusive Auswahl kompakter Optionen          |
| `Select`           | Zugängliches natives Auswahlfeld                          |
| `TextArea`         | Zugänglicher nativer mehrzeiliger Textbereich             |
| `TextField`        | Zugängliches natives einzeiliges Eingabefeld              |

### Components

| API                | Zweck                                                 |
| ------------------ | ----------------------------------------------------- |
| `AdaptivePanel`    | Responsiver Panel-Container für verfügbare Flächen    |
| `Alert`            | Semantische Status- und Fehlermeldung                 |
| `Chip`             | Kompaktes Label beziehungsweise filterbarer Zustand   |
| `Dialog`           | Modaler Dialog mit Fokus- und Größenvertrag           |
| `Disclosure`       | Ein- und ausklappbarer Inhaltsbereich                 |
| `EmptyState`       | Konsistenter leerer Zustand mit optionaler Aktion     |
| `ListboxSelect`    | Tastaturbedienbare Listbox-Auswahl                    |
| `Menu`             | Menü, Eintrag, Separator, Unter- und Kontextmenü      |
| `PageState`        | Seitenfüllender Loading-, Error- oder Empty-State     |
| `Popover`          | Nicht modales, positioniertes Overlay                 |
| `ProgressBar`      | Semantischer bestimmter oder unbestimmter Fortschritt |
| `SaveStatus`       | Kompakter Speicher- und Synchronisationszustand       |
| `ScrollArea`       | Semantikerhaltende, gestaltete Scrollfläche           |
| `Sheet`            | Modale Seitenfläche mit Fokusvertrag                  |
| `SidePanel`        | Binder-/Inspector-Fläche mit Default- und Fill-Breite |
| `Tabs`             | Zugängliche Tab-Navigation und Panels                 |
| `Toast`            | Flüchtige Statusmeldung und Toast-Region              |
| `ToolbarButton`    | Einheitliche Toolbar-Aktion mit responsivem Label     |
| `UndoRedoControls` | Gekoppelte Undo-/Redo-Aktionen                        |
| `WorkspaceToolbar` | Struktur und Gruppierung eines Workspace-Kontexts     |

### Patterns

| API              | Zweck                                                 |
| ---------------- | ----------------------------------------------------- |
| `CommandPalette` | Such- und Tastaturablauf für Kommandos                |
| `ConfirmDialog`  | Bestätigung, optional mit Hold-to-confirm             |
| `DropdownMenu`   | Trigger-, Open-/Close- und Fokuskomposition für Menüs |
| `SelectableRow`  | Auswahlzeile mit Metadaten und Nebenaktion            |
| `SelectionCard`  | Visuell stärkere auswählbare Karte                    |
| `SelectionMenu`  | Auswahlablauf innerhalb eines Menüs                   |

## Verbindlicher Folder-Vertrag

Jeder öffentliche Primitive-, Component- und Pattern-Ordner enthält exakt benannte Contract-Dateien:

```text
Component/
├── Component.tsx
├── Component.css
├── Component.test.tsx
├── Component.story.tsx
└── index.ts
```

Auch ein rein komponierender visueller Owner besitzt eine lokale CSS-Datei; sie darf dokumentiert
leer sein oder ausschließlich lokale Komposition enthalten. Der statische Public-API-Check prüft
diese fünf Dateien anhand des Ordnernamens.

Interaktive Komponenten benötigen sichere native Defaults, Accessible Name und Rolle,
Tastaturverträge sowie definiertes Fokusverhalten. Das Auditprofil ordnet relevante Stories
explizit Capabilities wie Disabled, Loading, Error, LongContent, Touch, Overlay und Scrolling zu.
Neue Folder oder Gallery-Stories ohne diese bewusste Zuordnung scheitern im Test.

## Feature-CSS

Produktnahe Styles bleiben neben ihrem fachlichen Owner. Erlaubt sind Layout,
Canvas-/Graph-Darstellungen und domänenspezifische Zustände. Nicht erlaubt sind neue allgemeine
Button-, Input-, Select-, Dialog-, Overlay- oder Fokusrezepte. Benötigt ein Feature eine fehlende
Variante, wird sie zuerst als typisierte Design-API modelliert.

Im produktiven TSX gelten absolute Nullverbote für rohe `button`-, `input`-, `select`- und
`textarea`-Controls sowie für retired Recipe-Klassen. Produkt-CSS darf weder native Control-Typen
selektieren noch colocated Design-Owner-Klassen überschreiben. Ein explizites Manifest schützt die
Owner aller 34 Folder inklusive BEM-Elementen, Modifiern und Portal-/Listen-Unterowner. Diese Regeln
besitzen keine produktive Ausnahme- oder Übergangsschicht.

## Menü- und Auswahlvertrag

Produktcode baut Aktionsmenüs nie direkt aus `Menu`, `Popover` und eigenem Open State zusammen.
Er verwendet `DropdownMenu`; dessen Trigger-Props besitzen `aria-haspopup`, `aria-expanded`,
`aria-controls`, ArrowUp-/ArrowDown-Öffnung, Escape und Fokus-Restore. `MenuItem` erhält sichtbare
Inhalte über `label` und `icon`; Löschen und andere irreversible Aktionen tragen `tone="danger"`.
Nicht interaktive Statusinhalte stehen über `DropdownMenu.header` außerhalb von `role="menu"`.

`MenuSubmenu` ist der einzige verschachtelte Menüvertrag. ArrowRight, Enter und Leertaste öffnen,
ArrowLeft kehrt zum Elternmenü zurück; das Untermenü wird an allen Viewportkanten begrenzt. Kurze
mobile Popover-/Menüinhalte werden als inhaltshohe Bottom-Sheets dargestellt. Lange Inhalte wachsen
bis höchstens 88 dVH und scrollen im expliziten Design-Owner.

Auswahl-APIs bleiben semantisch getrennt:

- `Select`: natives, beschriftetes Formularfeld für dichte Einstellungen;
- `ListboxSelect`: adaptive, gestaltete Auswahl in Toolbars und Overlays;
- `SelectionMenu`: Aktionen auf einer Textauswahl;
- `CommandPalette`: durchsuchbare Befehlsauswahl;
- `DropdownMenu`: Aktionsliste; `MenuSubmenu`: verschachtelte Aktionsliste.

`check_menu_contracts.mjs` blockiert direkte produktive `<Menu>`-Nutzung, handgeschriebene
Menütrigger, unstrukturierte Einträge, destruktive Icons ohne Danger-Ton und zurückgezogene lokale
Dropdown-Rezepte.

## Produktzustands-Tiefe

Ein grüner Komponenten- oder Workspace-Grundzustand deckt keine Oberfläche ab, die erst hinter
Tabs, Disclosures, Untermenüs oder einem zweiten Modal sichtbar wird. Jeder produktive Zustand ab
der zweiten Interaktionstiefe benötigt deshalb mindestens einen Browservertrag, der den echten Pfad
dorthin ausführt. Eine reine Existenzprüfung in JSDOM zählt nicht als Layoutabdeckung.

Der Browservertrag prüft am kleinsten unterstützten Viewport mindestens: vollständige Begrenzung im
Viewport, keinen horizontalen inneren oder Dokument-Overflow, bei absichtlich langen Inhalten genau
einen vertikalen Scroll-Owner, symmetrische Insets, Touchziele, geometrische Zentrierung kompakter
Inhalte sowie eine tatsächlich erfolgreiche Kernaktion. Bei persistenten Editorzuständen umfasst die
Kernaktion Speichern und Reload. Verschachtelte Modals prüfen zusätzlich, dass nur die oberste Ebene
interaktiv und für Assistenztechnologien sichtbar ist, Escape nur diese Ebene schließt und den Fokus an
ihren Auslöser zurückgibt.

## Umsetzungsstatus

Die Architektur- und Produktmigration vom 25. August 2026 ist abgeschlossen: Alle Aufrufer
verwenden den öffentlichen Design-Barrel, `shared/ui` und die Legacy-Styles sind entfernt, und die
statischen Debt-Inventare stehen auf null. Dieser historische Nachweis ist ausdrücklich kein
vollständiger visueller Abschlussnachweis.

Seit dem 26. August läuft deshalb das strengere
[`Design-Component-Audit v2`](../../../../ai/design-component-audit-2026-08.md). Es prüft zusätzlich
semantische Farbrollen, Spacing-Rhythmus, innere und Portal-Overflows, Narrow-Container,
Hit-Targets sowie Produktkompositionen. Sein Definition-of-Done ersetzt für visuelle Konsistenz die
frühere Aussage „alle Gallery-Tests sind grün“.

Historischer Architektur-Nachweis vom 25. August 2026:

- 34 öffentliche Ordner mit jeweils fünf Contract-Dateien, also 170 colocated Vertragsdateien;
- 132 Vitest-Dateien mit 547 bestandenen Tests;
- 24 von 24 bestandene Gallery-Browserverträge über Desktop, Intermediate, Compact und Touch,
  jeweils in Light und Dark inklusive Axe und Overflow;
- 85 bestandene Produkt-E2Es bei 50 bewusst projektabhängig übersprungenen Kombinationen sowie
  danach 6 von 6 gezielte Produkt-Axe-Prüfungen auf dem finalen Farbstand;
- 23 bestandene Architektur- und 40 bestandene Design-System-Gates;
- null rohe Produkt-Controls, Legacy-Klassen, native Control-Selektoren,
  Design-Owner-Overrides, Design-Deep-Imports oder `shared/ui`-Importe;
- erfolgreicher TypeScript- und Production-Build.

## Definition of Done

Eine öffentliche Komponente ist fertig, wenn:

- ihre fachneutrale API alle benötigten Varianten ohne Feature-Klassen ausdrückt;
- alle sichtbaren Texte und Accessible Labels per Props kommen;
- die fünf Contract-Dateien vollständig sind;
- Unit-Tests DOM-Semantik, Events, Disabled State, Tastatur und Fokus abdecken;
- ihr Auditprofil alle relevanten Theme-, Viewport-, Portal-, Scroll- und Inhaltszustände benennt;
- jeder produktive Zustand ab der zweiten Interaktionstiefe durch einen geometrischen Browservertrag
  mit erfolgreicher Kernaktion abgedeckt ist;
- sie über `design/index.ts` exportiert und ausschließlich darüber konsumiert wird;
- Gallery-, Axe-, Canvas-/Portal-/Inner-Overflow-, Touch-, Narrow-Host- und relevante berechnete
  visuelle Verträge grün sind;
- ihr erster Produkteinsatz keine lokale Sonderlösung und keinen Debt-Eintrag benötigt.

## Enforcement

`npm run check:design-system` prüft unter anderem:

- keine Design-Deep-Imports und keinerlei Importe aus dem entfernten `shared/ui`;
- vollständige, exakt benannte öffentliche Component-Folder;
- keine losen CSS-Dateien unter `design/components`;
- absolute Nullbestände für rohe Controls, retired Recipe-Klassen, native Control-Selektoren und
  direkte CSS-Design-Owner-Overrides;
- keine lokale Menükomposition, manuelle Menütrigger oder unstrukturierte/destruktiv falsch
  getönte Menüeinträge im Produktcode;
- genau ein öffentlicher Scrollbar-Owner: lokale `scrollbar-color`-, `scrollbar-width`- oder
  `::-webkit-scrollbar`-Rezepte sind ohne Ausnahme verboten;
- vollständiges CSS-Owner-Manifest für jeden öffentlichen Design-Folder;
- exakt fünf chromatische Familien, Theme-Parität und verbindliche semantische Rollenzuordnung;
- vier semantische Spacing-Rhythmen und ausschließlich deklarationsgenaue, begründete
  Zwischenwert-Ausnahmen statt anonymer Budgets;
- Biome über den gesamten Ordner `packages/client/src/design`.

Die lokalen Einstiegspunkte sind:

```text
npm run check:design-system
npm run test:design
npm run design:gallery
```

Debt-Baselines dürfen keine neue Ausnahme vom Nullvertrag einführen. Screenshot-Baselines werden
erst nach stabilen Tests und bewusster visueller Prüfung aktualisiert. Ein grüner Screenshot allein
definiert kein gutes Design; die akzeptierte API und ihr zugänglicher Verhaltensvertrag tun es.
