import type { MessageKey } from "../../i18n";
import type { AssistantHistoryMessage, AssistantReply } from "./model";

export type AssistantEntry = {
  id: string;
  question: string;
  reply?: AssistantReply;
  error?: string;
  applied: number[];
  // These fields make an in-flight server job durable across drawer closes and reloads.
  requestId?: string;
  jobId?: string;
  history?: AssistantHistoryMessage[];
  chapterIds?: string[];
  runBatches?: boolean;
  progressId?: string;
};

export type AssistantBatchProgress = {
  total: number;
  done: number;
  labelKey?: MessageKey;
  labelParams?: Record<string, string | number>;
};

export type AssistantSendOptions = { batch?: boolean };
