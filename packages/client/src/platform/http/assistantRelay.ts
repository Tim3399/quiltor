import type { AssistantRelayGateway } from "../application";
import { decodeRelayRequestV1 } from "../contracts/v1/assistantRelay";
import { type HttpApplicationState, withWorldQuery } from "./request";

const NEXT_PATH = "/api/assistant/relay/next";
const ANSWER_PATH = "/api/assistant/relay/answer";

function isFinal(status: number): boolean {
  return status >= 400 && status < 500;
}

class RelayTransportError extends Error {
  constructor(readonly status: number) {
    super(`Relay request failed with HTTP ${status}.`);
    this.name = "RelayTransportError";
  }
}

export function createAssistantRelayHttpGateway(
  state: HttpApplicationState,
): AssistantRelayGateway {
  return {
    async relayNext(jobId, signal) {
      const response = await fetch(
        withWorldQuery(state, `${NEXT_PATH}?job=${encodeURIComponent(jobId)}`),
        { cache: "no-store", signal },
      );
      if (response.status === 204) return { kind: "idle" };
      if (isFinal(response.status)) return { kind: "ended", status: response.status };
      if (!response.ok) throw new RelayTransportError(response.status);
      const request = decodeRelayRequestV1(await response.json().catch(() => null));
      return request ? { kind: "request", request } : { kind: "idle" };
    },
    async relayAnswer(answer, signal) {
      const response = await fetch(withWorldQuery(state, ANSWER_PATH), {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answer),
        signal,
      });
      if (isFinal(response.status)) return { kind: "ended", status: response.status };
      if (!response.ok) throw new RelayTransportError(response.status);
      return { kind: "ok" };
    },
  };
}
