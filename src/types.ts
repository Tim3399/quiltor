import type { MessageKey } from "./language";
import type { WritingLanguage } from "./language/writing";

export type Workspace = "text" | "figures" | "timeline" | "places";
export type TextSearchTarget = {
  query: string;
  from: number;
  to: number;
};
export type WorkspaceTarget = {
  workspace: Workspace;
  id: string;
  textSearch?: TextSearchTarget;
};
export type SavePhase = "idle" | "dirty" | "saving" | "saved" | "error";

export interface EntityMention {
  id: string;
  elementId: string;
  from: number;
  to: number;
  surface: string;
  source: "completion" | "helper" | "deterministic" | "llm-assisted";
  confidence: number;
}

export type TextMarkKind = "bold" | "italic";
// Formatting is stored the way a mention is: a range over the body, never a character in
// it. `**` inside Chapter.body would reach LanguageTool, the mention scanner, wordCount and
// the assistant's retrieval corpus -- all four read the raw text. Markers appear only on the
// way out, in the Markdown exports and the book PDF.
export interface TextMark {
  from: number;
  to: number;
  kind: TextMarkKind;
}

export interface Chapter {
  id: string;
  title: string;
  body: string;
  note: string;
  mentions?: EntityMention[];
  marks?: TextMark[];
  [key: string]: unknown;
}

export type GrammarMode = "manual" | "automatic";
export type WritingIssue = {
  id: string;
  from: number;
  to: number;
  ruleId: string;
  category: string;
  message: string;
  replacements: string[];
};

export interface Manuscript {
  chapters: Chapter[];
  language?: WritingLanguage;
  grammarMode?: GrammarMode;
  words?: Array<string | { w: string; d?: string }>;
  zeichenAktiv?: string[];
  [key: string]: unknown;
}

export interface ProfileExtra {
  k: string;
  v: string;
}
export interface Profile {
  alter?: string;
  rolle?: string;
  aussehen?: string;
  herkunft?: string;
  stimme?: string;
  notizen?: string;
  extra?: ProfileExtra[];
  [key: string]: unknown;
}

export type FigureKind = "person" | "tier" | "ort" | "organisation" | "objekt" | "konzept";
export interface FigureNode {
  id: string;
  x: number;
  y: number;
  type?: FigureKind;
  label?: string;
  name: string;
  sub?: string;
  accent?: "ink" | "gold" | "rose" | "moss";
  dash?: boolean;
  pinned?: boolean;
  important?: boolean;
  diedMomentId?: string;
  profile?: Profile;
  mapX?: number;
  mapY?: number;
  [key: string]: unknown;
}

export interface FigureEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  style?: "solid" | "dashed" | "blood" | "gold";
  gerichtet?: boolean;
  fromHandle?: string;
  toHandle?: string;
  active?: boolean;
  versions?: RelationshipVersion[];
  [key: string]: unknown;
}

export interface RelationshipVersion {
  momentId: string;
  from?: string;
  to?: string;
  label?: string;
  style?: "solid" | "dashed" | "blood" | "gold";
  gerichtet?: boolean;
  active: boolean;
}

export interface TimelineMoment {
  id: string;
  title: string;
  date?: string;
  note?: string;
}

export interface PresenceEntry {
  id: string;
  elementId: string;
  placeId: string;
  momentId?: string;
}

export interface FigureState {
  nodes: FigureNode[];
  edges: FigureEdge[];
  timeline?: TimelineMoment[];
  presence?: PresenceEntry[];
  canvasSize?: { w: number; h: number };
  mapScale?: { unitsPer100px: number; unitLabel: string };
  [key: string]: unknown;
}

export interface BackupStatus {
  ok: boolean;
  grund?: string;
  endpoint?: string;
  aenderungen?: string[];
  anzahl?: number;
  vorschlag?: string;
}

export interface SnapshotInfo {
  hash: string;
  kurz: string;
  datum: string;
  betreff: string;
}
export interface WorldInfo {
  id: string;
  title: string;
  backupUrl: string;
  updated: string;
}

export interface AssistantSource {
  id: string;
  kind: string;
  title: string;
  text: string;
  target: { workspace: Workspace; id: string };
}
export type AssistantProposal =
  | {
      kind: "create_element";
      tempId: string;
      element: {
        type?: FigureKind;
        name?: string;
        label?: string;
        sub?: string;
        profile?: Profile;
      };
    }
  | {
      kind: "update_element";
      elementId: string;
      patch: Partial<Pick<FigureNode, "name" | "label" | "sub" | "profile">>;
    }
  | {
      kind: "create_timeline_moment";
      tempId: string;
      moment: Partial<Pick<TimelineMoment, "title" | "date" | "note">>;
    }
  | {
      kind: "create_relationship";
      relationship: {
        from: string;
        to: string;
        label?: string;
        directed?: boolean;
        style?: FigureEdge["style"];
      };
    }
  | {
      kind: "set_relationship_at_moment";
      relationshipId: string;
      momentId: string;
      patch: { label?: string; active?: boolean; directed?: boolean; style?: FigureEdge["style"] };
    }
  | { kind: "mark_deceased"; elementId: string; momentId: string }
  | { kind: "set_presence"; elementId: string; placeId: string; momentId?: string }
  | { kind: "arrange_elements"; strategy: "thematic" | "grid" };
export interface AssistantHistoryMessage {
  role: "user" | "assistant";
  content: string;
  references?: string[];
}
// Deterministic backend replies (backend/assistant/*.py) carry a translation key/params
// triple instead of literal text -- src/language/{de,en}/assistant.ts is the single source
// of truth for that text. `message` remains the (German) fallback used for logging and for
// genuinely free-form LLM-authored text, which the model already produces in the right
// language per the system prompt -- see resolveAssistantMessage in AssistantDrawer.tsx.
export interface AssistantMessageItem {
  key: MessageKey;
  params?: Record<string, string | number>;
}
export interface AssistantReply {
  ok: boolean;
  message: string;
  proposals: AssistantProposal[];
  sources: AssistantSource[];
  messageKey?: MessageKey;
  messageParams?: Record<string, string | number>;
  messageItems?: AssistantMessageItem[];
  messageNoteKey?: MessageKey;
  proposalGroup?: { id: string; title: string; proposalIndexes: number[] };
  agentTrace?: Array<{ step: string; [key: string]: unknown }>;
  broadScope?: { chapterCount: number; estimateSeconds: number };
  clarification?: { candidates: Array<{ id: string; name: string; kind: string }> };
}

export const PROFILE_FIELDS: Array<[keyof Profile, MessageKey, "short" | "long"]> = [
  ["alter", "profileAge", "short"],
  ["rolle", "profileRoleInStory", "long"],
  ["aussehen", "profileAppearance", "long"],
  ["herkunft", "profileBackground", "long"],
  ["stimme", "profileVoice", "long"],
  ["notizen", "profileNotes", "long"],
];

export const uid = (prefix: string) => `${prefix}${crypto.randomUUID().slice(0, 8)}`;
export const wordCount = (value = "") => (value.trim() ? value.trim().split(/\s+/).length : 0);
