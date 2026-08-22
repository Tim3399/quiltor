import type {
  AssistantHistoryMessage,
  AssistantJobState,
  AssistantReply,
} from "../../modules/assistant";
import type { MessageKey } from "../../i18n";

export type AssistantBatchRequest = { runBatches: boolean; progressId: string };

export interface AssistantGateway {
  status(): Promise<{
    ok: boolean;
    available: boolean;
    mode: string;
    reason: string;
    installed: boolean;
    chunks: number;
    backend?: string;
    contextTokens?: number;
    model?: string;
  }>;
  install(): Promise<{ ok: boolean; started: boolean }>;
  installStatus(): Promise<{
    ok: boolean;
    running: boolean;
    phase: string;
    percent: number;
    error: string;
  }>;
  jobStatus(id: string, signal?: AbortSignal): Promise<AssistantJobState>;
  cancelJob(id: string): Promise<AssistantJobState>;
  wait(id: string, signal?: AbortSignal): Promise<AssistantReply>;
  chat(
    question: string,
    history?: AssistantHistoryMessage[],
    signal?: AbortSignal,
    chapterIds?: string[],
    batch?: AssistantBatchRequest,
    idempotencyKey?: string,
    onJobCreated?: (job: AssistantJobState) => void,
  ): Promise<AssistantReply>;
  progress(id: string): Promise<{
    ok: boolean;
    progress: {
      total: number;
      done: number;
      labelKey?: MessageKey;
      labelParams?: Record<string, string | number>;
      startedAt: number;
      updatedAt: number;
    } | null;
  }>;
}
