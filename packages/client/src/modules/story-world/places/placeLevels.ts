/**
 * Places nest: every place is also a level, and opening one shows what is inside.
 *
 * Nothing here knows about pictures. A level with no backdrop is the grid the
 * places workspace has always shown, which is what lets the whole feature work
 * for someone who never uploads a file.
 *
 * Containment is a parent pointer rather than the storyboard's target link, so
 * a level cannot end up inside itself. The storyboard permits exactly that
 * today; `wouldCycle` below is what keeps it out of here.
 */

import type { FigureNode, MapScale } from "../model";

/** Where a place sits and how large it is on its parent level. */
export interface LevelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A level's default extent when a place is first expanded, in flow units. */
export const DEFAULT_EXPANDED_SIZE = { width: 640, height: 420 } as const;

/** Somewhere to put a card that carries no anchor yet. */
const DEFAULT_ANCHOR = { u: 0.5, v: 0.5 } as const;

export function isPlace(node: FigureNode): boolean {
  return node.type === "ort";
}

/** The places drawn on `levelId`; `undefined` is the world's root level. */
export function placesOnLevel(nodes: readonly FigureNode[], levelId?: string): FigureNode[] {
  return nodes.filter((node) => isPlace(node) && (node.parentPlaceId ?? undefined) === levelId);
}

/**
 * Whether opening `placeId` would show anything at all.
 *
 * A card only offers to be entered when there is something behind it; an empty
 * place offers to have something put there instead. The distinction is entirely
 * in what the card shows -- both actions land on the same level -- but it keeps
 * a surface full of pins from sprouting a door on every one of them, and it
 * lets the author see at a glance which places carry something inside.
 */
export function hasLevelContents(nodes: readonly FigureNode[], placeId: string): boolean {
  const here = nodes.find((node) => node.id === placeId);
  if (here?.mapImageId) return true;
  return nodes.some((node) => isPlace(node) && node.parentPlaceId === placeId);
}

/** Every ancestor of `placeId`, nearest first. Stops on a broken chain. */
export function ancestorsOf(nodes: readonly FigureNode[], placeId: string): FigureNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const trail: FigureNode[] = [];
  const seen = new Set<string>([placeId]);
  let parentId = byId.get(placeId)?.parentPlaceId;
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    trail.push(parent);
    seen.add(parentId);
    parentId = parent.parentPlaceId;
  }
  return trail;
}

/**
 * The path from the root down to `placeId`, the way a breadcrumb reads it.
 *
 * Derived from the parent pointers rather than remembered as the user descends,
 * so arriving from a search result or a backlink shows the real position in the
 * world instead of a trail that starts wherever the jump landed.
 */
export function levelTrail(nodes: readonly FigureNode[], placeId?: string): FigureNode[] {
  if (!placeId) return [];
  const here = nodes.find((node) => node.id === placeId);
  if (!here) return [];
  return [...ancestorsOf(nodes, placeId).reverse(), here];
}

/**
 * Whether making `parentId` the parent of `placeId` would close a loop.
 *
 * A place may not become its own ancestor, or the trail would never reach a
 * root and descending would run forever.
 */
export function wouldCycle(
  nodes: readonly FigureNode[],
  placeId: string,
  parentId?: string,
): boolean {
  if (!parentId) return false;
  if (parentId === placeId) return true;
  return ancestorsOf(nodes, parentId).some((ancestor) => ancestor.id === placeId);
}

/** `place` moved onto `parentId`, or unchanged when that would close a loop. */
export function reparent(
  nodes: readonly FigureNode[],
  placeId: string,
  parentId: string | undefined,
  anchor?: { u: number; v: number },
): FigureNode[] {
  if (wouldCycle(nodes, placeId, parentId)) return nodes as FigureNode[];
  return nodes.map((node) =>
    node.id === placeId
      ? {
          ...node,
          parentPlaceId: parentId,
          ...(anchor ? { mapU: clampUnit(anchor.u), mapV: clampUnit(anchor.v) } : {}),
        }
      : node,
  );
}

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** The rectangle an expanded place occupies on its parent level. */
export function expandedRect(place: FigureNode, host: LevelRect): LevelRect {
  const width = positive(place.mapWidth) ?? DEFAULT_EXPANDED_SIZE.width;
  const height = positive(place.mapHeight) ?? DEFAULT_EXPANDED_SIZE.height;
  const anchor = anchorOf(place);
  return {
    x: host.x + anchor.u * host.width - width / 2,
    y: host.y + anchor.v * host.height - height / 2,
    width,
    height,
  };
}

/** Where a place sits inside `host`, in flow units. */
export function anchoredPoint(place: FigureNode, host: LevelRect): { x: number; y: number } {
  const anchor = anchorOf(place);
  return { x: host.x + anchor.u * host.width, y: host.y + anchor.v * host.height };
}

/** The normalised anchor a point inside `host` corresponds to. */
export function anchorForPoint(
  point: { x: number; y: number },
  host: LevelRect,
): {
  u: number;
  v: number;
} {
  if (host.width <= 0 || host.height <= 0) return { ...DEFAULT_ANCHOR };
  return {
    u: clampUnit((point.x - host.x) / host.width),
    v: clampUnit((point.y - host.y) / host.height),
  };
}

export function anchorOf(place: FigureNode): { u: number; v: number } {
  const u = typeof place.mapU === "number" ? place.mapU : undefined;
  const v = typeof place.mapV === "number" ? place.mapV : undefined;
  if (u === undefined || v === undefined) return { ...DEFAULT_ANCHOR };
  return { u: clampUnit(u), v: clampUnit(v) };
}

/**
 * The scale a distance between two places is read with.
 *
 * Both inside the same expanded place means that place's own scale governs;
 * anything else is measured with the scale of the level being looked at. A
 * measurement never spans a descent, so there is no third case.
 */
export function scaleForPair(
  nodes: readonly FigureNode[],
  first: FigureNode,
  second: FigureNode,
  levelScale?: MapScale,
): MapScale | undefined {
  const host = first.parentPlaceId;
  if (host && host === second.parentPlaceId) {
    const owner = nodes.find((node) => node.id === host);
    if (owner?.mapExpanded && owner.mapScale) return owner.mapScale;
  }
  return levelScale;
}

/** The scale that governs the level `placeId`, or the world's when at the root. */
export function scaleForLevel(
  nodes: readonly FigureNode[],
  placeId: string | undefined,
  worldScale?: MapScale,
): MapScale | undefined {
  if (!placeId) return worldScale;
  return nodes.find((node) => node.id === placeId)?.mapScale ?? worldScale;
}

/**
 * `placeId` and everything beneath it, so deleting a level can take its contents
 * with it instead of stranding them on a parent that no longer exists.
 */
export function subtreeOf(nodes: readonly FigureNode[], placeId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    const parent = node.parentPlaceId;
    if (!parent) continue;
    children.set(parent, [...(children.get(parent) ?? []), node.id]);
  }
  const collected = new Set<string>([placeId]);
  const pending = [placeId];
  while (pending.length) {
    const current = pending.pop() as string;
    for (const child of children.get(current) ?? []) {
      if (collected.has(child)) continue;
      collected.add(child);
      pending.push(child);
    }
  }
  return collected;
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
