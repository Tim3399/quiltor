import type {
  StoryboardBoard,
  StoryboardEdge,
  StoryboardNode,
  StoryboardState,
} from "../../../modules/storyboard";
import {
  GRAPH_EDGE_COLORS,
  GRAPH_EDGE_LINE_STYLES,
  type GraphEdgeColor,
  type GraphEdgeLineStyle,
} from "../../../shared";
import {
  type DecodedDocumentV1,
  type DocumentEnvelopeWireV1,
  decodeDocumentEnvelopeV1,
  encodeDocumentEnvelopeV1,
} from "./documentEnvelope";
import { cloneNoteMarks, type NoteMarkWireV1, validateNoteMarks } from "./noteMark";
import {
  cloneNoteReferences,
  type NoteReferenceWireV1,
  validateNoteReferences,
} from "./noteReference";
import {
  optional,
  WireContractError,
  wireArray,
  wireBoolean,
  wireEnum,
  wireInteger,
  wireNumber,
  wireRecord,
  wireString,
} from "./validation";

const MAX_SAFE_WIRE_NUMBER = Number.MAX_SAFE_INTEGER;
const NODE_KINDS = ["note", "reference", "storyboard", "group"] as const;
const TARGET_KINDS = ["entity", "place", "timeline", "chapter", "storyboard"] as const;
const REFERENCE_TARGET_KINDS = ["entity", "place", "timeline", "chapter"] as const;

export interface StoryboardBoardWireV1 {
  id: string;
  title: string;
  [key: string]: unknown;
}

export interface StoryboardTargetWireV1 {
  kind: (typeof TARGET_KINDS)[number];
  id: string;
  [key: string]: unknown;
}

export interface StoryboardNodeWireV1 {
  id: string;
  boardId: string;
  kind: (typeof NODE_KINDS)[number];
  x: number;
  y: number;
  width?: number;
  height?: number;
  zIndex?: number;
  text?: string;
  label?: string;
  target?: StoryboardTargetWireV1;
  noteReferences?: NoteReferenceWireV1[];
  noteMarks?: NoteMarkWireV1[];
  [key: string]: unknown;
}

export interface StoryboardEdgeWireV1 {
  id: string;
  boardId: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
  directed?: boolean;
  color?: GraphEdgeColor;
  lineStyle?: GraphEdgeLineStyle;
  [key: string]: unknown;
}

export interface StoryboardsPayloadWireV1 {
  boards: StoryboardBoardWireV1[];
  nodes: StoryboardNodeWireV1[];
  edges: StoryboardEdgeWireV1[];
  [key: string]: unknown;
}

export type StoryboardsWireV1 = DocumentEnvelopeWireV1<StoryboardsPayloadWireV1>;

function identifier(value: unknown, path: string): string {
  const id = wireString(value, path, { min: 1, max: 500 });
  if (id.trim() !== id) throw new WireContractError(path);
  return id;
}

function sourceIdentifier(value: unknown, path: string): string {
  return wireString(value, path, { min: 1 });
}

function target(value: unknown, path: string): StoryboardTargetWireV1 {
  const record = wireRecord(value, path);
  const kind = wireEnum(record.kind, TARGET_KINDS, `${path}.kind`);
  const id = sourceIdentifier(record.id, `${path}.id`);
  return { ...record, kind, id } as StoryboardTargetWireV1;
}

function coordinate(value: unknown, path: string): number {
  return wireNumber(value, path, {
    min: -MAX_SAFE_WIRE_NUMBER,
    max: MAX_SAFE_WIRE_NUMBER,
  });
}

function size(value: unknown, path: string): number {
  return wireNumber(value, path, {
    exclusiveMin: 0,
    max: MAX_SAFE_WIRE_NUMBER,
  });
}

function validateStoryboardNoteReferences(
  value: unknown,
  text: string,
  path: string,
  boardIds: ReadonlySet<string>,
): NoteReferenceWireV1[] {
  const references = validateNoteReferences(value, text, path);
  for (const [index, reference] of references.entries()) {
    const referencePath = `${path}[${index}]`;
    identifier(reference.id, `${referencePath}.id`);
    const targetId = sourceIdentifier(reference.target.id, `${referencePath}.target.id`);
    if (reference.target.kind === "storyboard" && !boardIds.has(targetId)) {
      throw new WireContractError(`${referencePath}.target.id`);
    }
  }
  return references;
}

