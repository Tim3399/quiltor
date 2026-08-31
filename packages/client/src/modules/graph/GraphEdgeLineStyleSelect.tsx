import { ListboxSelect } from "../../design";
import { GRAPH_EDGE_LINE_STYLES, type GraphEdgeLineStyle } from "./edgeLineStyle";
import "./GraphEdgeAppearanceSelect.css";
import "./GraphEdgeLineStyleSelect.css";

export type GraphEdgeLineStyleSelectProps = {
  label: string;
  value: GraphEdgeLineStyle;
  optionLabels: Record<GraphEdgeLineStyle, string>;
  disabled?: boolean;
  onChange: (lineStyle: GraphEdgeLineStyle) => void;
};

function GraphEdgeLineStyleSwatch({ lineStyle }: { lineStyle: GraphEdgeLineStyle }) {
  return (
    <span
      className="graph-edge-line-style-swatch"
      data-edge-line-style={lineStyle}
      aria-hidden="true"
    />
  );
}

/** One shared, previewable line-style field for every editable graph edge. */
export function GraphEdgeLineStyleSelect({
  label,
  value,
  optionLabels,
  disabled = false,
  onChange,
}: GraphEdgeLineStyleSelectProps) {
  const options = GRAPH_EDGE_LINE_STYLES.map((lineStyle) => ({
    value: lineStyle,
    label: optionLabels[lineStyle],
    leading: <GraphEdgeLineStyleSwatch lineStyle={lineStyle} />,
  }));

  return (
    <div className="graph-edge-appearance-select graph-edge-line-style-select">
      <span className="graph-edge-appearance-select__label graph-edge-line-style-select__label">
        {label}
      </span>
      <ListboxSelect
        className="graph-edge-appearance-select__control graph-edge-line-style-select__control"
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
