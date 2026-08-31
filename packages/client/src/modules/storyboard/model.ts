import type {
  GraphEdgeColor,
  GraphEdgeLineStyle,
  NoteReference,
  WorldReferenceTarget,
} from "../../shared";

export const DEFAULT_STORYBOARD_ID = "main-storyboard";
export const DEFAULT_STORYBOARD_TITLE = "Main Storyboard";

export type StoryboardNodeKind = "note" | "reference" | "storyboard" | "group";
export type StoryboardReferenceTarget = Exclude<WorldReferenceTarget, { kind: "storyboard" }>;
export type StoryboardBoardTarget = Extract<WorldReferenceTarget, { kind: "storyboard" }>;

export interface StoryboardBoard {
  id: string;
  title: string;
  [key: string]: unknown;
}

interface StoryboardNodeBase {
  id: string;
  boardId: string;
  kind: StoryboardNodeKind;
  x: number;
  y: number;
  width?: number;
  height?: number;
  zIndex?: number;
  label?: string;
  text?: string;
  noteReferences?: NoteReference[];
  [key: string]: unknown;
}

export interface StoryboardNoteNode extends StoryboardNodeBase {
  kind: "note";
  text: string;
  target?: never;
}

export interface StoryboardReferenceNode extends StoryboardNodeBase {
  kind: "reference";
  target: StoryboardReferenceTarget;
}

export interface StoryboardBoardNode extends StoryboardNodeBase {
  kind: "storyboard";
  target: StoryboardBoardTarget;
}

export interface StoryboardGroupNode extends StoryboardNodeBase {
  kind: "group";
  width: number;
  height: number;
  target?: never;
}

export type StoryboardNode =
  | StoryboardNoteNode
  | StoryboardReferenceNode
  | StoryboardBoardNode
  | StoryboardGroupNode;

export interface StoryboardEdge {
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

export interface StoryboardState {
  boards: StoryboardBoard[];
  nodes: StoryboardNode[];
  edges: StoryboardEdge[];
  [key: string]: unknown;
}

export function createDefaultStoryboardState(): StoryboardState {
  return {
    boards: [{ id: DEFAULT_STORYBOARD_ID, title: DEFAULT_STORYBOARD_TITLE }],
    nodes: [],
    edges: [],
  };
}
