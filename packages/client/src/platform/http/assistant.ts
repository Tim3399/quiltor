import type { MessageKey } from "../../i18n";
import type { AssistantGateway } from "../application";
import { createAssistantJobsHttpGateway } from "./assistantJobs";
import { requestJson, withWorldQuery, type HttpApplicationState } from "./request";

export function createAssistantHttpGateway(state: HttpApplicationState): AssistantGateway {
  return {
    status: () =>
      requestJson<{
        ok: boolean;
        available: boolean;
        mode: string;
        reason: string;
        installed: boolean;
        chunks: number;
        backend?: string;
        contextTokens?: number;
        model?: string;
      }>(withWorldQuery(state, "/api/assistant/status")),
    install: () =>
      requestJson<{ ok: boolean; started: boolean }>("/api/assistant/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    installStatus: () =>
      requestJson<{
        ok: boolean;
        running: boolean;
        phase: string;
        percent: number;
        error: string;
      }>("/api/assistant/install/status"),
    ...createAssistantJobsHttpGateway(state),
    progress: (id: string) =>
      requestJson<{
        ok: boolean;
        progress: {
          total: number;
          done: number;
          labelKey?: MessageKey;
          labelParams?: Record<string, string | number>;
          startedAt: number;
          updatedAt: number;
        } | null;
      }>(withWorldQuery(state, `/api/assistant/progress?id=${encodeURIComponent(id)}`)),
  };
}
