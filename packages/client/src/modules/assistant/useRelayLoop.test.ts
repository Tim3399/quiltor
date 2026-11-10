import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AssistantRelayGateway,
  RelayAnswered,
  RelayAnswerV1,
  RelayNext,
  RelayRequestV1,
} from "../../platform";
import type { ClientEngineExecutor, ClientEngineResult } from "./engines/types";
import { relayAnswerFor, runRelayLoop, useRelayLoop } from "./useRelayLoop";

function ticket(seq: number, maxOutputBytes = 262_144): RelayRequestV1 {
  return {
    ticket: `t${seq}`,
    seq,
    engine: "cloud",
    payload: { messages: [{ role: "user", content: `Runde ${seq}` }] },
    limits: { maxOutputBytes, answerBySeconds: 60 },
  };
}

/** A relay that hands out the given `next` answers in order, then ends with `final`. */
function scriptedRelay(nexts: RelayNext[], answers: RelayAnswered[] = [], final = 404) {
  const sent: RelayAnswerV1[] = [];
  const relay: AssistantRelayGateway = {
    relayNext: vi.fn(
      async (): Promise<RelayNext> => nexts.shift() ?? { kind: "ended", status: final },
    ),
    relayAnswer: vi.fn(async (answer: RelayAnswerV1): Promise<RelayAnswered> => {
      sent.push(answer);
      return answers.shift() ?? { kind: "ok" };
    }),
  };
  return { relay, sent };
}

function executor(...results: ClientEngineResult[]): ClientEngineExecutor {
  return {
    execute: vi.fn(
      async (): Promise<ClientEngineResult> =>
        results.shift() ?? { content: "", finishReason: "stop" },
    ),
  };
}

const stop = (content: string): ClientEngineResult => ({ content, finishReason: "stop" });

describe("relay loop", () => {
  it("answers one round and ends when the job is gone", async () => {
    const { relay, sent } = scriptedRelay([{ kind: "request", request: ticket(1) }]);
    const engine = executor(stop("{}"));
    const end = await runRelayLoop({
      jobId: "job",
      executor: engine,
      relay,
      signal: new AbortController().signal,
    });
    expect(end).toBe("ended");
    expect(engine.execute).toHaveBeenCalledWith(ticket(1).payload, expect.any(AbortSignal));
    expect(sent).toEqual([
      { ticket: "t1", seq: 1, output: { content: "{}", finishReason: "stop" } },
    ]);
    expect(relay.relayNext).toHaveBeenCalledWith("job", expect.any(AbortSignal));
  });

  it("echoes each ticket's seq over two rounds and waits through an idle poll", async () => {
    const { relay, sent } = scriptedRelay([
      { kind: "request", request: ticket(1) },
      { kind: "idle" },
      { kind: "request", request: ticket(2) },
    ]);
    await runRelayLoop({
      jobId: "job",
      executor: executor(stop("a"), stop("b")),
      relay,
      signal: new AbortController().signal,
    });
    expect(sent.map((answer) => [answer.ticket, answer.seq])).toEqual([
      ["t1", 1],
      ["t2", 2],
    ]);
  });

  it("stops at once on 401, from next or from answer", async () => {
    const fromNext = scriptedRelay([{ kind: "ended", status: 401 }]);
    expect(
      await runRelayLoop({
        jobId: "job",
        executor: executor(),
        relay: fromNext.relay,
        signal: new AbortController().signal,
      }),
    ).toBe("unauthorized");

    const fromAnswer = scriptedRelay(
      [
        { kind: "request", request: ticket(1) },
        { kind: "request", request: ticket(2) },
      ],
      [{ kind: "ended", status: 401 }],
    );
    const engine = executor(stop("a"), stop("b"));
    expect(
      await runRelayLoop({
        jobId: "job",
        executor: engine,
        relay: fromAnswer.relay,
        signal: new AbortController().signal,
      }),
    ).toBe("unauthorized");
    expect(engine.execute).toHaveBeenCalledTimes(1);
  });

  it("ends on 410 and does not run the engine again", async () => {
    const { relay } = scriptedRelay(
      [
        { kind: "request", request: ticket(1) },
        { kind: "request", request: ticket(2) },
      ],
      [{ kind: "ended", status: 410 }],
    );
    const engine = executor(stop("a"), stop("b"));
    const end = await runRelayLoop({
      jobId: "job",
      executor: engine,
      relay,
      signal: new AbortController().signal,
    });
    expect(end).toBe("ended");
    expect(engine.execute).toHaveBeenCalledTimes(1);
  });

  it("retries a poll lost on the network", async () => {
    const answers: RelayNext[] = [{ kind: "ended", status: 410 }];
    const relay: AssistantRelayGateway = {
      relayNext: vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockImplementation(async () => answers.shift()),
      relayAnswer: vi.fn(),
    };
    const end = await runRelayLoop({
      jobId: "job",
      executor: executor(),
      relay,
      signal: new AbortController().signal,
      retryMs: 1,
    });
    expect(end).toBe("ended");
    expect(relay.relayNext).toHaveBeenCalledTimes(2);
  });

  it("turns an executor that throws into a provider_error answer", async () => {
    const { relay, sent } = scriptedRelay([{ kind: "request", request: ticket(1) }]);
    const engine: ClientEngineExecutor = {
      execute: vi.fn(async () => {
        throw new Error("network down");
      }),
    };
    await runRelayLoop({
      jobId: "job",
      executor: engine,
      relay,
      signal: new AbortController().signal,
    });
    expect(sent).toEqual([
      { ticket: "t1", seq: 1, error: { code: "provider_error", detail: "network down" } },
    ]);
  });
});

