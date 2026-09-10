import type { TextSearchTarget, ViewportMode, Workspace } from "../../shared";
import type { FigureState } from "../story-world";
import type { EditorTextSelection, EditorViewSelection } from "./ManuscriptEditor";
import type { Manuscript } from "./model";

/** Volatile view data only; owned by the active world workspace, never persisted. */
export interface ManuscriptEditorSessionState {
  chapterId: string;
  selection: EditorViewSelection;
  scrollTop: number;
}

export interface TextWorkspaceProps {
  worldTitle?: string;
  manuscript: Manuscript;
  figures: FigureState;
  orphanedMentions?: number;
  onChange: (value: Manuscript) => void;
  onOpenEntity?: (target: { workspace: Workspace; id: string }) => void;
  currentChapterId?: string;
  onCurrentChapterId?: (chapterId: string) => void;
  sessionState?: ManuscriptEditorSessionState | null;
  onSessionStateChange?: (state: ManuscriptEditorSessionState) => void;
  focus: boolean;
  onFocus: (value: boolean) => void;
  targetId?: string;
  targetRequestId?: number;
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
