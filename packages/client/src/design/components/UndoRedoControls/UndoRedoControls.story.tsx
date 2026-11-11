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

/** The way every workspace uses it from T-258 on: plain names, area in the legend, shortcut in the tooltip. */
export function WithShortcuts() {
  return (
    <UndoRedoControls
      label="Verlauf: Figuren"
      undoLabel="Rückgängig"
      redoLabel="Wiederholen"
      undoShortcut={{ label: "Strg+Z", keys: "Control+Z" }}
      redoShortcut={{ label: "Strg+Umschalt+Z", keys: "Control+Shift+Z" }}
      onUndo={() => undefined}
      onRedo={() => undefined}
      canUndo
      canRedo={false}
    />
  );
}
