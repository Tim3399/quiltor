# Quiltor Design-System

Dieser Ordner ist die verbindliche Quelle für Quiltors wiederverwendbare visuelle Sprache,
UI-Komponenten und deren Qualitätsvertrag.

## Öffentliche API

Produktcode importiert Komponenten ausschließlich über `packages/client/src/design/index.ts`.
Direkte Imports aus `primitives/`, `components/`, `patterns/` oder `internal/` sind außerhalb des
Design-Systems nicht erlaubt.

```tsx
import {
  Button,
  Checkbox,
  IconButton,
  SelectionCard,
  Select,
  TextArea,
  TextField,
  ToolbarButton,
} from "../../design";
```

`index.css` bleibt der öffentliche Einstieg für globale Foundations. Jede React-Komponente besitzt
ihren visuellen Owner colocated bei ihrer Implementierung; Feature-CSS darf diese Darstellung nicht
neu definieren.

## Schichten

```text
patterns -> components -> primitives -> foundations
```

- **Foundations**: Referenzwerte, semantische Tokens, Themes, Typografie, Motion und Reset.
- **Primitives**: dünne, zugängliche Bausteine über nativen Controls.
- **Components**: zusammengesetzte, fachneutrale UI wie Dialog, Toolbar oder SidePanel.
- **Patterns**: wiederkehrende UI-Abläufe wie ConfirmDialog oder CommandPalette.
- **Internal**: Implementierungsdetails, die niemals Teil der öffentlichen API sind.

Design-Code importiert weder Produktmodule noch Plattformadapter. Übersetzte und fachliche Texte
werden über Props übergeben.

## Komponentenstatus

- `experimental`: API und visuelle Sprache dürfen sich noch ändern; nicht als neuer Standard
  außerhalb der laufenden Migration verwenden.
- `stable`: vollständiger Unit-, Browser-, Accessibility- und visueller Vertrag; bevorzugte API für
  Produktcode.
- `deprecated`: nur noch für bestehende Aufrufer; besitzt eine dokumentierte Ersatzkomponente und
  wird über die Design-Debt-Baseline abgebaut.

Neue Komponenten beginnen als `experimental`. Der Status wird im öffentlichen Katalog dokumentiert.

## Aktueller Katalog

| Komponente      | Status       | Zweck                                                            |
| --------------- | ------------ | ---------------------------------------------------------------- |
| `Button`        | experimental | Beschriftete Aktionen, inklusive Tone, Size, Loading und Pressed |
| `IconButton`    | experimental | Icon-only-Aktionen mit verpflichtendem Accessible Name           |
| `Field`         | experimental | Label-, Description-, Hint- und Error-Vertrag für Form-Controls  |
| `TextField`     | experimental | Zugängliches natives einzeiliges Eingabefeld                     |
| `TextArea`      | experimental | Zugänglicher nativer mehrzeiliger Textbereich                    |
| `Select`        | experimental | Zugängliches natives Auswahlfeld                                 |
| `Checkbox`      | experimental | Native Checkbox mit Messages und Touchziel                       |
| `ToolbarButton` | experimental | Einheitliche Toolbar-Aktion mit responsivem Icon-Label-Vertrag   |
| `SelectionCard` | experimental | Dichte, zugängliche Auswahlzeile mit Metadaten und Nebenaktion   |

## Pflichtinhalt einer Komponente

```text
Component/
├── Component.tsx
├── Component.css             # wenn die Komponente eigene Darstellung besitzt
├── Component.test.tsx
├── Component.story.tsx
└── index.ts
```

Komponenten ohne eigenen visuellen Vertrag dürfen die CSS-Datei weglassen, wenn sie vollständig
von einem anderen Primitive gestaltet werden; `Select` verwendet beispielsweise bewusst `Field`.

Eine stabile Komponente deckt mindestens Default, Focus, Disabled, Light/Dark, Compact/Touch sowie
lange Inhalte ab. Interaktive Komponenten benötigen eine zugängliche Rolle, einen Accessible Name,
Tastaturtests und sichere native Defaults.

## Feature-CSS

Produktnahe Styles bleiben neben ihrem fachlichen Owner. Erlaubt sind insbesondere Layout,
Canvas-/Graph-Darstellungen und domänenspezifische Zustände. Nicht erlaubt sind neue allgemeine
Button-, Input-, Select-, Dialog- oder Fokusrezepte. Benötigt ein Feature eine fehlende Variante,
wird sie zuerst als typisierte Design-API modelliert.

Eng begrenzte technische Ausnahmen, beispielsweise ein Editor- oder Range-Control, müssen im
Design-Debt-Manifest mit Datei und Grund inventarisiert werden.

## Tests

- Colocated Vitest-Dateien prüfen API, DOM-Semantik, Events und Tastaturverhalten.
- Colocated Story-Dateien exportieren benannte, parameterlose React-Szenarien.
- Die Design-Galerie rendert Stories im echten Browser für Axe, berechnete Layoutverträge und
  visuelle Vergleiche.
- Die statischen Ratchet-Checks verhindern neue rohe Controls, Legacy-Klassen, native
  Control-Selektoren und direkte Design-Owner-Overrides, während die bestehende Schuld
  schrittweise sinkt.
- Der Public-API-Check verbietet Deep Imports und unvollständige öffentliche Komponentenordner.

Die lokalen Einstiegspunkte sind:

```text
npm run check:design-system
npm run test:design
npm run design:gallery
```

Baselines werden erst aktualisiert, nachdem die visuelle Änderung bewusst geprüft wurde. Ein grüner
Screenshot-Test allein definiert kein gutes Design; die akzeptierte Komponenten-API tut es.
