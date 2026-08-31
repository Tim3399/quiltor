import type { EdgeMarker } from "@xyflow/react";
import type { CSSProperties } from "react";
import type { GraphEdgeColor } from "./edgeColor";
import type { GraphEdgeLineStyle } from "./edgeLineStyle";
import "./edgePresentation.css";

/** @deprecated Use GraphEdgeLineStyle. */
export type GraphRelationshipEdgeVariant = GraphEdgeLineStyle;
export const GRAPH_RELATIONSHIP_EDGE_TYPE = "graphRelationship";

const GRAPH_EDGE_COLOR_TOKENS: Record<Exclude<GraphEdgeColor, "auto">, string> = {
  ink: "var(--graph-edge-color-ink)",
  gold: "var(--graph-edge-color-gold)",
  rose: "var(--graph-edge-color-rose)",
  moss: "var(--graph-edge-color-moss)",
  blue: "var(--graph-edge-color-blue)",
};

export type GraphRelationshipEdgePresentation = {
  type: typeof GRAPH_RELATIONSHIP_EDGE_TYPE;
  className: string;
  ariaLabel: string;
  labelBgStyle: CSSProperties;
  labelStyle: CSSProperties;
  labelShowBg: true;
  labelBgPadding: [number, number];
  labelBgBorderRadius: number;
  markerEnd: EdgeMarker | undefined;
};

/**
 * Single visual contract for editable graph relationships.
 *
 * Figures established this vocabulary. Other graph features consume the same
 * classes and label/marker colors so feature-local CSS cannot silently drift.
 */
export function graphRelationshipEdgePresentation({
  directed,
  variant = "solid",
  temporal = false,
  sourceLabel,
  targetLabel,
  label,
  color = "auto",
  annotations = [],
}: {
  directed: boolean;
  variant?: GraphRelationshipEdgeVariant;
  temporal?: boolean;
  sourceLabel: string;
  targetLabel: string;
  label?: string;
  color?: GraphEdgeColor;
  annotations?: readonly string[];
}): GraphRelationshipEdgePresentation {
  const edgeColor =
    color === "auto"
      ? directed
        ? "var(--graph-edge-directed-stroke)"
        : "var(--graph-edge-undirected-stroke)"
      : GRAPH_EDGE_COLOR_TOKENS[color];
  const relationshipLabel = label?.trim();
  const details = [relationshipLabel, ...annotations.map((item) => item.trim())].filter(Boolean);
  return {
    type: GRAPH_RELATIONSHIP_EDGE_TYPE,
    className: [
      "graph-relationship-edge",
      `edge-line-${variant}`,
      // Compatibility class for extensions that already target solid/dashed.
      `edge-${variant}`,
      directed ? "edge-directed" : "edge-undirected",
      `edge-color-${color}`,
      temporal ? "edge-temporal" : "",
    ]
      .filter(Boolean)
      .join(" "),
    ariaLabel: `${sourceLabel} ${directed ? "→" : "↔"} ${targetLabel}${details.length ? ` — ${details.join(" · ")}` : ""}`,
    labelBgStyle: {
      fill: "var(--graph-edge-label-bg)",
      stroke: edgeColor,
      strokeWidth: 0.8,
    },
    labelStyle: {
      fill: "var(--graph-edge-label-text)",
      fontFamily: "var(--ui)",
      fontSize: "var(--font-size-2)",
      fontWeight: temporal ? 600 : 500,
    },
    labelShowBg: true,
    labelBgPadding: [5, 2],
    labelBgBorderRadius: 4,
    markerEnd: directed ? { type: "arrowclosed", color: edgeColor } : undefined,
  };
}
