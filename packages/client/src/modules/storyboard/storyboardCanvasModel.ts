import type { Connection, Edge, Node } from "@xyflow/react";
import { uid } from "../../shared/id";
import {
  type CardKind,
  graphConnectionHandles,
  graphConnectionKey,
  graphConnectionKind,
  graphRelationshipEdgePresentation,
} from "../graph";
import {
  resolveWorldReferenceCandidate,
  type WorldReferenceCandidate,
  worldReferenceKey,
} from "../world-references";
import type {
  StoryboardBoardNode,
  StoryboardEdge,
  StoryboardGroupNode,
  StoryboardNode,
  StoryboardNoteNode,
  StoryboardReferenceNode,
} from "./model";

export const STORYBOARD_REFERENCE_DRAG_MIME = "application/x-quiltor-world-reference";
export const STORYBOARD_GRID_SIZE = 20;

export const STORYBOARD_NODE_SIZES = {
  note: { width: 280, height: 210 },
  reference: { width: 240, height: 210 },
  storyboard: { width: 240, height: 210 },
  group: { width: 520, height: 360 },
} as const;

export type StoryboardNodePatch = Partial<
  Pick<StoryboardNode, "x" | "y" | "width" | "height" | "zIndex" | "label">
>;

export type StoryboardLayerMoveDirection = "forward" | "backward";

export type StoryboardFlowNodeContext = {
  boardTitle?: string;
  boardContext?: string;
  onPatch: (id: string, patch: StoryboardNodePatch) => void;
  onNoteChange: (
    id: string,
    text: string,
    references: StoryboardNode["noteReferences"],
    marks: StoryboardNode["noteMarks"],
  ) => void;
  onOpenReference: (node: StoryboardReferenceNode) => void;
  onOpenBoard: (node: StoryboardBoardNode) => void;
};

export type StoryboardFlowNodeData = StoryboardFlowNodeContext & {
  [key: string]: unknown;
  item: StoryboardNode;
  cardKind: CardKind;
};

export type StoryboardFlowNode = Node<StoryboardFlowNodeData, "storyboard">;

export function uniqueStoryboardId(prefix: string, occupied: Iterable<string>) {
  const ids = new Set(occupied);
  let id = uid(prefix);
  while (ids.has(id)) id = uid(prefix);
  return id;
}

export function noteNode(
  boardId: string,
  position: { x: number; y: number },
  occupied: Iterable<string>,
): StoryboardNoteNode {
  const size = STORYBOARD_NODE_SIZES.note;
  return {
    id: uniqueStoryboardId("story-note-", occupied),
    boardId,
    kind: "note",
    ...position,
    ...size,
    text: "",
    noteReferences: [],
    noteMarks: [],
  };
}

export function groupNode(
  boardId: string,
  position: { x: number; y: number },
  occupied: Iterable<string>,
  label: string,
): StoryboardGroupNode {
  return {
    id: uniqueStoryboardId("story-group-", occupied),
    boardId,
    kind: "group",
    ...position,
    ...STORYBOARD_NODE_SIZES.group,
    label,
    zIndex: 0,
    text: "",
    noteReferences: [],
    noteMarks: [],
  };
}

export function candidateNode(
  boardId: string,
  position: { x: number; y: number },
  occupied: Iterable<string>,
  candidate: WorldReferenceCandidate,
): StoryboardReferenceNode | StoryboardBoardNode {
  const base = {
    id: uniqueStoryboardId("story-ref-", occupied),
    boardId,
    ...position,
    ...STORYBOARD_NODE_SIZES.reference,
    label: candidate.label,
    zIndex: 1,
    text: "",
    noteReferences: [],
    noteMarks: [],
  };
  if (candidate.target.kind === "storyboard") {
    return { ...base, kind: "storyboard", target: candidate.target };
  }
  return { ...base, kind: "reference", target: candidate.target };
}

function storyboardNodeSize(node: StoryboardNode) {
  const fallback = STORYBOARD_NODE_SIZES[node.kind];
  return {
    width: node.width ?? fallback.width,
    height: node.height ?? fallback.height,
  };
}

function storyboardNodeAccessibleLabel(node: StoryboardNode | undefined, fallbackId: string) {
  const text = node?.label?.trim() || node?.text?.trim();
  if (!text) return fallbackId;
  return text.replace(/\s+/g, " ").slice(0, 80);
}

export function storyboardFlowNode(
  item: StoryboardNode,
  data: StoryboardFlowNodeContext,
  cardKind: CardKind = storyboardCardKind(item),
): StoryboardFlowNode {
  const size = storyboardNodeSize(item);
  return {
    id: item.id,
    type: "storyboard",
    position: { x: item.x, y: item.y },
    zIndex: item.zIndex ?? (item.kind === "group" ? 0 : 1),
    style: {
      width: size.width,
      height: size.height,
    },
    data: { ...data, item, cardKind },
  };
}

