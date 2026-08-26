import { Download, Plus, Redo2, Undo2 } from "lucide-react";
import { ToolbarButton } from "../ToolbarButton";
import {
  WorkspaceToolbar,
  WorkspaceToolbarActions,
  WorkspaceToolbarGroup,
  WorkspaceToolbarTitle,
} from "./WorkspaceToolbar";

export function Default() {
  return (
    <WorkspaceToolbar label="Kapitelwerkzeuge">
      <WorkspaceToolbarTitle title="Die Ankunft" detail="1.240 Wörter" />
      <WorkspaceToolbarActions>
        <WorkspaceToolbarGroup label="Erstellen">
          <ToolbarButton label="Neues Kapitel" icon={<Plus />} appearance="primary" />
        </WorkspaceToolbarGroup>
        <WorkspaceToolbarGroup label="Verlauf">
          <ToolbarButton label="Rückgängig" icon={<Undo2 />} />
          <ToolbarButton label="Wiederholen" icon={<Redo2 />} disabled />
        </WorkspaceToolbarGroup>
        <WorkspaceToolbarGroup label="Ausgabe">
          <ToolbarButton label="Exportieren" icon={<Download />} />
        </WorkspaceToolbarGroup>
      </WorkspaceToolbarActions>
    </WorkspaceToolbar>
  );
}

export function LongContent() {
  return (
    <WorkspaceToolbar label="Werkzeuge">
      <WorkspaceToolbarTitle
        title="Ein Kapitel mit einem ungewöhnlich langen und erklärenden Arbeitstitel"
        detail="Eine ebenfalls sehr lange Statusbeschreibung"
      />
      <WorkspaceToolbarGroup>
        <ToolbarButton label="Neues Kapitel" icon={<Plus />} />
      </WorkspaceToolbarGroup>
    </WorkspaceToolbar>
  );
}
