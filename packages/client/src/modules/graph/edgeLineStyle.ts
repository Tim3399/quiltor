export {
  GRAPH_EDGE_LINE_STYLES,
  type GraphEdgeLineStyle,
  type GraphRelationshipKind,
} from "../../shared";

import {
  GRAPH_EDGE_LINE_STYLES,
  type GraphEdgeLineStyle,
  type GraphRelationshipKind,
} from "../../shared";

type GraphEdgeStyleSource = {
  lineStyle?: unknown;
  relationshipKind?: unknown;
  /** @deprecated Legacy mixed presentation/meaning field. */
  style?: unknown;
};

/** Reads modern edge patterns and keeps persisted pre-split values compatible. */
export function graphEdgeLineStyle(source: GraphEdgeStyleSource): GraphEdgeLineStyle {
  if (GRAPH_EDGE_LINE_STYLES.includes(source.lineStyle as GraphEdgeLineStyle)) {
    return source.lineStyle as GraphEdgeLineStyle;
  }
  return source.style === "dashed" ? "dashed" : "solid";
}

/** `blood` used to be a visual style; it now migrates to semantic kinship. */
export function graphRelationshipKind(source: GraphEdgeStyleSource): GraphRelationshipKind {
  if (source.relationshipKind === "kinship") return "kinship";
  if (source.relationshipKind === "general") return "general";
  return source.style === "blood" ? "kinship" : "general";
}