describe("answer size", () => {
  it("sends an answer that fits and refuses one larger than the server takes", () => {
    const small = relayAnswerFor(ticket(1, 1000), stop("x".repeat(900)));
    expect(small).toEqual({
      ticket: "t1",
      seq: 1,
      output: { content: "x".repeat(900), finishReason: "stop" },
    });
    const large = relayAnswerFor(ticket(1, 1000), stop("x".repeat(1000)));
    expect(large).toEqual({
      ticket: "t1",
      seq: 1,
      error: { code: "provider_error", detail: "output too large" },
    });
  });

  it("counts bytes, not characters, at the real limit of 256 KiB", async () => {
    // 100 000 umlauts are 200 000 bytes and fit; 140 000 are 280 000 bytes and do not.
    const { relay, sent } = scriptedRelay([
      { kind: "request", request: ticket(1) },
      { kind: "request", request: ticket(2) },
    ]);
    await runRelayLoop({
      jobId: "job",
      executor: executor(stop("ä".repeat(100_000)), stop("ä".repeat(140_000))),
      relay,
      signal: new AbortController().signal,
    });
    expect("output" in sent[0]).toBe(true);
    expect(sent[1]).toEqual({
      ticket: "t2",
      seq: 2,
      error: { code: "provider_error", detail: "output too large" },
    });
  });
});

describe("cancel", () => {
  it("aborts the engine and answers the open ticket with cancelled", async () => {
    let engineSignal: AbortSignal | undefined;
    const engine: ClientEngineExecutor = {
      execute: vi.fn(
        (_payload, signal: AbortSignal) =>
          new Promise<ClientEngineResult>((resolve) => {
            engineSignal = signal;
            signal.addEventListener("abort", () => resolve(stop("too late")));
          }),
      ),
    };
    const { relay, sent } = scriptedRelay([{ kind: "request", request: ticket(7) }]);
    const { result } = renderHook(() => useRelayLoop(relay));
    let ended: Promise<string> | undefined;
    act(() => {
      ended = result.current.start("job", engine);
    });
    await waitFor(() => expect(engine.execute).toHaveBeenCalled());

    await act(async () => result.current.cancel());

    expect(engineSignal?.aborted).toBe(true);
    expect(await ended).toBe("aborted");
    // Only the cancellation reaches the server, never the aborted engine's late text.
    expect(sent).toEqual([{ ticket: "t7", seq: 7, error: { code: "cancelled" } }]);
  });

  it("sends nothing when no ticket is open", async () => {
    const { relay, sent } = scriptedRelay([]);
    const { result } = renderHook(() => useRelayLoop(relay));
    await act(async () => result.current.cancel());
    expect(sent).toEqual([]);
  });
});