function storyboardsPayload(value: unknown, path: string): StoryboardsPayloadWireV1 {
  const payload = wireRecord(value, path);
  const boardValues = wireArray(payload.boards, `${path}.boards`);
  if (boardValues.length === 0 || boardValues.length > 10_000) {
    throw new WireContractError(`${path}.boards`);
  }
  const boardIds = new Set<string>();
  const boards = boardValues.map((boardValue, index) => {
    const boardPath = `${path}.boards[${index}]`;
    const board = wireRecord(boardValue, boardPath);
    const id = identifier(board.id, `${boardPath}.id`);
    if (boardIds.has(id)) throw new WireContractError(`${boardPath}.id`);
    boardIds.add(id);
    const title = wireString(board.title, `${boardPath}.title`, { max: 1000 });
    return { ...board, id, title } as StoryboardBoardWireV1;
  });

  const nodeValues = wireArray(payload.nodes, `${path}.nodes`);
  if (nodeValues.length > 100_000) throw new WireContractError(`${path}.nodes`);
  const nodeIds = new Set<string>();
  const nodeBoards = new Map<string, string>();
  const nodes = nodeValues.map((nodeValue, index) => {
    const nodePath = `${path}.nodes[${index}]`;
    const node = wireRecord(nodeValue, nodePath);
    const id = identifier(node.id, `${nodePath}.id`);
    if (nodeIds.has(id)) throw new WireContractError(`${nodePath}.id`);
    nodeIds.add(id);
    const boardId = identifier(node.boardId, `${nodePath}.boardId`);
    if (!boardIds.has(boardId)) throw new WireContractError(`${nodePath}.boardId`);
    nodeBoards.set(id, boardId);
    const kind = wireEnum(node.kind, NODE_KINDS, `${nodePath}.kind`);
    const x = coordinate(node.x, `${nodePath}.x`);
    const y = coordinate(node.y, `${nodePath}.y`);
    optional(node, "width", size, nodePath);
    optional(node, "height", size, nodePath);
    optional(
      node,
      "zIndex",
      (item, itemPath) =>
        wireInteger(item, itemPath, {
          min: -MAX_SAFE_WIRE_NUMBER,
          max: MAX_SAFE_WIRE_NUMBER,
        }),
      nodePath,
    );
    const decodedText =
      node.text === undefined
        ? undefined
        : wireString(node.text, `${nodePath}.text`, { max: 100_000 });
    optional(
      node,
      "label",
      (item, itemPath) => wireString(item, itemPath, { max: 1000 }),
      nodePath,
    );

    let decodedTarget: StoryboardTargetWireV1 | undefined;
    let noteReferences: NoteReferenceWireV1[] | undefined;
    let noteMarks: NoteMarkWireV1[] | undefined;
    if (kind === "note") {
      if (node.target !== undefined) throw new WireContractError(`${nodePath}.target`);
      if (decodedText === undefined) throw new WireContractError(`${nodePath}.text`);
    } else if (kind === "reference") {
      decodedTarget = target(node.target, `${nodePath}.target`);
      wireEnum(decodedTarget.kind, REFERENCE_TARGET_KINDS, `${nodePath}.target.kind`);
    } else if (kind === "storyboard") {
      decodedTarget = target(node.target, `${nodePath}.target`);
      if (decodedTarget.kind !== "storyboard" || !boardIds.has(decodedTarget.id)) {
        throw new WireContractError(`${nodePath}.target`);
      }
    } else {
      if (node.target !== undefined) throw new WireContractError(`${nodePath}.target`);
      size(node.width, `${nodePath}.width`);
      size(node.height, `${nodePath}.height`);
    }

    if (node.noteReferences !== undefined) {
      noteReferences = validateStoryboardNoteReferences(
        node.noteReferences,
        decodedText ?? "",
        `${nodePath}.noteReferences`,
        boardIds,
      );
    }
    if (node.noteMarks !== undefined) {
      noteMarks = validateNoteMarks(node.noteMarks, decodedText ?? "", `${nodePath}.noteMarks`);
    }

    return {
      ...node,
      id,
      boardId,
      kind,
      x,
      y,
      ...(decodedTarget === undefined ? {} : { target: decodedTarget }),
      ...(noteReferences === undefined ? {} : { noteReferences }),
      ...(noteMarks === undefined ? {} : { noteMarks }),
    } as StoryboardNodeWireV1;
  });

  const edgeValues = wireArray(payload.edges, `${path}.edges`);
  if (edgeValues.length > 200_000) throw new WireContractError(`${path}.edges`);
  const edgeIds = new Set<string>();
  const edges = edgeValues.map((edgeValue, index) => {
    const edgePath = `${path}.edges[${index}]`;
    const edge = wireRecord(edgeValue, edgePath);
    const id = identifier(edge.id, `${edgePath}.id`);
    if (edgeIds.has(id)) throw new WireContractError(`${edgePath}.id`);
    edgeIds.add(id);
    const boardId = identifier(edge.boardId, `${edgePath}.boardId`);
    if (!boardIds.has(boardId)) throw new WireContractError(`${edgePath}.boardId`);
    const sourceNodeId = identifier(edge.sourceNodeId, `${edgePath}.sourceNodeId`);
    const targetNodeId = identifier(edge.targetNodeId, `${edgePath}.targetNodeId`);
    if (nodeBoards.get(sourceNodeId) !== boardId || nodeBoards.get(targetNodeId) !== boardId) {
      throw new WireContractError(edgePath);
    }
    optional(
      edge,
      "label",
      (item, itemPath) => wireString(item, itemPath, { max: 1000 }),
      edgePath,
    );
    optional(edge, "directed", wireBoolean, edgePath);
    optional(
      edge,
      "color",
      (item, itemPath) => wireEnum(item, GRAPH_EDGE_COLORS, itemPath),
      edgePath,
    );
    optional(
      edge,
      "lineStyle",
      (item, itemPath) => wireEnum(item, GRAPH_EDGE_LINE_STYLES, itemPath),
      edgePath,
    );
    return {
      ...edge,
      id,
      boardId,
      sourceNodeId,
      targetNodeId,
    } as StoryboardEdgeWireV1;
  });

  return { ...payload, boards, nodes, edges } as StoryboardsPayloadWireV1;
}

