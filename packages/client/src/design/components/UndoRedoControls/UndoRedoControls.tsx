import { Redo2, Undo2 } from "lucide-react";
import type { FieldsetHTMLAttributes } from "react";
import { ToolbarButton, type ToolbarButtonLabelMode } from "../ToolbarButton";
import "./UndoRedoControls.css";

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
  className = "",
  ...props
}: UndoRedoControlsProps) {
  return (
    <fieldset {...props} className={`undo-redo-controls ${className}`.trim()}>
      <legend>{label}</legend>
      <ToolbarButton
        label={undoLabel}
        labelMode={labelMode}
        icon={<Undo2 />}
        disabled={!canUndo}
        onClick={onUndo}
      />
      <ToolbarButton
        label={redoLabel}
        labelMode={labelMode}
        icon={<Redo2 />}
        disabled={!canRedo}
        onClick={onRedo}
      />
    </fieldset>
  );
}
