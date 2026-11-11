import { Redo2, Undo2 } from "lucide-react";
import type { FieldsetHTMLAttributes } from "react";
import { ToolbarButton, type ToolbarButtonLabelMode } from "../ToolbarButton";
import "./UndoRedoControls.css";

/** A keyboard shortcut as people read it ("Strg+Z") and as aria-keyshortcuts names it ("Control+Z"). */
export interface UndoRedoShortcut {
  label: string;
  keys: string;
}

export interface UndoRedoControlsProps
  extends Omit<FieldsetHTMLAttributes<HTMLFieldSetElement>, "onChange"> {
  label: string;
  undoLabel: string;
  redoLabel: string;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  labelMode?: ToolbarButtonLabelMode;
  /** Shown in the tooltip after the label and announced through aria-keyshortcuts. */
  undoShortcut?: UndoRedoShortcut;
  redoShortcut?: UndoRedoShortcut;
}

function tooltip(label: string, shortcut?: UndoRedoShortcut) {
  return shortcut ? `${label} (${shortcut.label})` : label;
}

export function UndoRedoControls({
  label,
  undoLabel,
  redoLabel,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  labelMode = "hidden",
  undoShortcut,
  redoShortcut,
  className = "",
  ...props
}: UndoRedoControlsProps) {
  return (
    <fieldset {...props} className={`undo-redo-controls ${className}`.trim()}>
      <legend>{label}</legend>
      <ToolbarButton
        label={undoLabel}
        title={tooltip(undoLabel, undoShortcut)}
        aria-keyshortcuts={undoShortcut?.keys}
        labelMode={labelMode}
        icon={<Undo2 />}
        disabled={!canUndo}
        onClick={onUndo}
      />
      <ToolbarButton
        label={redoLabel}
        title={tooltip(redoLabel, redoShortcut)}
        aria-keyshortcuts={redoShortcut?.keys}
        labelMode={labelMode}
        icon={<Redo2 />}
        disabled={!canRedo}
        onClick={onRedo}
      />
    </fieldset>
  );
}
