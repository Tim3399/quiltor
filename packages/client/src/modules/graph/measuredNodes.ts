import type { Node, NodeChange } from "@xyflow/react";

export type MeasuredSizes = ReadonlyMap<string, { width: number; height: number }>;

export const NO_MEASURED_SIZES: MeasuredSizes = new Map();

/**
 * The sizes React Flow reported, kept by node id.
 *
 * A canvas that derives some of its nodes rather than holding them cannot keep those sizes
 * any other way. `applyNodeChanges` writes a measurement onto the node it belongs to, and a
 * node the flow does not hold in its own list is simply not there to write on -- the same
 * reason a laid-out map needs its position caught here rather than applied.
 *
 * Returns the map it was given when nothing changed, so this can sit in state without
 * turning every measurement into another render.
 */
export function rememberMeasured(known: MeasuredSizes, changes: NodeChange[]): MeasuredSizes {
  let next: Map<string, { width: number; height: number }> | undefined;
  for (const change of changes) {
    if (change.type !== "dimensions" || !change.dimensions) continue;
    const { width, height } = change.dimensions;
    if (!width || !height) continue;
    const current = known.get(change.id);
    if (current && current.width === width && current.height === height) continue;
    next ??= new Map(known);
    next.set(change.id, { width, height });
  }
  return next ?? known;
}

/**
 * Give a node the size React Flow measured for it.
 *
 * Only a node that carries one appears in the overview map: `nodeHasDimensions` in
 * @xyflow/system checks exactly that. A map states its size itself and was drawn; the places
 * standing on it are derived from the map and stated nothing, so the overview map showed the
 * sheet and left off everything on it.
 *
 * A node that already knows its size keeps it -- what is written here is a memory of a
 * measurement, not a claim that overrides one.
 */
export function withMeasured<NodeType extends Node>(
  nodes: NodeType[],
  known: MeasuredSizes,
): NodeType[] {
  if (!known.size) return nodes;
  return nodes.map((node) => {
    if (node.measured || (node.width && node.height)) return node;
    const measured = known.get(node.id);
    return measured ? { ...node, measured } : node;
  });
}
