import { Trash2 } from "lucide-react";
import { IconButton } from "../../primitives/IconButton";
import { SelectableRow } from "./SelectableRow";

export function Default() {
  return (
    <SelectableRow
      label="Die Ankunft öffnen"
      title="Die Ankunft"
      description="Erstes Kapitel"
      metadata="1.240 Wörter"
      onSelect={() => undefined}
    />
  );
}

export function SelectedWithAction() {
  return (
    <SelectableRow
      label="Der letzte Garten öffnen"
      title="Der letzte Garten"
      description="Kapitel mit einer eigenständigen Nebenaktion"
      metadata="Gestern"
      selected
      onSelect={() => undefined}
      actionsLabel="Kapitelaktionen"
      actions={<IconButton label="Der letzte Garten löschen" icon={<Trash2 />} tone="danger" />}
    />
  );
}

export function LongContent() {
  return (
    <SelectableRow
      label="Langes Kapitel öffnen"
      title="Ein Kapitel mit einem ungewöhnlich langen und erklärenden Arbeitstitel"
      description="Auch diese Beschreibung ist absichtlich länger als der verfügbare Platz."
      metadata="12.340 Wörter · vor einer ungewöhnlich langen Zeit"
      onSelect={() => undefined}
    />
  );
}
