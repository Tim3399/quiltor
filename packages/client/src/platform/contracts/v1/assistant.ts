import type { MessageKey } from "../../../i18n";
import type {
  AssistantJobState,
  AssistantJobStatus,
  AssistantMessageItem,
  AssistantProposal,
  AssistantReply,
  AssistantSource,
} from "../../../modules/assistant";
import type { ApplicationErrorCategory } from "../../../shared";

export interface AssistantReplyWireV1 {
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
