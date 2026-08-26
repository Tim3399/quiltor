import { UndoRedoControls } from "./UndoRedoControls";

export function Available() {
  return (
    <UndoRedoControls
      label="Verlauf"
      undoLabel="Rückgängig"
      redoLabel="Wiederholen"
      onUndo={() => undefined}
      onRedo={() => undefined}
      canUndo
      canRedo
    />
  );
}

export function Disabled() {
  return (
    <UndoRedoControls
      label="Verlauf"
      undoLabel="Rückgängig"
      redoLabel="Wiederholen"
      onUndo={() => undefined}
      onRedo={() => undefined}
      canUndo={false}
      canRedo={false}
      labelMode="always"
    />
  );
}
