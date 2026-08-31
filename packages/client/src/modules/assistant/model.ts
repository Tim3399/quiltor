import type { MessageKey } from "../../i18n";
import type { ApplicationErrorCategory, Workspace } from "../../shared";
import type { FigureEdge, FigureKind, FigureNode, Profile, TimelineMoment } from "../story-world";

export interface AssistantSource {
  id: string;
  kind: string;
  title: string;
  text: string;
  target: { workspace: Workspace; id: string };
}

export type AssistantMode = "chat" | "world_extraction";

export type AssistantClaimStatus =
  | "objective_fact"
  | "narrator_claim"
  | "character_knows"
  | "character_believes"
  | "character_claims"
  | "unresolved";

export interface AssistantProposalEnvelope {
  proposal: AssistantProposal;
  evidence: AssistantSource[];
  resolution?: {
    operation: string;
    outcome: string;
    status: string;
    resolvedId?: string | null;
    candidateIds: string[];
  };
  confidence?: number;
  claimStatus?: AssistantClaimStatus;
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
        aliases?: FigureNode["aliases"];
      };
    }
  | {
      kind: "update_element";
      elementId: string;
      patch: Partial<Pick<FigureNode, "name" | "label" | "sub" | "profile" | "aliases">>;
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
        lineStyle?: FigureEdge["lineStyle"];
        relationshipKind?: FigureEdge["relationshipKind"];
        color?: FigureEdge["color"];
        /** @deprecated Accepted only for v1 assistant responses. */
        style?: FigureEdge["style"];
      };
    }
  | {
      kind: "set_relationship_at_moment";
      relationshipId: string;
      momentId: string;
      patch: {
        label?: string;
        active?: boolean;
        directed?: boolean;
        lineStyle?: FigureEdge["lineStyle"];
        relationshipKind?: FigureEdge["relationshipKind"];
        color?: FigureEdge["color"];
        /** @deprecated Accepted only for v1 assistant responses. */
        style?: FigureEdge["style"];
      };
    }
  | { kind: "mark_deceased"; elementId: string; momentId: string }
  | { kind: "set_presence"; elementId: string; placeId: string; momentId?: string }
  | { kind: "arrange_elements"; strategy: "thematic" | "grid" };

export interface AssistantHistoryMessage {
  role: "user" | "assistant";
  content: string;
  references?: string[];
}

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
  proposalGroups?: Array<{ id: string; proposalIndexes: number[] }>;
  proposalEnvelopes?: AssistantProposalEnvelope[];
  mode?: AssistantMode;
  extraction?: {
    chapterIds: string[];
    chapterCount: number;
    groupCount: number;
  } | null;
  agentTrace?: Array<{ step: string; [key: string]: unknown }>;
  broadScope?: { chapterCount: number; estimateSeconds: number };
  clarification?: { candidates: Array<{ id: string; name: string; kind: string }> };
  staleWorld?: { expectedRevision: number; currentRevision: number };
}

export type AssistantJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface AssistantJobState {
  id: string;
  status: AssistantJobStatus;
  progressId?: string | null;
  result?: AssistantReply | null;
  error: string;
  errorType: string;
  failureCode?: ApplicationErrorCategory;
  interactionId?: string | null;
  cancelRequested: boolean;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}
