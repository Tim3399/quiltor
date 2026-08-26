import type { TextSearchTarget, ViewportMode, Workspace } from "../../shared";
import type { FigureState } from "../story-world";
import type { EditorTextSelection } from "./ManuscriptEditor";
import type { Manuscript } from "./model";

export interface TextWorkspaceProps {
  worldTitle?: string;
  manuscript: Manuscript;
  figures: FigureState;
  orphanedMentions?: number;
  onChange: (value: Manuscript) => void;
  onOpenEntity?: (target: { workspace: Workspace; id: string }) => void;
  onCurrentChapterId?: (chapterId: string) => void;
  focus: boolean;
  onFocus: (value: boolean) => void;
  targetId?: string;
  textSearch?: TextSearchTarget;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onSave?: () => Promise<void>;
  viewportMode?: ViewportMode;
  binderOpen?: boolean;
  onBinderOpen?: (open: boolean) => void;
  inspectorOpen?: boolean;
  onInspectorOpen?: (open: boolean) => void;
  sidebarWidth?: number;
  onSidebarWidth?: (width: number) => void;
  inspectorWidth?: number;
  onInspectorWidth?: (width: number) => void;
}

export type HelperMode = "lookup" | "check" | "insert";
export type WritingTool = "lookup" | "synonyms" | "translate";
export type WorkspaceSelection = EditorTextSelection & { chapterId: string; revision: string };
