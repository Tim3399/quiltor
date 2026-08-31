export const GRAPH_CONNECTION_HANDLES = {
  incoming: "in",
  outgoing: "out",
  neutralTop: "neutral-top",
  neutralBottom: "neutral-bottom",
} as const;

export type GraphConnectionKind = "directed" | "undirected";

export type PositionedGraphNode = {
  id: string;
  x: number;
  y: number;
};

export type GraphConnectionDescriptor = {
  sourceId: string;
  targetId: string;
  directed: boolean;
};

export type GraphConnectionHandles = {
  source: (typeof GRAPH_CONNECTION_HANDLES)[keyof typeof GRAPH_CONNECTION_HANDLES];
  target: (typeof GRAPH_CONNECTION_HANDLES)[keyof typeof GRAPH_CONNECTION_HANDLES];
};

/**
 * Convert the shared visual handle language into domain-level direction.
 * Unknown or mixed handle pairs stay invalid instead of silently changing
 * the author's intended connection kind.
 */
export function graphConnectionKind(
  sourceHandle?: string | null,
  targetHandle?: string | null,
): GraphConnectionKind | null {
  if (
    sourceHandle === GRAPH_CONNECTION_HANDLES.outgoing &&
    targetHandle === GRAPH_CONNECTION_HANDLES.incoming
  ) {
    return "directed";
  }
  if (sourceHandle?.startsWith("neutral-") && targetHandle?.startsWith("neutral-")) {
    return "undirected";
  }
  return null;
}

/** Stable identity for duplicate detection while preserving edge direction. */
export function graphConnectionKey(sourceId: string, targetId: string, directed: boolean) {
  return directed
    ? `directed:${sourceId}:${targetId}`
    : `undirected:${[sourceId, targetId].sort().join(":")}`;
}

/**
 * Derive canvas handles from domain geometry. React Flow handle IDs therefore
 * remain presentation details rather than persisted domain data.
 */
export function graphConnectionHandles(
  edge: GraphConnectionDescriptor,
  nodes: readonly PositionedGraphNode[],
  verticalThreshold: number,
): GraphConnectionHandles {
  if (edge.directed) {
    return {
      source: GRAPH_CONNECTION_HANDLES.outgoing,
      target: GRAPH_CONNECTION_HANDLES.incoming,
    };
  }

  const source = nodes.find((node) => node.id === edge.sourceId);
  const target = nodes.find((node) => node.id === edge.targetId);
  if (!source || !target) {
    return {
      source: GRAPH_CONNECTION_HANDLES.neutralBottom,
      target: GRAPH_CONNECTION_HANDLES.neutralTop,
    };
  }

  const verticalDistance = target.y - source.y;
  if (Math.abs(verticalDistance) >= verticalThreshold) {
    return verticalDistance > 0
      ? {
          source: GRAPH_CONNECTION_HANDLES.neutralBottom,
          target: GRAPH_CONNECTION_HANDLES.neutralTop,
        }
      : {
          source: GRAPH_CONNECTION_HANDLES.neutralTop,
          target: GRAPH_CONNECTION_HANDLES.neutralBottom,
        };
  }

  const graphCenterY = nodes.reduce((sum, node) => sum + node.y, 0) / Math.max(nodes.length, 1);
  const pairCenterY = (source.y + target.y) / 2;
  const handle =
    pairCenterY <= graphCenterY
      ? GRAPH_CONNECTION_HANDLES.neutralTop
      : GRAPH_CONNECTION_HANDLES.neutralBottom;
  return { source: handle, target: handle };
}
