import { ListboxSelect } from "../../design";
import { GRAPH_EDGE_COLORS, type GraphEdgeColor } from "./edgeColor";
import "./GraphEdgeAppearanceSelect.css";
import "./GraphEdgeColorSelect.css";

export type GraphEdgeColorSelectProps = {
  label: string;
  value: GraphEdgeColor;
  optionLabels: Record<GraphEdgeColor, string>;
  disabled?: boolean;
  onChange: (color: GraphEdgeColor) => void;
};

function GraphEdgeColorSwatch({ color }: { color: GraphEdgeColor }) {
  return <span className="graph-edge-color-swatch" data-edge-color={color} aria-hidden="true" />;
}

/** Compact shared edge-color field for every graph relationship editor. */
export function GraphEdgeColorSelect({
  label,
  value,
  optionLabels,
  disabled = false,
  onChange,
}: GraphEdgeColorSelectProps) {
  const options = GRAPH_EDGE_COLORS.map((color) => ({
    value: color,
    label: optionLabels[color],
    leading: <GraphEdgeColorSwatch color={color} />,
  }));

  return (
    <div className="graph-edge-appearance-select graph-edge-color-select">
      <span className="graph-edge-appearance-select__label graph-edge-color-select__label">
        {label}
      </span>
      <ListboxSelect
        className="graph-edge-appearance-select__control graph-edge-color-select__control"
        label={label}
        value={value}
        options={options}
        size="compact"
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}