/** Resolves persisted references against the live world index so type changes recolor immediately. */
export function storyboardCardKind(
  item: StoryboardNode,
  candidates: readonly WorldReferenceCandidate[] = [],
): CardKind {
  if (item.kind === "note" || item.kind === "storyboard" || item.kind === "group") {
    return item.kind;
  }
  const liveCandidate = resolveWorldReferenceCandidate(candidates, item.target);
  if (liveCandidate) return liveCandidate.cardKind;
  switch (item.target.kind) {
    case "place":
      return "ort";
    case "chapter":
      return "chapter";
    case "timeline":
      return "timeline";
    case "entity":
      return "reference";
  }
}

export function storyboardGroupMemberIds(
  group: StoryboardGroupNode,
  nodes: readonly StoryboardNode[],
): string[] {
  const groupRight = group.x + group.width;
  const groupBottom = group.y + group.height;

  return nodes.flatMap((node) => {
    if (node.id === group.id || node.boardId !== group.boardId) return [];
    const { width, height } = storyboardNodeSize(node);
    const fullyInside =
      node.x >= group.x &&
      node.y >= group.y &&
      node.x + width <= groupRight &&
      node.y + height <= groupBottom;
    return fullyInside ? [node.id] : [];
  });
}

export function moveStoryboardNodeWithGroupMembers(
  nodes: StoryboardNode[],
  nodeId: string,
  position: { x: number; y: number },
): StoryboardNode[] {
  const movedNode = nodes.find((node) => node.id === nodeId);
  if (!movedNode || (movedNode.x === position.x && movedNode.y === position.y)) return nodes;

  const delta = { x: position.x - movedNode.x, y: position.y - movedNode.y };
  const memberIds =
    movedNode.kind === "group"
      ? new Set(storyboardGroupMemberIds(movedNode, nodes))
      : new Set<string>();

  return nodes.map((node) => {
    if (node.id === nodeId) return { ...node, ...position };
    if (!memberIds.has(node.id)) return node;
    return { ...node, x: node.x + delta.x, y: node.y + delta.y };
  });
}

type IndexedStoryboardNode = {
  index: number;
  node: StoryboardNode;
};

function storyboardLayer(node: StoryboardNode) {
  return node.kind === "group" ? "group" : "card";
}

function storyboardLayerZIndex(node: StoryboardNode) {
  return node.zIndex ?? (node.kind === "group" ? 0 : 1);
}

export function canMoveStoryboardNodeInLayer(
  nodes: readonly StoryboardNode[],
  nodeId: string,
  direction: StoryboardLayerMoveDirection,
): boolean {
  const targetIndex = nodes.findIndex((node) => node.id === nodeId);
  if (targetIndex < 0) return false;
  const target = nodes[targetIndex];
  const targetLayer = storyboardLayer(target);
  const targetZIndex = storyboardLayerZIndex(target);

  for (let index = 0; index < nodes.length; index += 1) {
    if (index === targetIndex) continue;
    const candidate = nodes[index];
    if (candidate.boardId !== target.boardId || storyboardLayer(candidate) !== targetLayer) {
      continue;
    }
    const candidateZIndex = storyboardLayerZIndex(candidate);
    if (direction === "forward") {
      if (
        candidateZIndex > targetZIndex ||
        (candidateZIndex === targetZIndex && index > targetIndex)
      ) {
        return true;
      }
    } else if (
      candidateZIndex < targetZIndex ||
      (candidateZIndex === targetZIndex && index < targetIndex)
    ) {
      return true;
    }
  }
  return false;
}

function orderedStoryboardLayer(
  nodes: readonly StoryboardNode[],
  boardId: string,
  layer: ReturnType<typeof storyboardLayer>,
): IndexedStoryboardNode[] {
  return nodes
    .map((node, index) => ({ index, node }))
    .filter(({ node }) => node.boardId === boardId && storyboardLayer(node) === layer)
    .sort(
      (left, right) =>
        storyboardLayerZIndex(left.node) - storyboardLayerZIndex(right.node) ||
        left.index - right.index,
    );
}

/** Inserts a node at the front of its board-local layer and compacts that board's z-indices. */
export function insertStoryboardNodeAtLayerFront(
  existingNodes: StoryboardNode[],
  newNode: StoryboardNode,
): StoryboardNode[] {
  const groups = orderedStoryboardLayer(existingNodes, newNode.boardId, "group");
  const cards = orderedStoryboardLayer(existingNodes, newNode.boardId, "card");
  const indexedNewNode = { index: existingNodes.length, node: newNode };
  if (storyboardLayer(newNode) === "group") groups.push(indexedNewNode);
  else cards.push(indexedNewNode);

  const compactZIndex = new Map<string, number>();
  groups.forEach(({ node }, index) => {
    compactZIndex.set(node.id, index);
  });
  cards.forEach(({ node }, index) => {
    compactZIndex.set(node.id, groups.length + index);
  });

  const normalized = existingNodes.map((node) => {
    if (node.boardId !== newNode.boardId) return node;
    const zIndex = compactZIndex.get(node.id);
    if (zIndex === undefined || node.zIndex === zIndex) return node;
    return { ...node, zIndex };
  });
  const zIndex = compactZIndex.get(newNode.id);
  return [
    ...normalized,
    zIndex === undefined || newNode.zIndex === zIndex ? newNode : { ...newNode, zIndex },
  ];
}

