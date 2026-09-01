import type { MessageKey } from "../../../i18n";
import type {
  AssistantContextClass,
  AssistantJobState,
  AssistantJobStatus,
  AssistantMessageItem,
  AssistantMode,
  AssistantProposal,
  AssistantProposalEnvelope,
  AssistantReply,
  AssistantSource,
} from "../../../modules/assistant";
import type { ApplicationErrorCategory } from "../../../shared";

export interface AssistantReplyWireV1 {
  ok: boolean;
  message: string;
  proposals: AssistantProposal[];
  sources: AssistantSource[];
  contextClassesUsed?: AssistantContextClass[];
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
  staleContext?: {
    changedDocuments: string[];
    expectedRevisions: Record<string, number>;
    currentRevisions: Record<string, number>;
  };
}

export interface AssistantJobWireV1 {
  id: string;
  status: AssistantJobStatus;
  progressId?: string | null;
  result?: AssistantReplyWireV1 | null;
  error: string;
  errorType: string;
  httpStatus?: number | null;
  interactionId?: string | null;
  cancelRequested: boolean;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export function decodeAssistantReplyV1(wire: AssistantReplyWireV1): AssistantReply {
  return {
    ...wire,
    proposals: wire.proposals.map((proposal) => structuredClone(proposal)),
    sources: wire.sources.map((source) => ({ ...source, target: { ...source.target } })),
    contextClassesUsed: wire.contextClassesUsed ? [...wire.contextClassesUsed] : undefined,
    staleContext: wire.staleContext
      ? {
          changedDocuments: [...wire.staleContext.changedDocuments],
          expectedRevisions: { ...wire.staleContext.expectedRevisions },
          currentRevisions: { ...wire.staleContext.currentRevisions },
        }
      : undefined,
    proposalEnvelopes: wire.proposalEnvelopes?.map((envelope) => ({
      ...envelope,
      proposal: structuredClone(envelope.proposal),
      evidence: envelope.evidence.map((source) => ({
        ...source,
        target: { ...source.target },
      })),
      resolution: envelope.resolution
        ? {
            ...envelope.resolution,
            candidateIds: [...envelope.resolution.candidateIds],
          }
        : undefined,
    })),
    proposalGroups: wire.proposalGroups?.map((group) => ({
      ...group,
      proposalIndexes: [...group.proposalIndexes],
    })),
    messageItems: wire.messageItems?.map((item) => ({ ...item })),
  };
}

export function decodeAssistantJobV1(
  wire: AssistantJobWireV1,
  failureCode?: ApplicationErrorCategory,
): AssistantJobState {
  const { httpStatus: _transportStatus, ...rest } = wire;
  return {
    ...rest,
    result: wire.result ? decodeAssistantReplyV1(wire.result) : wire.result,
    failureCode,
  };
}
