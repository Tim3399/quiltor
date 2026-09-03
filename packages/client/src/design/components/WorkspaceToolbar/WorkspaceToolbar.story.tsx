import { Download, Redo2, Undo2 } from "lucide-react";
import { ToolbarButton } from "../ToolbarButton";
import {
  WorkspaceToolbar,
  WorkspaceToolbarActions,
  WorkspaceToolbarCreateButton,
  WorkspaceToolbarGroup,
  WorkspaceToolbarTitle,
} from "./WorkspaceToolbar";

export function Default() {
  return (
    <WorkspaceToolbar label="Kapitelwerkzeuge">
      <WorkspaceToolbarTitle title="Die Ankunft" detail="1.240 Wörter" />
      <WorkspaceToolbarActions
        create={
          <WorkspaceToolbarGroup label="Erstellen">
            <WorkspaceToolbarCreateButton label="Neues Kapitel" />
          </WorkspaceToolbarGroup>
        }
        history={
          <WorkspaceToolbarGroup label="Verlauf">
            <ToolbarButton label="Rückgängig" icon={<Undo2 />} />
            <ToolbarButton label="Wiederholen" icon={<Redo2 />} disabled />
          </WorkspaceToolbarGroup>
        }
        actions={
          <WorkspaceToolbarGroup label="Ausgabe">
            <ToolbarButton label="Exportieren" icon={<Download />} />
          </WorkspaceToolbarGroup>
        }
      />
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
        <WorkspaceToolbarCreateButton label="Neues Kapitel" />
      </WorkspaceToolbarGroup>
    </WorkspaceToolbar>
  );
}