function cloneBoard(board: StoryboardBoardWireV1 | StoryboardBoard): StoryboardBoardWireV1 {
  return { ...board };
}

function cloneNode(node: StoryboardNodeWireV1 | StoryboardNode): StoryboardNodeWireV1 {
  return {
    ...node,
    target: node.target ? ({ ...node.target } as StoryboardTargetWireV1) : undefined,
    noteReferences: cloneNoteReferences(node.noteReferences),
    noteMarks: cloneNoteMarks(node.noteMarks),
  };
}

function cloneEdge(edge: StoryboardEdgeWireV1 | StoryboardEdge): StoryboardEdgeWireV1 {
  return { ...edge };
}

export function decodeStoryboardsV1(value: unknown): DecodedDocumentV1<StoryboardState> {
  const wire = decodeDocumentEnvelopeV1(value, "quiltor.storyboards", storyboardsPayload);
  return {
    document: {
      ...wire.payload,
      boards: wire.payload.boards.map(cloneBoard),
      nodes: wire.payload.nodes.map(cloneNode) as StoryboardNode[],
      edges: wire.payload.edges.map(cloneEdge),
    },
    revision: wire.revision,
  };
}

export function encodeStoryboardsV1(model: StoryboardState, revision?: number): StoryboardsWireV1 {
  const payload = {
    ...model,
    boards: model.boards.map(cloneBoard),
    nodes: model.nodes.map(cloneNode),
    edges: model.edges.map(cloneEdge),
  } as StoryboardsPayloadWireV1;
  return encodeDocumentEnvelopeV1("quiltor.storyboards", payload, revision, storyboardsPayload);
}
