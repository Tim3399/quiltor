import type { MessageKey } from "../../i18n";
import type { AssistantEngineWire } from "../../modules/assistant";
import type { RelayAnswerV1, RelayRequestV1 } from "../contracts/v1/assistantRelay";
import type {
  AssistantHistoryMessage,
  AssistantJobState,
  AssistantMode,
  AssistantReply,
} from "../../modules/assistant";

export type AssistantBatchRequest = {
  runBatches: boolean;
  progressId: string;
  mode?: AssistantMode;
};

/**
 * How one relay call ended (T-61). `ended` carries the status that closes the loop for good:
 * 401 (signed out), 403 (switched off), 404 (job gone or not ours), 410 (ticket or job over),
 * 413/400 (the answer itself was refused), 429 (too many failed answers).
 * Anything else (network, 5xx) throws, and the loop tries again.
 */
export type RelayNext =
  | { kind: "request"; request: RelayRequestV1 }
  | { kind: "idle" }
  | { kind: "ended"; status: number };

export type RelayAnswered = { kind: "ok" } | { kind: "ended"; status: number };

/** The browser's half of a client job: take the next model call, send its answer. */
export interface AssistantRelayGateway {
  relayNext(jobId: string, signal?: AbortSignal): Promise<RelayNext>;
  relayAnswer(answer: RelayAnswerV1, signal?: AbortSignal): Promise<RelayAnswered>;
}

export interface AssistantGateway extends AssistantRelayGateway {
  status(): Promise<{
    ok: boolean;
    available: boolean;
    mode: string;
    reason: string;
    installed: boolean;
    /** False when the server's operator installs the assistant; missing on older servers. */
    installable?: boolean;
    /** False for a signed-in user without the premium role (T-58); missing means true. */
    premium?: boolean;
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
    /** A browser engine for this job (T-61); absent means the server's own model. */
    engine?: AssistantEngineWire,
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
