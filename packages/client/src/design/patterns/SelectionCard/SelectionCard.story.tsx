import { BookOpen, ChevronRight, MoreHorizontal, Trash2 } from "lucide-react";
import { IconButton } from "../../primitives/IconButton";
import { SelectionCard } from "./SelectionCard";

export function Default() {
  return (
    <SelectionCard
      label="Die Stadt aus Papier öffnen"
      title="Die Stadt aus Papier"
      description="Zuletzt geändert am 23.08.2026"
      leading={<BookOpen />}
      indicator={<ChevronRight />}
      onSelect={() => undefined}
    />
  );
}

export function WithTrailingActions() {
  return (
    <SelectionCard
      label="Der letzte Garten öffnen"
      title="Der letzte Garten"
      description="Zuletzt geändert am 21.08.2026"
      leading={<BookOpen />}
      indicator={<ChevronRight />}
      onSelect={() => undefined}
      actionsLabel="Aktionen für Der letzte Garten"
      actions={
        <IconButton
          label="Der letzte Garten löschen"
          icon={<Trash2 />}
          tone="danger"
          size="regular"
        />
      }
    />
  );
}

export function Selected() {
  return (
    <SelectionCard
      selected
      label="Ausgewählte Welt öffnen"
      title="Ausgewählte Welt"
      description="Aktuelle Auswahl"
      leading={<BookOpen />}
      indicator={<ChevronRight />}
      onSelect={() => undefined}
    />
  );
}

export function Disabled() {
  return (
    <SelectionCard
      disabled
      label="Archivierte Welt öffnen"
      title="Archivierte Welt"
      description="Vorübergehend nicht verfügbar"
      leading={<BookOpen />}
      indicator={<ChevronRight />}
      onSelect={() => undefined}
    />
  );
}

export function LongContent() {
  return (
    <div style={{ width: 320, maxWidth: "100%" }}>
      <SelectionCard
        label="Eine Welt mit einem ungewöhnlich langen Titel öffnen"
        title="Eine Welt mit einem ungewöhnlich langen Titel, der nicht das Layout sprengt"
        description="Zuletzt geändert an einem sehr ausführlich beschriebenen Sommertag"
        leading={<BookOpen />}
        indicator={<MoreHorizontal />}
        onSelect={() => undefined}
      />
    </div>
  );
}
