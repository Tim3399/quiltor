/** Stable edge colors shared by graph domain models, wire contracts, and presentation. */
export const GRAPH_EDGE_COLORS = ["auto", "ink", "gold", "rose", "moss", "blue"] as const;

export type GraphEdgeColor = (typeof GRAPH_EDGE_COLORS)[number];
