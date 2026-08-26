import { FilePlus2, SearchX } from "lucide-react";
import { Button } from "../../primitives/Button";
import { EmptyState } from "./EmptyState";

export function Default() {
  return (
    <EmptyState
      icon={<FilePlus2 />}
      title="Noch keine Kapitel"
      actions={<Button appearance="primary">Kapitel anlegen</Button>}
    >
      Beginne mit dem ersten Kapitel deiner Geschichte.
    </EmptyState>
  );
}

export function CompactLongContent() {
  return (
    <EmptyState icon={<SearchX />} title="Keine passenden Ergebnisse" size="compact">
      Versuche einen allgemeineren Suchbegriff oder entferne einige der aktiven Filter.
    </EmptyState>
  );
}
