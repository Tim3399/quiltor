import { ArrowLeftRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Checkbox, ScrollArea, TextField } from "../../design";
import type { GraphEdgeColor } from "./edgeColor";
import type { GraphEdgeLineStyle } from "./edgeLineStyle";
import { GraphEdgeColorSelect } from "./GraphEdgeColorSelect";
import { GraphEdgeLineStyleSelect } from "./GraphEdgeLineStyleSelect";
import "./GraphEdgeInspector.css";

export type GraphEdgeInspectorLabels = {
  title: string;
  label: string;
  labelPlaceholder: string;
  directed: string;
  reverse: string;
  conflict: string;
  lineStyle: string;
  lineStyleOptions: Record<GraphEdgeLineStyle, string>;
  color: string;
  colorOptions: Record<GraphEdgeColor, string>;
};

export type GraphEdgeInspectorProps = {
  sourceLabel: string;
  targetLabel: string;
  value: string;
  directed: boolean;
  lineStyle: GraphEdgeLineStyle;
  color: GraphEdgeColor;
  semanticControls?: ReactNode;
  labels: GraphEdgeInspectorLabels;
  labelPlaceholder?: string;
  disabled?: boolean;
  toggleConflict?: boolean;
  reverseConflict?: boolean;
  onLabelChange: (label: string) => void;
  onDirectedChange: (directed: boolean) => void;
  onLineStyleChange: (lineStyle: GraphEdgeLineStyle) => void;
  onColorChange: (color: GraphEdgeColor) => void;
  onReverse?: () => void;
};

/**
 * Domain-neutral editor for graph edge semantics.
 *
 * Storyboard and story-world domains keep ownership of persistence, temporal
 * resolution and duplicate detection. This component owns their shared
 * interaction language and presentation only.
 */
export function GraphEdgeInspector({
  sourceLabel,
  targetLabel,
  value,
  directed,
  lineStyle,
  color,
  semanticControls,
  labels,
  labelPlaceholder = labels.labelPlaceholder,
  disabled = false,
  toggleConflict = false,
  reverseConflict = false,
  onLabelChange,
  onDirectedChange,
  onLineStyleChange,
  onColorChange,
  onReverse,
}: GraphEdgeInspectorProps) {
  return (
    <ScrollArea
      as="section"
      className="graph-edge-inspector nodrag nopan nowheel"
      aria-label={labels.title}
    >
      <header className="graph-edge-inspector__heading">
        <strong>{labels.title}</strong>
        <span className="graph-edge-inspector__endpoints">
          {sourceLabel} {directed ? "→" : "↔"} {targetLabel}
        </span>
      </header>
      <TextField
        fieldClassName="graph-edge-inspector__label-field"
        className="graph-edge-inspector__label-control"
        label={labels.label}
        value={value}
        placeholder={labelPlaceholder}
        disabled={disabled}
        onChange={(event) => onLabelChange(event.target.value)}
      />
      <GraphEdgeLineStyleSelect
        label={labels.lineStyle}
        value={lineStyle}
        optionLabels={labels.lineStyleOptions}
        disabled={disabled}
        onChange={onLineStyleChange}
      />
      <GraphEdgeColorSelect
        label={labels.color}
        value={color}
        optionLabels={labels.colorOptions}
        disabled={disabled}
        onChange={onColorChange}
      />
      {semanticControls}
      <Checkbox
        containerClassName="graph-edge-inspector__directed"
        label={labels.directed}
        checked={directed}
        disabled={disabled || toggleConflict}
        hint={toggleConflict ? labels.conflict : undefined}
        onChange={(event) => onDirectedChange(event.target.checked)}
      />
      {directed && onReverse && (
        <div className="graph-edge-inspector__reverse">
          <Button
            appearance="ghost"
            size="compact"
            icon={<ArrowLeftRight />}
            disabled={disabled || reverseConflict}
            onClick={onReverse}
          >
            {labels.reverse}
          </Button>
          {reverseConflict && <small>{labels.conflict}</small>}
        </div>
      )}
    </ScrollArea>
  );
}