/**
 * Moves a node by one step inside its board-local layer and compacts that board's z-indices.
 * Groups and cards have independent ordering; the compacted group range always stays behind cards.
 */
export function moveStoryboardNodeInLayer(
  nodes: StoryboardNode[],
  nodeId: string,
  direction: StoryboardLayerMoveDirection,
): StoryboardNode[] {
  if (!canMoveStoryboardNodeInLayer(nodes, nodeId, direction)) return nodes;
  const target = nodes.find((node) => node.id === nodeId);
  if (!target) return nodes;

  const targetLayer = storyboardLayer(target);
  const targetOrder = orderedStoryboardLayer(nodes, target.boardId, targetLayer);
  const targetIndex = targetOrder.findIndex(({ node }) => node.id === nodeId);
  const nextIndex = targetIndex + (direction === "forward" ? 1 : -1);
  if (targetIndex < 0 || nextIndex < 0 || nextIndex >= targetOrder.length) return nodes;

  const reorderedTargetLayer = [...targetOrder];
  [reorderedTargetLayer[targetIndex], reorderedTargetLayer[nextIndex]] = [
    reorderedTargetLayer[nextIndex],
    reorderedTargetLayer[targetIndex],
  ];

  const groups =
    targetLayer === "group"
      ? reorderedTargetLayer
      : orderedStoryboardLayer(nodes, target.boardId, "group");
  const cards =
    targetLayer === "card"
      ? reorderedTargetLayer
      : orderedStoryboardLayer(nodes, target.boardId, "card");
  const compactZIndex = new Map<string, number>();
  groups.forEach(({ node }, index) => {
    compactZIndex.set(node.id, index);
  });
  cards.forEach(({ node }, index) => {
    compactZIndex.set(node.id, groups.length + index);
  });

  return nodes.map((node) => {
    if (node.boardId !== target.boardId) return node;
    const zIndex = compactZIndex.get(node.id);
    if (zIndex === undefined || node.zIndex === zIndex) return node;
    return { ...node, zIndex };
  });
}

export function updateStoryboardNodeNote(
  nodes: StoryboardNode[],
  nodeId: string,
  text: string,
  noteReferences: StoryboardNode["noteReferences"],
  noteMarks: StoryboardNode["noteMarks"],
): StoryboardNode[] {
  const index = nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) return nodes;
  const next = [...nodes];
  next[index] = {
    ...nodes[index],
    text,
    noteReferences: noteReferences ?? [],
    noteMarks: noteMarks ?? [],
  };
  return next;
}

export function storyboardFlowEdge(edge: StoryboardEdge, nodes: readonly StoryboardNode[]): Edge {
  const directed = edge.directed === true;
  const presentation = graphRelationshipEdgePresentation({
    directed,
    variant: edge.lineStyle ?? "solid",
    sourceLabel: storyboardNodeAccessibleLabel(
      nodes.find((node) => node.id === edge.sourceNodeId),
      edge.sourceNodeId,
    ),
    targetLabel: storyboardNodeAccessibleLabel(
      nodes.find((node) => node.id === edge.targetNodeId),
      edge.targetNodeId,
    ),
    label: edge.label,
    color: edge.color,
  });
  const handles = graphConnectionHandles(
    {
      sourceId: edge.sourceNodeId,
      targetId: edge.targetNodeId,
      directed,
    },
    nodes,
    STORYBOARD_GRID_SIZE,
  );
  return {
    ...presentation,
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    sourceHandle: handles.source,
    targetHandle: handles.target,
    label: edge.label,
    data: { kind: "relationship" },
  };
}

export function connectedStoryboardEdge(
  boardId: string,
  connection: Connection,
  nodes: readonly StoryboardNode[],
  edges: readonly StoryboardEdge[],
): StoryboardEdge | null {
  const { source, target } = connection;
  if (!source || !target || source === target) return null;
  const kind = graphConnectionKind(connection.sourceHandle, connection.targetHandle);
  if (!kind) return null;
  const directed = kind === "directed";
  const boardNodeIds = new Set(
    nodes.filter((node) => node.boardId === boardId).map((node) => node.id),
  );
  if (!boardNodeIds.has(source) || !boardNodeIds.has(target)) return null;
  const candidateKey = graphConnectionKey(source, target, directed);
  if (
    edges.some(
      (edge) =>
        edge.boardId === boardId &&
        graphConnectionKey(edge.sourceNodeId, edge.targetNodeId, edge.directed === true) ===
          candidateKey,
    )
  ) {
    return null;
  }
  return {
    id: uniqueStoryboardId(
      "story-edge-",
      edges.map((edge) => edge.id),
    ),
    boardId,
    sourceNodeId: source,
    targetNodeId: target,
    directed,
  };
}

export function referenceDragValue(candidate: WorldReferenceCandidate) {
  return worldReferenceKey(candidate.target);
}

export function candidateForDragValue(
  candidates: readonly WorldReferenceCandidate[],
  value: string,
) {
  return candidates.find((candidate) => worldReferenceKey(candidate.target) === value);
}
