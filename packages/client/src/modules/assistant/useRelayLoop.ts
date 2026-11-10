import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AssistantRelayGateway, RelayAnswerV1, RelayRequestV1 } from "../../platform";
import type { ClientEngineExecutor, ClientEngineResult } from "./engines/types";

const RETRY_MS = 1000;

/** Why the loop stopped. After `ended` the job's own status says how it finished. */
export type RelayLoopEnd = "ended" | "unauthorized" | "aborted";

export type RelayLoopOptions = {
  jobId: string;
  executor: ClientEngineExecutor;
  relay: AssistantRelayGateway;
  signal: AbortSignal;
  /** The ticket being worked on, or null between tickets; the cancel path answers it. */
  onTicket?: (ticket: RelayRequestV1 | null) => void;
  retryMs?: number;
};

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(done, ms);
    function done() {
      globalThis.clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The answer to one ticket, refused here when it would be larger than the server takes. */
export function relayAnswerFor(request: RelayRequestV1, result: ClientEngineResult): RelayAnswerV1 {
  const base = { ticket: request.ticket, seq: request.seq };
  if ("error" in result) return { ...base, error: result.error };
  const answer: RelayAnswerV1 = { ...base, output: result };
  // The whole body counts against the server's limit, not only the text: a body above it is
  // refused unread (413), and the job would wait for an answer that never comes.
  if (utf8Bytes(JSON.stringify(answer)) > request.limits.maxOutputBytes) {
    return { ...base, error: { code: "provider_error", detail: "output too large" } };
  }
  return answer;
}

/**
 * Work a client job's tickets until it is over: `relay/next`, the executor, `relay/answer`.
 * A 401 ends the loop as `unauthorized`; any other final status (404, 410, ...) as `ended`,
 * and the caller reads the job. Network failures are retried. An abort stops at once; the
 * open ticket is the canceller's to answer (`cancelRelayTicket`).
 */
export async function runRelayLoop(options: RelayLoopOptions): Promise<RelayLoopEnd> {
  const { jobId, executor, relay, signal, onTicket } = options;
  const retryMs = options.retryMs ?? RETRY_MS;
  while (!signal.aborted) {
    let next: Awaited<ReturnType<AssistantRelayGateway["relayNext"]>>;
    try {
      next = await relay.relayNext(jobId, signal);
    } catch {
      if (signal.aborted) break;
      await wait(retryMs, signal);
      continue;
    }
    if (next.kind === "idle") continue;
    if (next.kind === "ended") return next.status === 401 ? "unauthorized" : "ended";

    const request = next.request;
    onTicket?.(request);
    let result: ClientEngineResult;
    try {
      result = await executor.execute(request.payload, signal);
    } catch (error) {
      result = {
        error: {
          code: "provider_error",
          detail: error instanceof Error ? error.message : String(error),
        },
      };
    }
    if (signal.aborted) break;

    let answered: Awaited<ReturnType<AssistantRelayGateway["relayAnswer"]>>;
    try {
      answered = await relay.relayAnswer(relayAnswerFor(request, result), signal);
    } catch {
      // Lost on the way: the ticket runs into its deadline and the job decides what follows.
      onTicket?.(null);
      if (signal.aborted) break;
      await wait(retryMs, signal);
      continue;
    }
    onTicket?.(null);
    if (answered.kind === "ended") return answered.status === 401 ? "unauthorized" : "ended";
  }
  return "aborted";
}

/** Answer the open ticket with `cancelled`, so the server frees the job's slot at once (F-61-5). */
function cancelRelayTicket(
  relay: AssistantRelayGateway,
  ticket: RelayRequestV1 | null,
): Promise<void> {
  if (!ticket) return Promise.resolve();
  return relay
    .relayAnswer({ ticket: ticket.ticket, seq: ticket.seq, error: { code: "cancelled" } })
    .then(
      () => undefined,
      () => undefined,
    );
}

/**
 * One relay loop per client job. `start` runs it beside the job's own polling; `cancel`
 * aborts the executor and answers the open ticket with `cancelled`. The caller still sends
 * the job's `cancel`: either one alone frees the slot, so losing one of them is harmless.
 */
export function useRelayLoop(relay: AssistantRelayGateway) {
  const controller = useRef<AbortController | null>(null);
  const ticket = useRef<RelayRequestV1 | null>(null);

  const stop = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    ticket.current = null;
  }, []);

  const start = useCallback(
    (jobId: string, executor: ClientEngineExecutor): Promise<RelayLoopEnd> => {
      stop();
      const own = new AbortController();
      controller.current = own;
      return runRelayLoop({
        jobId,
        executor,
        relay,
        signal: own.signal,
        onTicket: (current) => {
          if (controller.current === own) ticket.current = current;
        },
      });
    },
    [relay, stop],
  );

  const cancel = useCallback((): Promise<void> => {
    const open = ticket.current;
    stop();
    return cancelRelayTicket(relay, open);
  }, [relay, stop]);

  useEffect(() => stop, [stop]);

  return useMemo(() => ({ start, cancel, stop }), [start, cancel, stop]);
}
