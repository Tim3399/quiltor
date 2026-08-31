export const GRAPH_EDGE_LINE_STYLES = ["solid", "dashed", "dotted"] as const;

/** A purely visual edge pattern. It never encodes relationship meaning. */
export type GraphEdgeLineStyle = (typeof GRAPH_EDGE_LINE_STYLES)[number];

export const GRAPH_RELATIONSHIP_KINDS = ["general", "kinship"] as const;

/** Semantic meaning kept independently from color, direction and line style. */
export type GraphRelationshipKind = (typeof GRAPH_RELATIONSHIP_KINDS)[number];
