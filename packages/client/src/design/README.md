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

## Akzentfarben als semantischer Vertrag

Akzentfarbe kommuniziert Bedeutung und darf nicht nur Dekoration sein. Jede Akzentfamilie besitzt
vier Rollen: `base` für graphische Fills und starke Marken, `soft` für getönte Flächen, `text` für
kleine Schrift und Icons sowie `border` für Zustandsränder und Linien.

| Familie | Bedeutung | Typische Verwendung |
| ------- | --------- | ------------------- |
| Gold | aktive Auswahl und aktueller Arbeitskontext | Selection, aktive Navigation, priorisierte Aktion |
| Rose | Beziehungen und Lebensereignisse | Beziehungsgraph, aktive Lebensereignis-Aktion |
| Moss | Erfolg, gespeicherter Zustand und Präsenz | SaveStatus, Success Alert, Präsenzmarke |
| Focus | Tastaturfokus, Drag-and-drop und Editierziel | Fokus-Ring, Drop-Fläche, Einfügelinie |

Für Text und Icons wird immer `*-text`, für bedeutungstragende Linien und Ränder `*-border` und
für getönte Hintergründe `*-soft` verwendet. `base` bleibt graphischen Fills vorbehalten. Goldene
Akzente ersetzen weder das orange Warning-System noch rote Error-/Danger-Rollen. Die
Kontrasttests sichern kleine Schrift mit mindestens 4,5:1 und nicht-textuelle Zustände mit
mindestens 3:1 in beiden Themes sowie auf interaktiven Materialflächen ab.

## Öffentlicher Katalog

Der öffentliche Barrel umfasst 34 vollständig colocated und nach dem Architektur- und
Accessibility-Review als `stable` eingestufte APIs.

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
| `Menu`             | Menü, Menüeintrag, Separator und Kontextmenü          |
| `PageState`        | Seitenfüllender Loading-, Error- oder Empty-State     |
| `Popover`          | Nicht modales, positioniertes Overlay                 |
| `ProgressBar`      | Semantischer bestimmter oder unbestimmter Fortschritt |
| `SaveStatus`       | Kompakter Speicher- und Synchronisationszustand       |
| `ScrollArea`       | Semantikerhaltende, gestaltete Scrollfläche            |
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
Tastaturverträge sowie definiertes Fokusverhalten. Relevante Stories decken mindestens Default,
Disabled, Light/Dark, Compact/Touch und lange Inhalte ab.

## Feature-CSS

Produktnahe Styles bleiben neben ihrem fachlichen Owner. Erlaubt sind Layout,
Canvas-/Graph-Darstellungen und domänenspezifische Zustände. Nicht erlaubt sind neue allgemeine
Button-, Input-, Select-, Dialog-, Overlay- oder Fokusrezepte. Benötigt ein Feature eine fehlende
Variante, wird sie zuerst als typisierte Design-API modelliert.

Im produktiven TSX gelten absolute Nullverbote für rohe `button`-, `input`-, `select`- und
`textarea`-Controls sowie für retired Recipe-Klassen. Produkt-CSS darf weder native Control-Typen
selektieren noch colocated Design-Owner-Klassen überschreiben. Diese Regeln besitzen keine
produktive Ausnahme- oder Übergangsschicht.

## Umsetzungsstatus

Die Produktmigration und ihre Abschlussverifikation sind vollständig abgeschlossen: Alle Aufrufer
verwenden den öffentlichen Design-Barrel, `shared/ui` und die Legacy-Styles sind entfernt, und die
statischen Debt-Inventare stehen auf null.

Abschlussnachweis vom 25. August 2026:

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
- Stories die relevanten Theme-, Viewport- und Inhaltszustände rendern;
- sie über `design/index.ts` exportiert und ausschließlich darüber konsumiert wird;
- Gallery-, Axe-, Overflow- und relevante visuelle Verträge grün sind;
- ihr erster Produkteinsatz keine lokale Sonderlösung und keinen Debt-Eintrag benötigt.

## Enforcement

`npm run check:design-system` prüft unter anderem:

- keine Design-Deep-Imports und keinerlei Importe aus dem entfernten `shared/ui`;
- vollständige, exakt benannte öffentliche Component-Folder;
- keine losen CSS-Dateien unter `design/components`;
- absolute Nullbestände für rohe Controls, retired Recipe-Klassen, native Control-Selektoren und
  direkte CSS-Design-Owner-Overrides;
- genau ein öffentlicher Scrollbar-Owner: lokale `scrollbar-color`- oder
  `::-webkit-scrollbar`-Rezepte sind ohne Ausnahme verboten;
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
