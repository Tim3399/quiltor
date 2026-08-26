import { BookOpen, Clock3, Search } from "lucide-react";
import { CommandPalette } from "./CommandPalette";

const items = [
  {
    id: "manuscript",
    label: "Manuskript öffnen",
    detail: "Zum aktuellen Kapitel wechseln",
    keywords: ["Text", "Kapitel"],
    icon: <BookOpen />,
    onSelect: () => undefined,
  },
  {
    id: "timeline",
    label: "Timeline öffnen",
    detail: "Momente und Ereignisse anzeigen",
    icon: <Clock3 />,
    onSelect: () => undefined,
  },
  {
    id: "unavailable",
    label: "Archiv durchsuchen",
    detail: "Zurzeit nicht verfügbar",
    icon: <Search />,
    disabled: true,
    onSelect: () => undefined,
  },
];

export function Default() {
  return (
    <CommandPalette
      open
      label="Befehle und Inhalte"
      closeLabel="Befehlspalette schließen"
      inputLabel="Befehl oder Inhalt suchen"
      placeholder="Suchen …"
      emptyLabel="Keine Ergebnisse"
      items={items}
      onClose={() => undefined}
    />
  );
}

export function QueryRequired() {
  return (
    <CommandPalette
      open
      label="Inhalte suchen"
      closeLabel="Suche schließen"
      placeholder="Mindestens einen Begriff eingeben …"
      emptyLabel="Suchbegriff eingeben"
      items={items.map((item) => ({ ...item, requiresQuery: true }))}
      onClose={() => undefined}
    />
  );
}
